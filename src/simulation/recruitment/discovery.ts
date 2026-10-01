import type { GameState } from '@/domain/game';
import type { ClubId, PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isPlayer, personDisplayName, type Player } from '@/domain/person';
import { RELATIONSHIP_ORIGIN_LABEL, attitudeOf } from '@/domain/relationship';
import type { PositionGroup } from '@/domain/positions';
import type { RecruitmentCandidate } from '@/domain/recruitment';
import { addLedgerEntry } from '../finance';
import { createEvent } from '../news';
import { getRelationship, personName, relationshipViewsFor } from '../relationships';
import { Rng, stream } from '../rng';
import { travelKm } from './interest';
import {
  abilityBandOf,
  knowledgeFromObservation,
  knowledgeFromRecommendation,
  knowledgeFromTrial,
  meanAttributeOf,
} from './knowledge';
import { squadNeeds, squadQuality } from './needs';
import { addCandidate, candidateOf, candidatesOf, recruitmentStore, recordCandidateHistory } from './store';

/**
 * Where players come from.
 *
 * Nothing here searches a database. A name reaches the manager because somebody
 * he knows mentioned it, because he was down at five-a-side, because a lad
 * turned up to an open session, or because the player himself asked about a
 * game. Each route leaves a trail of who said what.
 */

export interface DiscoveryResult {
  events: GameEvent[];
  discovered: PersonId[];
  /** Human-readable lines for the notice bar. */
  messages: string[];
}

function emptyResult(): DiscoveryResult {
  return { events: [], discovered: [], messages: [] };
}

export interface PoolEntry {
  player: Player;
  distanceKm: number;
  unattached: boolean;
  /** How many people the manager's club already has a link to him through. */
  links: number;
}

/**
 * Everybody in the local football world who could plausibly be found — the
 * unattached, and players at other clubs nearby. Ordered nearest first, because
 * that is how local football works.
 */
export function candidatePool(state: GameState, clubId: ClubId): PoolEntry[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const clubMemberIds = new Set(club.squadIds);

  const entries: PoolEntry[] = [];
  for (const person of Object.values(state.people)) {
    if (!isPlayer(person) || person.id === (club.managerId ?? '')) continue;
    if (person.clubId === clubId) continue;
    if (clubMemberIds.has(person.id)) continue;
    const distanceKm = travelKm(state, club.townId, person.townId);
    const links = relationshipViewsFor(state, person.id).filter((view) => clubMemberIds.has(view.otherId)).length;
    entries.push({ player: person, distanceKm, unattached: person.clubId === null, links });
  }

  return entries.sort((a, b) => {
    const aScore = a.distanceKm - a.links * 4 - (a.unattached ? 3 : 0);
    const bScore = b.distanceKm - b.links * 4 - (b.unattached ? 3 : 0);
    return aScore - bScore;
  });
}

/** Where the Wednesday-night football happens near a club. */
export function fiveASideVenueFor(state: GameState, townId: string): { townId: string; name: string } {
  const town = state.world.towns[townId];
  if (!town) return { townId, name: 'the local sports hall' };
  const cagedGround = state.world.groundIds
    .map((id) => state.world.grounds[id])
    .find((ground) => ground && ground.townId === townId && ground.surface === '3G');
  if (cagedGround) return { townId, name: `${cagedGround.name} (the caged pitch)` };
  return { townId, name: `${town.name} Leisure Centre` };
}

/** Weighting that makes a genuinely good player stand out in a casual game. */
function standoutWeight(player: Player): number {
  return Math.max(0.6, 1 + (meanAttributeOf(player) - 9) * 0.9);
}

function rngFor(state: GameState, ...label: Array<string | number>): Rng {
  return stream(state.seed, 'recruitment', ...label);
}

/**
 * Ask the lads for names. This is the heart of local recruitment: what comes
 * back depends on who you ask, how much they think of you, how well they know
 * the lad, and whether they want him out of their own dressing room.
 */
export function requestRecommendations(state: GameState): DiscoveryResult {
  const result = emptyResult();
  const club = state.clubs[state.userClubId];
  if (!club) return result;
  const store = recruitmentStore(state);
  if (store.lastAskedOn === state.date) {
    result.messages.push('You have had the lads thinking about it once this week already.');
    return result;
  }
  const needs = squadNeeds(state, club.id);
  const rng = rngFor(state, 'recommendations', state.date);
  store.lastAskedOn = state.date;

  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  if (squad.length === 0) {
    result.messages.push('There is nobody in the squad to ask yet.');
    return result;
  }

  const managerId = club.managerId;
  const squadIds = new Set(squad.map((player) => player.id));
  const alreadyOnList = new Set(candidatesOf(state).map((candidate) => candidate.personId));

  // Work the other way round from a search: find the lads in the area that
  // somebody in the dressing room actually knows, then work out who would be
  // the one to mention him.
  const options: Array<{ candidate: Player; recommender: Player; weight: number }> = [];

  for (const entry of candidatePool(state, club.id)) {
    const candidate = entry.player;
    const linked = relationshipViewsFor(state, candidate.id)
      .filter((view) => squadIds.has(view.otherId) && view.relationship.strength >= 30)
      .map((view) => ({ recommender: state.people[view.otherId], strength: view.relationship.strength }))
      .filter((link): link is { recommender: Player; strength: number } => isPlayer(link.recommender))
      .filter((link) => link.recommender.availability.status !== 'unavailable');
    if (linked.length === 0) continue;

    // The man who mentions him is the one who knows him best, with a nudge
    // towards the lads whose word you already trust.
    linked.sort((a, b) => influenceOf(state, b.recommender, managerId, b.strength) - influenceOf(state, a.recommender, managerId, a.strength));
    const recommender = linked[0]!.recommender;

    let weight = 0.55 + linked[0]!.strength / 40;
    if (needs.thinGroups.includes(candidate.positionGroup)) weight += 0.9;
    if (entry.unattached) weight += 0.35;
    weight -= Math.min(1.2, entry.distanceKm / 12);
    if (alreadyOnList.has(candidate.id)) weight -= 0.5;
    options.push({ candidate, recommender, weight: Math.max(0.15, weight) });
  }

  if (options.length === 0) {
    result.messages.push('Nobody in the squad knows anybody who is after a game at the moment.');
    return result;
  }

  const pool = [...options];
  const wanted = Math.min(pool.length, rng.int(1, 3));
  for (let i = 0; i < wanted; i++) {
    const pick = rng.weighted(pool.map((entry) => ({ value: entry, weight: entry.weight })));
    pool.splice(pool.indexOf(pick), 1);

    const read = knowledgeFromRecommendation(state, rng, {
      candidate: pick.candidate,
      recommender: pick.recommender,
      date: state.date,
    });
    addCandidate(state, {
      personId: pick.candidate.id,
      discoveredVia: 'recommendation',
      sourcePersonId: pick.recommender.id,
      sourceNote: read.note,
      sentiment: read.sentiment,
      knowledge: read.knowledge,
    });
    result.discovered.push(pick.candidate.id);
    result.messages.push(read.note);
  }

  return result;
}

/** How much weight a lad's word carries: how well he knows the player, and you him. */
function influenceOf(state: GameState, recommender: Player, managerId: PersonId | null, strength: number): number {
  const withManager = managerId ? getRelationship(state, recommender.id, managerId) : undefined;
  const trust = withManager ? attitudeOf(withManager, recommender.id)!.trust : 50;
  const reliability = recommender.attributes.behavioural.reliability * 5;
  return strength + trust * 0.4 + reliability * 0.2;
}

/** A night down at five-a-side: the other half of local recruitment. */
export function lookAtFiveASide(state: GameState): DiscoveryResult {
  const result = emptyResult();
  const club = state.clubs[state.userClubId];
  if (!club) return result;
  const store = recruitmentStore(state);
  if (store.lastFiveASideOn === state.date) {
    result.messages.push('You were down there earlier in the week.');
    return result;
  }
  const rng = rngFor(state, 'five-a-side', state.date);
  store.lastFiveASideOn = state.date;

  const venue = fiveASideVenueFor(state, club.townId);
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);

  const pool = Object.values(state.people)
    .filter((person): person is Player => isPlayer(person))
    .filter((player) => player.clubId !== club.id)
    .filter((player) => travelKm(state, venue.townId, player.townId) <= 6)
    .filter((player) => player.age <= 42);

  if (pool.length === 0) {
    result.messages.push('Nothing doing down there this week.');
    return result;
  }

  // A better player stands out, but only two or three really catch the eye.
  const scarred = rng.shuffle(pool).map((player) => ({ player, score: standoutWeight(player) * (0.55 + rng.next()) }));
  scarred.sort((a, b) => b.score - a.score);
  const picks = scarred.slice(0, rng.int(1, 2)).map((entry) => entry.player);

  for (const candidate of picks) {
    // If somebody from the squad plays there too, they are how the name reaches you.
    const via = squad.find((player) => {
      const relationship = getRelationship(state, player.id, candidate.id);
      return Boolean(relationship && relationship.strength >= 30);
    });
    const sourceNote = via
      ? `${personDisplayName(via)} mentioned a lad from the five-a-side at ${venue.name}.`
      : `You had a run out at ${venue.name} and he stood out.`;
    const read = knowledgeFromObservation(rng, {
      candidate,
      date: state.date,
      context: via
        ? `You went down to ${venue.name} on Wednesday and watched him`
        : `You played against him at ${venue.name} on Wednesday`,
    });
    addCandidate(state, {
      personId: candidate.id,
      discoveredVia: 'five-a-side',
      sourcePersonId: via?.id ?? null,
      sourceNote,
      sentiment: 'neutral',
      knowledge: read.knowledge,
    });
    result.discovered.push(candidate.id);
    result.messages.push(`${sourceNote} ${read.summary}`);
  }

  return result;
}

/**
 * An open session: the manager hires the pitch, puts the word out, and whoever
 * turns up turns up. Some of them can play. Several cannot.
 */
export function holdOpenSession(state: GameState): DiscoveryResult {
  const result = emptyResult();
  const club = state.clubs[state.userClubId];
  if (!club) return result;
  const store = recruitmentStore(state);
  if (store.lastOpenSessionOn === state.date) {
    result.messages.push('There has already been a session this week.');
    return result;
  }
  const rng = rngFor(state, 'open-session', state.date);
  store.lastOpenSessionOn = state.date;

  const cost = rng.int(18, 42);
  addLedgerEntry(state, club.id, {
    date: state.date,
    description: 'Open session — pitch hire and floodlights',
    category: 'pitch-hire',
    amount: -cost,
  });

  const clubQuality = squadQuality(state, club.id);
  const needs = squadNeeds(state, club.id);
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  const squadIds = new Set(squad.map((player) => player.id));

  const attendees: Array<{ player: Player; via: PersonId | null }> = [];
  const pool = candidatePool(state, club.id).filter((entry) => entry.distanceKm <= 12);

  // Somebody's mate is the most likely reason a stranger turns up.
  const mateLinks = pool.filter((entry) => entry.links > 0);
  if (mateLinks.length > 0 && rng.chance(0.75)) {
    const entry = rng.pick(rng.shuffle(mateLinks).slice(0, 5));
    const link = relationshipViewsFor(state, entry.player.id).find((view) => squadIds.has(view.otherId));
    attendees.push({ player: entry.player, via: link?.otherId ?? null });
  }

  const unattached = pool.filter((entry) => entry.unattached);
  const target = rng.int(2, 4);
  const fillPool = unattached.length >= target ? rng.shuffle(unattached) : rng.shuffle(pool);
  for (const entry of fillPool) {
    if (attendees.length >= target + 1) break;
    if (attendees.some((attendee) => attendee.player.id === entry.player.id)) continue;
    attendees.push({ player: entry.player, via: null });
  }

  if (attendees.length === 0) {
    result.messages.push(`You advertised the session (costing £${cost}) and nobody turned up.`);
    return result;
  }

  const lines: string[] = [];
  for (const attendee of attendees) {
    const read = knowledgeFromTrial(rng, {
      candidate: attendee.player,
      date: state.date,
      clubQuality,
      sessionLabel: 'An open session',
    });
    const record = addCandidate(state, {
      personId: attendee.player.id,
      discoveredVia: 'open-session',
      sourcePersonId: attendee.via,
      sourceNote: attendee.via
        ? `${personName(state, attendee.via)} brought him along to the open session.`
        : `Turned up to the open session after seeing it advertised.`,
      sentiment: 'neutral',
      knowledge: read.knowledge,
    });
    record.trials += 1;
    record.status = 'trialled';
    const quality = abilityBandOf(attendee.player);
    if (needs.thinGroups.includes(attendee.player.positionGroup)) {
      mergeNeedNote(record, attendee.player);
    }
    recordCandidateHistory(state, record, `Turned up to the open session: ${read.summary}`, state.date);
    result.discovered.push(attendee.player.id);
    lines.push(`${personDisplayName(attendee.player)} (${attendee.player.preferredPosition}, ${quality}) — ${read.summary}`);
  }

  result.messages.push(`Open session at ${state.world.grounds[club.groundId]?.name ?? 'the Rec'}: ${lines.join(' ')}`);
  result.events.push(
    createEvent(state, {
      type: 'recruitment',
      importance: 2,
      clubIds: [club.id],
      personIds: attendees.map((attendee) => attendee.player.id),
      data: {
        headline: `${attendees.length} turned up to the open session`,
        body: `${lines.join(' ')} It cost £${cost} in pitch hire.`,
      },
    }),
  );
  return result;
}

function mergeNeedNote(record: RecruitmentCandidate, player: Player): void {
  const note = `Plays ${player.preferredPosition}, which is exactly what you are short of.`;
  if (!record.knowledge.notes.includes(note)) record.knowledge.notes.push(note);
}

/**
 * Players who come to you. Plausible conditions only: a mate at the club, a
 * club that needs his position, and a good reason to be looking around.
 */
export function weeklyApproaches(state: GameState): DiscoveryResult {
  const result = emptyResult();
  const club = state.clubs[state.userClubId];
  if (!club) return result;
  const rng = rngFor(state, 'approaches', state.date);
  const needs = squadNeeds(state, club.id);

  const squadIds = new Set(club.squadIds);
  const crowdFactor = club.squadIds.length < 20 ? 1.6 : needs.thinGroups.length > 1 ? 1.35 : 1;
  if (!rng.chance(0.16 * crowdFactor)) return result;

  const candidates = Object.values(state.people)
    .filter((person): person is Player => isPlayer(person))
    .filter((player) => player.clubId !== club.id)
    .filter((player) => travelKm(state, club.townId, player.townId) <= 14)
    .map((player) => {
      const friends = relationshipViewsFor(state, player.id).filter(
        (view) => squadIds.has(view.otherId) && view.attitude.friendship >= 55 && view.attitude.tension < 45,
      );
      const unattached = player.clubId === null;
      let weight = unattached ? 1.4 : 0.6;
      if (friends.length > 0) weight += 1.6;
      if (needs.thinGroups.includes(player.positionGroup)) weight += 1.1;
      if (player.age >= 33) weight += 0.3;
      return { player, friends, weight };
    })
    .filter((entry) => entry.weight > 0.7);

  if (candidates.length === 0) return result;
  const picked = rng.weighted(candidates.map((entry) => ({ value: entry, weight: entry.weight })));
  const friend = picked.friends[0]?.otherId ?? null;
  const relationship = friend ? getRelationship(state, friend, picked.player.id) : undefined;
  const origin = relationship ? RELATIONSHIP_ORIGIN_LABEL[relationship.origin].toLowerCase() : null;

  const note = friend
    ? `${picked.player.firstName} ${picked.player.surname} asked about a game — he knows ${personName(state, friend)}${
        origin ? ` (${origin})` : ''
      }.`
    : `${picked.player.firstName} ${picked.player.surname} got in touch asking whether you need anyone.`;

  const read = knowledgeFromObservation(rng, {
    candidate: picked.player,
    date: state.date,
    context: 'He came to you, so there is nothing to go on but your own eyes',
  });

  addCandidate(state, {
    personId: picked.player.id,
    discoveredVia: 'approach',
    sourcePersonId: friend,
    sourceNote: note,
    sentiment: 'neutral',
    knowledge: read.knowledge,
  });
  result.discovered.push(picked.player.id);
  result.messages.push(note);
  result.events.push(
    createEvent(state, {
      type: 'player-approach',
      importance: 2,
      clubIds: [club.id],
      personIds: [picked.player.id, ...(friend ? [friend] : [])],
      data: {
        headline: `${picked.player.firstName} ${picked.player.surname} asks about a game`,
        body: `${note} ${picked.player.age}, plays ${picked.player.preferredPosition}.`,
      },
    }),
  );
  return result;
}

/** Going to watch somebody. Once per matchday is enough for anybody. */
export function observeCandidate(state: GameState, personId: PersonId): DiscoveryResult {
  const result = emptyResult();
  const club = state.clubs[state.userClubId];
  const candidate = state.people[personId];
  const record = candidateOf(state, personId);
  if (!club || !isPlayer(candidate) || !record) return result;

  const store = recruitmentStore(state);
  if (store.lastWatchedOn === state.date) {
    result.messages.push('You have already been out to watch somebody this week.');
    return result;
  }
  const rng = rngFor(state, 'watch', state.date, personId);

  const context = candidate.clubId
    ? `You went to watch ${state.clubs[candidate.clubId]?.identity.name ?? 'his side'} play, with a particular eye on him`
    : `You had another look at him down at ${fiveASideVenueFor(state, candidate.townId ?? club.townId).name}`;

  const read = knowledgeFromObservation(rng, { candidate, date: state.date, context });
  record.knowledge = { attributes: read.knowledge.attributes, notes: [...new Set([...record.knowledge.notes, ...read.notes])] };
  record.lastReviewedOn = state.date;
  recordCandidateHistory(state, record, read.summary, state.date);
  store.lastWatchedOn = state.date;
  result.messages.push(read.summary);
  return result;
}

/** Everything the manager could act on this week. Kept in one place for the UI. */
export function discoverySummary(state: GameState): { candidates: number; need: PositionGroup[] } {
  return {
    candidates: candidatesOf(state).filter((candidate) => candidate.status === 'watching').length,
    need: squadNeeds(state, state.userClubId).thinGroups,
  };
}
