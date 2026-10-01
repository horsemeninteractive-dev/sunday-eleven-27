import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION } from '@/domain/game';
import { isPlayer, type Player } from '@/domain/person';
import {
  assessableAttributeKeys,
  bandIndex,
  emptyKnowledge,
  type AttributeKey,
  type ObservationBand,
} from '@/domain/recruitment';
import type { ClubId, PersonId } from '@/domain/ids';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { publishEvents } from './news';
import { advanceWeek, startNextSeason } from './progression';
import {
  candidatePool,
  holdOpenSession,
  lookAtFiveASide,
  observeCandidate,
  requestRecommendations,
} from './recruitment/discovery';
import { candidateInterest } from './recruitment/interest';
import { bandOf, knowledgeCounts, knowledgeFromRecommendation, knowledgeFromTrial } from './recruitment/knowledge';
import { squadNeeds } from './recruitment/needs';
import { approachCandidate, passOnCandidate, signCandidate } from './recruitment/signing';
import { addCandidate, candidateOf, candidatesOf, recruitmentStore } from './recruitment/store';
import { inviteToTrial, runTrialSession } from './recruitment/trials';
import { getRelationship, rebuildRelationshipIndex, recordInteraction, relationshipViewsFor, upsertRelationship } from './relationships';
import { Rng } from './rng';
import { createTestGame, type TestGame } from './testSupport';

function allPlayers(game: TestGame): Player[] {
  return Object.values(game.state.people).filter(isPlayer);
}

function unattached(game: TestGame): Player[] {
  return allPlayers(game).filter((player) => player.clubId === null);
}

function squad(game: TestGame): Player[] {
  const club = game.state.clubs[game.state.userClubId]!;
  return club.squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

/** Somebody who lives in the club's own town and is not playing anywhere. */
function localUnattached(game: TestGame): Player {
  const club = game.state.clubs[game.state.userClubId]!;
  const found = unattached(game).find((player) => player.townId === club.townId);
  if (!found) throw new Error('No unattached player in the club town');
  return found;
}

function attitudeBands(player: Player): Map<AttributeKey, ObservationBand> {
  const map = new Map<AttributeKey, ObservationBand>();
  for (const key of assessableAttributeKeys(player.preferredPosition === 'GK')) map.set(key, bandOf(player, key));
  return map;
}

/** How often a source's reported bands match the truth, over many samples. */
function accuracyOf(game: TestGame, recommender: Player, candidate: Player, samples = 300): number {
  let hits = 0;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const read = knowledgeFromRecommendation(game.state, new Rng(`accuracy-${i}`), {
      candidate,
      recommender,
      date: game.state.date,
    });
    for (const [key, entry] of Object.entries(read.knowledge.attributes)) {
      total += 1;
      if (entry.band === bandOf(candidate, key)) hits += 1;
    }
  }
  return total === 0 ? 0 : hits / total;
}

describe('the unattached pool', () => {
  it('puts people in the world who are not playing anywhere, but are still connected', () => {
    const game = createTestGame('rec-pool');
    const pool = unattached(game);
    expect(pool.length).toBeGreaterThan(8);

    for (const player of pool) {
      expect(player.registered).toBe(false);
      expect(player.clubId).toBeNull();
      expect(player.notes.length).toBeGreaterThan(0);
      // Nobody is a stranger: every name reaches the world through somebody.
      expect(relationshipViewsFor(game.state, player.id).length).toBeGreaterThan(0);
    }

    // And the clubs keep their own squads intact.
    for (const club of Object.values(game.state.clubs)) {
      expect(club.squadIds.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('keeps the pool alive across a season', () => {
    const game = createTestGame('rec-pool-rollover');
    const before = unattached(game).length;
    const matchdays = game.state.season.calendar.length;
    for (let i = 0; i < matchdays; i++) advanceWeek(game.state, { instant: true });
    // The season finished; rolling over refreshes the pool.
    startNextSeason(game.state);
    const after = unattached(game).length;
    expect(after).toBeGreaterThan(5);
    expect(Math.abs(after - before)).toBeLessThan(before);
    // Nothing dangles after the refresh.
    expect(rebuildRelationshipIndex(game.state).duplicates).toBe(0);
  });
});

describe('discovery', () => {
  it('looks in the local area first', () => {
    const game = createTestGame('rec-local');
    const pool = candidatePool(game.state, game.state.userClubId);
    expect(pool.length).toBeGreaterThan(20);
    for (const entry of pool) {
      expect(entry.player.clubId).not.toBe(game.state.userClubId);
    }
    // A player is more likely to be found if he lives near the club.
    const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    const nearest = pool.slice(0, 10).map((entry) => entry.distanceKm);
    const everyone = pool.map((entry) => entry.distanceKm);
    expect(mean(nearest)).toBeLessThan(mean(everyone));
  });

  it('finds players through five-a-side, with a trail of how', () => {
    const game = createTestGame('rec-five');
    const result = lookAtFiveASide(game.state);
    expect(result.discovered.length).toBeGreaterThan(0);
    expect(result.messages.join(' ')).toMatch(/five-a-side|leisure centre|caged/i);

    for (const id of result.discovered) {
      const candidate = candidateOf(game.state, id)!;
      expect(candidate.discoveredVia).toBe('five-a-side');
      expect(candidate.history.length).toBeGreaterThan(0);
      expect(candidate.history[0]!.description.length).toBeGreaterThan(5);
      expect(Object.keys(candidate.knowledge.attributes).length).toBeGreaterThan(0);
    }

    // Once a week is enough.
    const again = lookAtFiveASide(game.state);
    expect(again.discovered).toHaveLength(0);
  });

  it('brings in whoever turns up to an open session, good or bad', () => {
    const game = createTestGame('rec-session');
    const club = game.state.clubs[game.state.userClubId]!;
    const balanceBefore = club.finances.balance;
    const result = holdOpenSession(game.state);

    expect(result.discovered.length).toBeGreaterThan(0);
    expect(club.finances.balance).toBeLessThan(balanceBefore);
    expect(result.events.some((event) => event.type === 'recruitment')).toBe(true);

    // Every attendee has been seen, none of them completely.
    const assessable = assessableAttributeKeys(false).length;
    for (const id of result.discovered) {
      const candidate = candidateOf(game.state, id)!;
      const counts = knowledgeCounts(candidate.knowledge);
      expect(counts.total).toBeGreaterThan(0);
      expect(counts.known).toBeGreaterThan(0);
      expect(counts.total).toBeLessThan(assessable + 6);
      expect(candidate.trials).toBe(1);
      expect(candidate.status).toBe('trialled');
      for (const key of Object.keys(candidate.knowledge.attributes)) {
        expect(key.startsWith('hidden.')).toBe(false);
      }
    }
  });

  it('has players approach the club for plausible reasons, and not every week', () => {
    const game = createTestGame('rec-approach');
    const matchdays = game.state.season.calendar.length;
    for (let i = 0; i < matchdays; i++) {
      advanceWeek(game.state, { instant: true });
    }

    const approaches = candidatesOf(game.state).filter((entry) => entry.discoveredVia === 'approach');
    expect(approaches.length).toBeGreaterThan(0);
    // One a week at most: an approach is something that happened, not a tap.
    expect(approaches.length).toBeLessThan(matchdays);
    for (const candidate of approaches) {
      expect(candidate.sourceNote).toMatch(/asked about a game|got in touch|knows/i);
    }
  });
});

describe('recommendations', () => {
  it('come from real relationships and say where they came from', () => {
    const game = createTestGame('rec-recommend');
    const result = requestRecommendations(game.state);
    expect(result.discovered.length).toBeGreaterThan(0);

    for (const id of result.discovered) {
      const candidate = candidateOf(game.state, id)!;
      expect(candidate.discoveredVia).toBe('recommendation');
      expect(candidate.sourcePersonId).toBeTruthy();
      const recommender = game.state.people[candidate.sourcePersonId!]!;
      expect(isPlayer(recommender) && recommender.clubId).toBe(game.state.userClubId);
      // The recommender genuinely knows the lad.
      expect(getRelationship(game.state, recommender.id, id)).toBeDefined();
      expect(candidate.sourceNote.length).toBeGreaterThan(10);
      const counts = knowledgeCounts(candidate.knowledge);
      expect(counts.reported).toBeGreaterThan(0);
    }
  });

  it('are more reliable from somebody who knows the player and is trusted', () => {
    const game = createTestGame('rec-reliability');
    const club = game.state.clubs[game.state.userClubId]!;
    const managerId = club.managerId!;
    const pool = localUnattached(game);
    const squadPlayers = squad(game);

    const best = squadPlayers
      .map((player) => ({ player, strength: getRelationship(game.state, player.id, pool.id)?.strength ?? 0 }))
      .sort((a, b) => b.strength - a.strength);
    const close = best[0]!.player;
    const distant = best[best.length - 1]!.player;

    // One is a trusted, reliable mate. The other barely knows him and is not
    // the sort of lad you take at his word.
    close.attributes.behavioural.reliability = 19;
    close.attributes.hidden.consistency = 18;
    distant.attributes.behavioural.reliability = 3;
    distant.attributes.hidden.consistency = 4;
    recordInteraction(game.state, {
      aId: close.id,
      bId: managerId,
      aToB: { trust: 60, friendship: 60 },
      description: 'Steady pair of hands',
    });
    recordInteraction(game.state, {
      aId: distant.id,
      bId: managerId,
      aToB: { trust: -100, friendship: -60, tension: 40 },
      description: 'Never know where you are with him',
    });
    upsertRelationship(game.state, {
      aId: close.id,
      bId: pool.id,
      origin: 'former-teammates',
      aToB: { friendship: 90, trust: 85 },
      bToA: { friendship: 88, trust: 84 },
    });

    const trustedAccuracy = accuracyOf(game, close, pool);
    const vagueAccuracy = accuracyOf(game, distant, pool);
    expect(trustedAccuracy).toBeGreaterThan(vagueAccuracy + 0.08);

    const trustedRead = knowledgeFromRecommendation(game.state, new Rng('trusted'), {
      candidate: pool,
      recommender: close,
      date: game.state.date,
    });
    const vagueRead = knowledgeFromRecommendation(game.state, new Rng('vague'), {
      candidate: pool,
      recommender: distant,
      date: game.state.date,
    });
    expect(trustedRead.credibility).toBeGreaterThan(vagueRead.credibility);
    expect(Object.keys(trustedRead.knowledge.attributes).length).toBeGreaterThanOrEqual(
      Object.keys(vagueRead.knowledge.attributes).length,
    );
  });

  it('can be a warning rather than a recommendation', () => {
    const game = createTestGame('rec-warning');
    const target = localUnattached(game);
    const asker = squad(game)[0]!;

    // These two genuinely cannot stand each other.
    upsertRelationship(game.state, {
      aId: asker.id,
      bId: target.id,
      origin: 'former-teammates',
      aToB: { friendship: 2, trust: 5, tension: 85 },
      bToA: { friendship: 2, trust: 5, tension: 85 },
    });

    const read = knowledgeFromRecommendation(game.state, new Rng('warning'), {
      candidate: target,
      recommender: asker,
      date: game.state.date,
    });
    expect(read.sentiment).toBe('warning');
    expect(read.note).toMatch(/don't bother|never turns up|always injured|trouble/i);

    // A hostile source runs a player down rather than talking him up.
    const truth = attitudeBands(target);
    let offset = 0;
    for (let i = 0; i < 200; i++) {
      const sample = knowledgeFromRecommendation(game.state, new Rng(`warning-${i}`), {
        candidate: target,
        recommender: asker,
        date: game.state.date,
      });
      for (const [key, entry] of Object.entries(sample.knowledge.attributes)) {
        offset += bandIndex(entry.band) - bandIndex(truth.get(key) ?? entry.band);
      }
    }
    expect(offset).toBeLessThan(0);
  });
});

describe('information', () => {
  it('starts incomplete, and grows when the manager goes to watch somebody', () => {
    const game = createTestGame('rec-knowledge');
    requestRecommendations(game.state);
    const candidate = candidatesOf(game.state)[0]!;
    const before = knowledgeCounts(candidate.knowledge).total;
    const assessable = assessableAttributeKeys(
      (game.state.people[candidate.personId] as Player).preferredPosition === 'GK',
    ).length;
    expect(before).toBeLessThan(assessable);

    const result = observeCandidate(game.state, candidate.personId);
    expect(result.messages.length).toBeGreaterThan(0);
    const after = knowledgeCounts(candidate.knowledge);
    expect(after.total).toBeGreaterThan(before);
    expect(after.known).toBeGreaterThan(0);
    expect(candidate.history[0]!.description).toMatch(/watch|look/i);

    // One trip out a week is plenty.
    const other = candidatesOf(game.state)[1];
    if (other) {
      const second = observeCandidate(game.state, other.personId);
      expect(second.messages[0]).toMatch(/already/i);
    }
  });

  it('never bands a hidden characteristic', () => {
    const game = createTestGame('rec-hidden');
    requestRecommendations(game.state);
    lookAtFiveASide(game.state);
    holdOpenSession(game.state);
    const keys = candidatesOf(game.state).flatMap((candidate) => Object.keys(candidate.knowledge.attributes));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith('hidden.')).toBe(false);
      expect(key.startsWith('behavioural.')).toBe(false);
    }
  });

  it('tells the manager what a trial showed without telling him everything', () => {
    const game = createTestGame('rec-trial-knowledge');
    const candidate = localUnattached(game);
    void candidate.attributes.behavioural;
    const read = knowledgeFromTrial(new Rng('trial'), {
      candidate,
      date: game.state.date,
      clubQuality: 10,
    });
    const assessable = assessableAttributeKeys(candidate.preferredPosition === 'GK').length;
    expect(Object.keys(read.knowledge.attributes).length).toBeGreaterThan(2);
    expect(Object.keys(read.knowledge.attributes).length).toBeLessThan(assessable);
    expect(['impressed', 'mixed', 'poor']).toContain(read.impression);
    expect(read.summary.length).toBeGreaterThan(10);

    // Different players genuinely make different impressions.
    const impressions = new Set(
      unattached(game)
        .slice(0, 20)
        .map(
          (player, index) =>
            knowledgeFromTrial(new Rng(`impression-${index}`), {
              candidate: player,
              date: game.state.date,
              clubQuality: 10,
            }).impression,
        ),
    );
    expect(impressions.size).toBeGreaterThan(1);
  });
});

describe('joining', () => {
  it('takes the player through invite, session and signing, updating everything', () => {
    const game = createTestGame('rec-join');
    const club = game.state.clubs[game.state.userClubId]!;
    const managerId = club.managerId!;
    const candidate = localUnattached(game);

    // Word reaches the manager through a teammate.
    const teammate = squad(game).find((player) => player.id !== managerId && player.id !== candidate.id)!;
    upsertRelationship(game.state, {
      aId: teammate.id,
      bId: candidate.id,
      origin: 'former-teammates',
      aToB: { friendship: 88, trust: 80 },
      bToA: { friendship: 86, trust: 78 },
    });
    requestRecommendations(game.state);
    // Whether the manager hears the specific name this week is down to the
    // squad, so the flow below starts from the name being on the list.
    if (!candidateOf(game.state, candidate.id)) {
      addCandidate(game.state, {
        personId: candidate.id,
        discoveredVia: 'recommendation',
        sourcePersonId: teammate.id,
        sourceNote: `${teammate.firstName} ${teammate.surname} reckons he could do a job.`,
        knowledge: emptyKnowledge(),
      });
    }
    const candidateRecord = candidateOf(game.state, candidate.id)!;
    expect(candidateRecord.discoveredVia).toBe('recommendation');
    expect(candidateRecord.sourcePersonId).toBe(teammate.id);

    // Invite him down and run the session.
    // Somebody who is not even available this week cannot come down to anything.
    candidate.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
    const invited = inviteToTrial(game.state, candidate.id);
    expect(invited.ok).toBe(true);
    const session = runTrialSession(game.state);
    expect(session.outcomes.some((outcome) => outcome.personId === candidate.id && outcome.attended)).toBe(true);
    expect(candidateRecord.trials).toBe(1);
    expect(knowledgeCounts(candidateRecord.knowledge).total).toBeGreaterThan(0);

    // Ask, then sign.
    const asked = approachCandidate(game.state, candidate.id);
    expect(asked.message.length).toBeGreaterThan(0);
    publishEvents(game.state, asked.events);
    const before = club.squadIds.length;
    const signed = signCandidate(game.state, candidate.id);
    publishEvents(game.state, signed.events);

    if (!signed.signed) {
      // He is allowed to say no, and the record says why.
      expect(candidateRecord.status).toBe('declined');
      expect(candidateRecord.outcome).toBeTruthy();
      expect(club.squadIds.length).toBe(before);
      return;
    }

    const person = game.state.people[candidate.id] as Player;
    expect(club.squadIds).toContain(candidate.id);
    expect(club.squadIds.length).toBe(before + 1);
    expect(person.clubId).toBe(club.id);
    expect(person.registered).toBe(true);
    expect(person.joinedClubOn).toBe(game.state.date);
    expect(person.notes.some((note) => /Joined/.test(note))).toBe(true);
    expect(club.history.notableEvents[0]!.description).toMatch(/Signed/);
    expect(candidateRecord.status).toBe('joined');
    expect(candidateRecord.history.some((entry) => /Joined/.test(entry.description))).toBe(true);

    // The signing has a social side: a relationship with the manager, a bond
    // with the recommender, and a dressing room to get to know.
    expect(getRelationship(game.state, candidate.id, managerId)).toBeDefined();
    const withRecommender = getRelationship(game.state, teammate.id, candidate.id)!;
    expect(withRecommender.history.some((entry) => /name forward|came off/i.test(entry.description))).toBe(true);
    expect(relationshipViewsFor(game.state, candidate.id).length).toBeGreaterThan(1);
    expect(rebuildRelationshipIndex(game.state).duplicates).toBe(0);

    // Registration is news.
    expect(game.state.news.some((item) => /signs for/i.test(item.headline))).toBe(true);
  });

  it('lets players say no, and keeps the squad as it was', () => {
    const game = createTestGame('rec-declines');
    const club = game.state.clubs[game.state.userClubId]!;
    const squadBefore = [...club.squadIds];

    // A settled player at the far end of the county, perfectly happy where he is.
    const far = allPlayers(game)
      .filter((player) => player.clubId && player.clubId !== club.id)
      .sort((a, b) => {
        const distanceOf = (player: Player): number => {
          const hisClub = game.state.clubs[player.clubId!]!;
          const a0 = game.state.world.towns[club.townId]!;
          const b0 = game.state.world.towns[hisClub.townId]!;
          return Math.hypot(a0.x - b0.x, a0.y - b0.y);
        };
        return distanceOf(b) - distanceOf(a);
      })[0]!;
    upsertRelationship(game.state, {
      aId: far.id,
      bId: game.state.clubs[far.clubId!]!.managerId!,
      origin: 'player-manager',
      aToB: { trust: 92, loyalty: 95, friendship: 80, tension: 0 },
      bToA: { trust: 85, loyalty: 88 },
    });
    addCandidate(game.state, {
      personId: far.id,
      discoveredVia: 'contact',
      sourceNote: 'Somebody mentioned him at the pub.',
      knowledge: emptyKnowledge(),
    });

    const declined = signCandidate(game.state, far.id);
    expect(declined.signed).toBe(false);
    expect(declined.message).toMatch(/said no/i);
    expect(club.squadIds).toEqual(squadBefore);

    const record = candidateOf(game.state, far.id)!;
    expect(record.status).toBe('declined');
    expect(record.outcome).toBeTruthy();
    expect(record.history.some((entry) => /turn/i.test(entry.description))).toBe(true);
    expect(game.state.people[far.id] && (game.state.people[far.id] as Player).clubId).not.toBe(club.id);
  });

  it('takes a player off another club, and that club notices', () => {
    const game = createTestGame('rec-poach');
    const club = game.state.clubs[game.state.userClubId]!;
    const pool = candidatePool(game.state, club.id)
      .filter((entry) => !entry.unattached)
      .slice(0, 12);

    let signedId: PersonId | null = null;
    let previousClubId: ClubId | null = null;
    for (const entry of pool) {
      const clubIdBefore = entry.player.clubId;
      // You can only sign somebody you have heard about.
      addCandidate(game.state, {
        personId: entry.player.id,
        discoveredVia: 'contact',
        sourceNote: 'A local contact mentioned him.',
        knowledge: emptyKnowledge(),
      });
      const result = signCandidate(game.state, entry.player.id);
      if (result.signed) {
        signedId = entry.player.id;
        previousClubId = clubIdBefore;
        break;
      }
    }
    expect(signedId).toBeTruthy();
    expect(previousClubId).toBeTruthy();
    const person = game.state.people[signedId!] as Player;
    const previousClub = game.state.clubs[previousClubId!]!;
    const previousManagerId = previousClub.managerId!;
    const rivalryBefore = previousClub.rivalries[club.id]?.intensity ?? 0;

    expect(previousClub.squadIds).not.toContain(person.id);
    expect(club.squadIds).toContain(person.id);
    // Taking a player off them does not go unnoticed, whatever the rivalry was.
    expect(previousClub.rivalries[club.id]).toBeDefined();
    expect(previousClub.rivalries[club.id]!.intensity).toBeGreaterThanOrEqual(Math.max(rivalryBefore, 10));
    expect(previousClub.rivalries[club.id]!.note).toMatch(/took/i);
    expect(club.rivalries[previousClubId!]).toBeDefined();
    // The player's relationship with the manager he left has cooled.
    const withOldManager = getRelationship(game.state, person.id, previousManagerId);
    expect(withOldManager).toBeDefined();
    expect(withOldManager!.history.some((entry) => /moved on/i.test(entry.description))).toBe(true);
    expect(rebuildRelationshipIndex(game.state).duplicates).toBe(0);
  });

  it('lets the manager pass on somebody', () => {
    const game = createTestGame('rec-pass');
    requestRecommendations(game.state);
    const candidate = candidatesOf(game.state)[0]!;
    passOnCandidate(game.state, candidate.personId);
    expect(candidate.status).toBe('passed');
    expect(candidate.outcome).toBeTruthy();
  });
});

describe('willingness', () => {
  it('explains itself in terms of the players own life', () => {
    const game = createTestGame('rec-interest');
    const club = game.state.clubs[game.state.userClubId]!;
    const local = localUnattached(game);
    const assessment = candidateInterest(game.state, local.id, club.id);
    expect(assessment.score).toBeGreaterThan(0);
    expect(assessment.score).toBeLessThanOrEqual(100);
    expect(assessment.reasons.length).toBeGreaterThan(0);
    expect(assessment.reasons.some((reason) => /not registered|doorstep|on my/i.test(reason.text))).toBe(true);

    // A settled player at his own club is harder to move.
    const settled = allPlayers(game).find((player) => player.clubId && player.clubId !== club.id)!;
    const settledManagerId = game.state.clubs[settled.clubId!]!.managerId!;
    recordInteraction(game.state, {
      aId: settled.id,
      bId: settledManagerId,
      aToB: { trust: 80, loyalty: 80, tension: -40 },
      description: 'Loves it there',
    });
    const settledAssessment = candidateInterest(game.state, settled.id, club.id);
    expect(settledAssessment.score).toBeLessThan(assessment.score);
  });
});

describe('squad needs', () => {
  it('flags the area the squad is short in', () => {
    const game = createTestGame('rec-needs');
    const club = game.state.clubs[game.state.userClubId]!;
    const needs = squadNeeds(game.state, club.id);
    expect(needs.positions).toHaveLength(4);
    expect(needs.byPosition.GK).toBeGreaterThan(0);

    // Take the back line down to two registered defenders.
    const defenders = club.squadIds.filter((id) => {
      const person = game.state.people[id];
      return isPlayer(person) && person.positionGroup === 'DEF';
    });
    const keep = new Set(defenders.slice(0, 2));
    club.squadIds = club.squadIds.filter((id) => !defenders.includes(id) || keep.has(id));
    const thinned = squadNeeds(game.state, club.id);
    expect(thinned.thinGroups).toContain('DEF');
    expect(thinned.positions.find((need) => need.group === 'DEF')!.verdict).toBe('thin');
    expect(thinned.summary.join(' ')).toMatch(/Defender/);
  });
});

describe('recruitment persistence', () => {
  it('keeps the list, the knowledge and the paper trail across a save', () => {
    const game = createTestGame('rec-save');
    requestRecommendations(game.state);
    holdOpenSession(game.state);
    lookAtFiveASide(game.state);
    const before = candidatesOf(game.state);
    expect(before.length).toBeGreaterThan(0);

    const loaded = deserialiseGame(serialiseGame(game.state));
    expect(loaded.error).toBeNull();
    const restored = loaded.state!;
    const after = candidatesOf(restored);
    expect(after.length).toBe(before.length);

    const sample = after.find((candidate) => Object.keys(candidate.knowledge.attributes).length > 0)!;
    const original = before.find((candidate) => candidate.personId === sample.personId)!;
    expect(Object.keys(sample.knowledge.attributes).length).toBe(Object.keys(original.knowledge.attributes).length);
    expect(sample.history.length).toBe(original.history.length);
    expect(sample.sourceNote).toBe(original.sourceNote);
    expect(sample.discoveredVia).toBe(original.discoveredVia);
  });

  it('adds the local faces to a save made before recruitment existed', () => {
    const game = createTestGame('rec-migrate');
    const legacy = JSON.parse(serialiseGame(game.state)) as {
      version: number;
      state: Record<string, unknown> & { people: Record<string, Player>; relationships?: unknown };
    };
    legacy.version = 2;
    delete legacy.state.recruitment;
    // A version 2 save has a social fabric but no unattached pool.
    for (const id of Object.keys(legacy.state.people)) {
      if (id.startsWith('free_start_')) delete legacy.state.people[id];
    }

    const loaded = deserialiseGame(JSON.stringify(legacy));
    expect(loaded.error).toBeNull();
    const restored = loaded.state!;
    expect(restored.version).toBe(GAME_STATE_VERSION);
    expect(restored.recruitment).toBeDefined();
    expect(Object.keys(restored.recruitment.candidates)).toHaveLength(0);

    const pool = Object.values(restored.people).filter((person): person is Player => isPlayer(person) && person.clubId === null);
    expect(pool.length).toBeGreaterThan(5);
    for (const player of pool) {
      expect(relationshipViewsFor(restored, player.id).length).toBeGreaterThan(0);
    }
    expect(rebuildRelationshipIndex(restored).duplicates).toBe(0);

    // And the imported world is immediately usable.
    const result = requestRecommendations(restored);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe('recruitment in the weekly loop', () => {
  it('survives a week of simulation with its records intact', () => {
    const game = createTestGame('rec-week');
    requestRecommendations(game.state);
    const store = recruitmentStore(game.state);
    const before = candidatesOf(game.state).length;

    advanceWeek(game.state, { instant: true });

    expect(candidatesOf(game.state).length).toBeGreaterThanOrEqual(before);
    expect(store.lastAskedOn).toBeDefined();
    for (const candidate of candidatesOf(game.state)) {
      expect(candidate.history.length).toBeGreaterThan(0);
      expect(candidate.personId).toBeTruthy();
      expect(game.state.people[candidate.personId]).toBeDefined();
    }
  });
});
