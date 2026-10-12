import { describe, expect, it } from 'vitest';
import { isPlayer } from '@/domain/person';
import { createTestGame } from './testSupport';
import { leagueCompetitions, tierOf } from './pyramid';
import { startNextSeason } from './season';
import type { ClubHistory } from '@/domain/club';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import {
  appealProceeds,
  CLUB_LIFECYCLE,
  divisionStanding,
  reviewClubFinances,
  type ClubLifecycleContext,
} from './clubLifecycle';
import { successorOf } from './queries';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import { isReformation } from './clubLifecycle';

type State = ReturnType<typeof createTestGame>['state'];

/** A club with seasons behind it, which is what a history is made of. */
function withSeasons(state: State, clubId: string, count: number): State['clubs'][string] {
  const club = state.clubs[clubId]!;
  for (let index = 0; index < count; index += 1) {
    const record: ClubHistory['seasons'][number] = {
      seasonId: `season_past_${index}`,
      seasonLabel: `20${20 + index}/2${index % 10}`,
      competitionName: 'Sunday League Division Two',
      tier: 2,
      played: 22,
      won: 9,
      drawn: 5,
      lost: 8,
      goalsFor: 34,
      goalsAgainst: 31,
      points: 32,
      finalPosition: 7,
    };
    club.history.seasons.push(record);
  }
  return club;
}

/**
 * The point of the cycle is that a club can die and the league survives it: a
 * club that cannot pay its way folds, and a new club takes its place in the same
 * town so the division never shrinks. These tests hold both halves.
 */

function contextFor(state: ReturnType<typeof createTestGame>['state'], index = 0): ClubLifecycleContext {
  return {
    seasonId: `season_lifecycle_${index}`,
    seasonLabel: `lifecycle ${index}`,
    seasonStart: state.season.startDate,
    divisions: leagueCompetitions(state).map((competition) => competition.clubIds),
  };
}

function firstNonUserClub(state: ReturnType<typeof createTestGame>['state']): string {
  const competition = Object.values(state.competitions)[0]!;
  return competition.clubIds.find((id) => id !== state.userClubId)!;
}

describe('club folding and reform', () => {
  it('folds a club in terminal debt and forms a new one in its place', () => {
    const { state } = createTestGame('club-folds');
    const competition = Object.values(state.competitions)[0]!;
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    const size = competition.clubIds.length;
    const squadIds = [...club.squadIds];
    const townId = club.townId;
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    const outcome = reviewClubFinances(state, contextFor(state));

    expect(outcome.folded.some((fold) => fold.clubId === clubId)).toBe(true);
    expect(state.clubs[clubId]!.active).toBe(false);
    expect(competition.clubIds).not.toContain(clubId);

    // Its people are gone from the world.
    for (const id of squadIds) expect(state.people[id]).toBeUndefined();

    // A new club formed in the same town, and the division kept its size.
    expect(competition.clubIds.length).toBe(size);
    const formed = outcome.formed[0]!;
    const replacement = state.clubs[formed.clubId]!;
    expect(replacement.active).toBe(true);
    expect(replacement.townId).toBe(townId);
    expect(replacement.squadIds.length).toBeGreaterThanOrEqual(11);
    expect(replacement.squadIds.filter((id) => isPlayer(state.people[id])).length).toBeGreaterThanOrEqual(11);
    expect(competition.clubIds).toContain(formed.clubId);
    expect(outcome.events.length).toBeGreaterThan(0);
  });

  it('gives a club in the red a few seasons to recover, and resets when it does', () => {
    const { state } = createTestGame('club-recovers');
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;

    club.finances.balance = -300;
    const first = reviewClubFinances(state, contextFor(state, 0));
    expect(first.folded.some((fold) => fold.clubId === clubId)).toBe(false);
    expect(club.finances.administrationSeasons).toBe(1);
    expect(club.active).toBe(true);

    club.finances.balance = 400; // a good season, a sponsor back
    reviewClubFinances(state, contextFor(state, 1));
    expect(club.finances.administrationSeasons).toBe(0);

    club.finances.balance = -150;
    const third = reviewClubFinances(state, contextFor(state, 2));
    expect(third.folded.some((fold) => fold.clubId === clubId)).toBe(false);
    expect(club.finances.administrationSeasons).toBe(1);
  });

  it('folds a club that cannot get out of the red after the grace period', () => {
    const { state } = createTestGame('club-grace');
    const competition = Object.values(state.competitions)[0]!;
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    const size = competition.clubIds.length;
    // A debt the committee's appeal cannot clear. The appeal is bounded by what
    // the club is worth to its own town, and that bound is the whole point: a
    // small debt is a recoverable one and a large one is not, so a club that
    // cannot get out of the red is now a club with a debt that is too big for
    // anybody to shake a bucket at.
    club.finances.balance = -2000;

    reviewClubFinances(state, contextFor(state, 0));
    reviewClubFinances(state, contextFor(state, 1));
    const third = reviewClubFinances(state, {
      ...contextFor(state, 2),
      seasonId: 'season_lifecycle_2b',
    });

    expect(third.folded.some((fold) => fold.clubId === clubId)).toBe(true);
    expect(club.active).toBe(false);
    expect(competition.clubIds.length).toBe(size);
  });

  /**
   * The club that forms in a folded club's place has to be in the ladder from
   * the moment it exists. It used to be pushed into last season's competition
   * record, which the new season was not built from — so it arrived in no
   * division at all, with no fixtures and no season record to archive.
   */
  it('puts a replacement club straight into the division its predecessor left', () => {
    const { state } = createTestGame('club-reform-division');
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    const tier = tierOf(state, clubId);
    const sizesBefore = leagueCompetitions(state).map((competition) => competition.clubIds.length);
    const knownBefore = new Set(leagueCompetitions(state).flatMap((competition) => [...competition.clubIds]));
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    startNextSeason(state);

    // The old club is off the ladder entirely, not merely inactive on it.
    expect(state.clubs[clubId]!.active).toBe(false);
    expect(leagueCompetitions(state).some((competition) => competition.clubIds.includes(clubId))).toBe(false);

    // The new club exists, is in exactly one division, and sits in the tier the
    // club it replaced played in.
    const replacement = Object.values(state.clubs).find(
      (candidate) => candidate.active && !knownBefore.has(candidate.id),
    );
    expect(replacement).toBeTruthy();
    const memberships = leagueCompetitions(state).filter((competition) =>
      competition.clubIds.includes(replacement!.id),
    );
    expect(memberships).toHaveLength(1);
    expect(tierOf(state, replacement!.id)).toBe(tier);

    // And it has this season's record already opened, so the season is archived.
    expect(replacement!.history.seasons.some((record) => record.seasonId === state.season.id)).toBe(true);

    // The ladder holds its size, which is the whole point of the cycle.
    expect(leagueCompetitions(state).map((competition) => competition.clubIds.length)).toEqual(sizesBefore);

    // Every active club is in exactly one division, both halves of the swap
    // having gone through the same ladder the season was actually built from.
    for (const candidate of Object.values(state.clubs)) {
      if (!candidate.active) continue;
      const count = leagueCompetitions(state).filter((competition) => competition.clubIds.includes(candidate.id)).length;
      expect(count).toBe(1);
    }
  });

  it('forms a distinct replacement for each club that folds, even in one town, each with its own chairman', () => {
    const { state } = createTestGame('club-reform-collision');
    // A town can hold more than one club and both can go under in one summer.
    // The replacement stream and id used to be keyed on the town, so the second
    // fold minted the same club again: one id in the division twice and two
    // fixtures on one afternoon.
    const byTown = new Map<string, string[]>();
    for (const club of Object.values(state.clubs)) {
      if (!club.active || club.id === state.userClubId) continue;
      byTown.set(club.townId, [...(byTown.get(club.townId) ?? []), club.id]);
    }
    const pair = [...byTown.values()].find((ids) => ids.length >= 2);
    expect(pair).toBeTruthy();
    const sizesBefore = leagueCompetitions(state).map((competition) => competition.clubIds.length);
    const knownBefore = new Set(leagueCompetitions(state).flatMap((competition) => [...competition.clubIds]));
    for (const clubId of pair!.slice(0, 2)) {
      state.clubs[clubId]!.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;
    }

    startNextSeason(state);

    const formed = Object.values(state.clubs).filter((club) => club.active && !knownBefore.has(club.id));
    expect(formed).toHaveLength(2);
    for (const replacement of formed) {
      const memberships = leagueCompetitions(state).filter((competition) =>
        competition.clubIds.includes(replacement.id),
      );
      expect(memberships).toHaveLength(1);
    }
    // Each replacement has its own man in the chair, and he is still in the
    // world. The chairman id used to be keyed on the season and the town while
    // the club id was keyed on the club it replaced, so two clubs folding in one
    // town in one summer minted the same chairman: the second overwrote the
    // first, both clubs named one man, and the day either club folded again the
    // fold deleted the officials it owned and left the other club naming a
    // chairman who no longer existed. The fifteen-season soak found the two
    // clubs still pointing at him three seasons after he had gone.
    expect(new Set(formed.map((club) => club.chairmanId)).size).toBe(formed.length);
    for (const replacement of formed) {
      const chairman = state.people[replacement.chairmanId ?? ''];
      expect(chairman, replacement.id).toBeDefined();
      expect(chairman!.kind).toBe('official');
      expect(chairman!.clubId).toBe(replacement.id);
    }

    // No club id is listed twice in any division, and the ladder holds its size.
    for (const competition of leagueCompetitions(state)) {
      expect(new Set(competition.clubIds).size).toBe(competition.clubIds.length);
    }
    expect(leagueCompetitions(state).map((competition) => competition.clubIds.length)).toEqual(sizesBefore);
  });

  /**
   * A new club plays at the standard of the division it steps into.
   *
   * It used to be minted at whatever standing its *town* drew, which has nothing
   * to do with the rung: measured on a generated county the bottom division's
   * clubs stand at 24–38 while the town draws for those same clubs run 25–41, so
   * a club folding in Division Three was routinely replaced by a Division Two
   * side. The rung that churns hardest climbed, and over fifteen seasons the
   * pyramid flattened towards itself (division 3 +3–6% while division 1 was
   * flat). The soak found it. The rung is the anchor now.
   */
  it('mints a replacement at the standing of the division it enters, not its town’s', () => {
    const { state } = createTestGame('club-reform-standing');
    const divisions = leagueCompetitions(state);
    const bottom = divisions[divisions.length - 1]!;
    // A weak rung, and an unmistakable one: every club in it stands in the same
    // place, so a replacement is either inside that band or it is not.
    for (const id of bottom.clubIds) state.clubs[id]!.reputation = 30;
    const foldedId = bottom.clubIds.find((id) => id !== state.userClubId)!;
    const folded = state.clubs[foldedId]!;
    folded.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    const outcome = reviewClubFinances(state, contextFor(state));
    const formed = outcome.formed.find((formation) => formation.townId === folded.townId);
    expect(formed).toBeTruthy();
    const replacement = state.clubs[formed!.clubId]!;

    // Same town, same ground — and the rung's standard, inside its band.
    expect(replacement.townId).toBe(folded.townId);
    expect(replacement.reputation).toBe(30);
  });

  it('reads a division’s standard off the clubs in it, and only the living', () => {
    const { state } = createTestGame('club-rung-reading');
    const divisions = leagueCompetitions(state);
    const bottom = divisions[divisions.length - 1]!;
    const ids = bottom.clubIds;
    // A known ladder inside one rung: 20, 21, 22 … so the middle is arithmetic.
    ids.forEach((id, index) => {
      state.clubs[id]!.reputation = 20 + index;
    });

    expect(divisionStanding(state, ids)).toEqual({ low: 20, median: 26, high: 31 });

    // A club that has folded is no evidence of the standard it was playing at.
    state.clubs[ids[0]!]!.active = false;
    expect(divisionStanding(state, ids)).toEqual({ low: 21, median: 26, high: 31 });

    // And a rung emptied in one pass has nothing to read, so it falls back to
    // the town — which is the caller's business, not this function's.
    expect(divisionStanding(state, [])).toBeNull();
  });

  it('holds the player’s own club out of the cycle', () => {
    const { state } = createTestGame('club-protected');
    const userClub = state.clubs[state.userClubId]!;
    // Ordinary trouble: a bad season, a debt that is not yet beyond saving. His
    // club is held out of the cycle here — not out of consequences altogether,
    // which is what the terminal-debt test below is about.
    userClub.finances.balance = -600;

    for (let index = 0; index < 5; index++) {
      reviewClubFinances(state, { ...contextFor(state, index), protectedClubIds: [state.userClubId] });
    }

    expect(userClub.active).toBe(true);
    expect(userClub.finances.administrationSeasons).toBe(0);
  });
});

/**
 * A club that comes back.
 *
 * The cycle always replaced what it took, so the division held its size — but
 * the club that arrived was always a stranger: a new name, a new crowd, no past,
 * on somebody else's pitch. What a county actually does is bring the same club
 * back where the club was worth bringing back, and that is a different thing
 * from filling its place. Both halves are tested here, because the first is
 * worthless without the second: a reformation that happened to every club would
 * just be the old replacement with a nicer story.
 */
describe('club reformation and successor identity', () => {
  it('brings a club with a history and a crowd back as itself', () => {
    const { state } = createTestGame('club-reformation');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 4);
    club.history.honours.push('Division Three champions (2004)');
    club.supporters.confidence = 62;
    club.identity.colours = { primary: '#112233', secondary: '#ffcc00' };
    const before = { name: club.identity.name, colours: { ...club.identity.colours }, founded: club.history.founded };
    // A club in the world has the season it is playing already on its record, so
    // the count is read rather than assumed.
    const seasonsBefore = club.history.seasons.length;
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;
    expect(isReformation(club)).toBe(true);

    const outcome = reviewClubFinances(state, contextFor(state));
    const formed = outcome.formed[0]!;
    const successor = state.clubs[formed.clubId]!;
    expect(formed.kind).toBe('reformed');
    expect(successor.active).toBe(true);

    // The recognisable part: the same club, in the same shirts, under the same
    // name — which is the whole difference between a reformation and a new club
    // in the same town.
    expect(successor.identity.name).toBe(before.name);
    expect(successor.identity.colours).toEqual(before.colours);
    expect(successor.heritage).toMatchObject({
      predecessorId: clubId,
      predecessorName: before.name,
      predecessorFounded: before.founded,
      kind: 'reformed',
    });
    expect(successor.heritage!.inherited).toContain('the name');

    // And the parts of a club that are not a name: the same crowd on the same
    // touchline, the same pitch, the same town.
    expect(successor.supporters.confidence).toBe(62);
    expect(successor.groundId).toBe(club.groundId);
    expect(successor.townId).toBe(club.townId);

    // What it does not inherit: the debt, the trophies, the men, the record.
    expect(successor.finances.balance).toBeGreaterThanOrEqual(0);
    expect(successor.history.honours).toEqual([]);
    expect(successor.history.seasons).toEqual([]);
    expect(successor.history.managers).toEqual([]);
    expect(successor.squadIds.length).toBeGreaterThanOrEqual(11);

    // And the club that went keeps its own record: nothing was rewritten to make
    // the new one look older than it is.
    expect(club.active).toBe(false);
    expect(club.history.honours).toEqual(['Division Three champions (2004)']);
    expect(club.history.seasons).toHaveLength(seasonsBefore);
    expect(club.history.notableEvents[0]!.description).toContain('re-formed');
    expect(successorOf(state, clubId)?.id).toBe(successor.id);
  });

  it('moves the county\u2019s rivalries onto the club that came back', () => {
    const { state } = createTestGame('club-reformation-rivalry');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 4);
    club.supporters.confidence = 70;
    const other = Object.values(state.clubs).find(
      (candidate) => candidate.id !== clubId && candidate.active,
    )!;
    // A derby, which is what a club that has been here a hundred years has.
    const derby = {
      intensity: 74,
      note: 'A derby.',
      baseline: 66,
      kind: 'derby' as const,
      since: '1931-06-01',
      lastMetOn: '2026-04-05',
      meetings: 40,
      heat: 8,
    };
    club.rivalries[other.id] = { ...derby };
    other.rivalries[clubId] = { ...derby };
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    const outcome = reviewClubFinances(state, contextFor(state));
    const successor = state.clubs[outcome.formed[0]!.clubId]!;

    // The derby is between two towns and two crowds and not between two
    // registrations: it survives the club dying and picks up where it left off.
    expect(other.rivalries[clubId]).toBeUndefined();
    expect(other.rivalries[successor.id]?.kind).toBe('derby');
    expect(other.rivalries[successor.id]?.baseline).toBe(66);
    expect(other.rivalries[successor.id]?.meetings).toBe(40);
    expect(successor.rivalries[other.id]?.intensity).toBe(74);
    expect(successor.heritage!.inherited).toContain('the rivalries');

    // And nothing anywhere still names a club that has gone — which the world
    // used to be full of, because a fold never told anybody.
    for (const candidate of Object.values(state.clubs)) {
      for (const key of Object.keys(candidate.rivalries ?? {})) {
        expect(state.clubs[key]?.active, `${candidate.id} -> ${key}`).toBe(true);
      }
    }
  });

  /**
   * The club that comes back plays at the standard it was playing at.
   *
   * A re-formation is the same club — the same name, the same crowd, the same
   * pitch — and the standing is what its squad, its finances and its expectations
   * are all built from. Re-rolling it around the middle of the rung was a quiet
   * way of flattening the ladder: every churn pulled a rung's clubs towards its
   * own middle, and over ten seasons the top two rungs of one seeded county
   * closed to within the separation `tier-stratification` exists to hold. A
   * successor — a genuinely new club — still takes the standard of the rung it
   * steps into, which is the rule that stopped replacements arriving at whatever
   * their town happened to draw.
   */
  it('brings a club back at the standard it was playing at, and a new club at the rung’s', () => {
    const { state } = createTestGame('club-reformation-standing');
    const divisions = leagueCompetitions(state);
    const bottom = divisions[divisions.length - 1]!;
    // A rung with a wide band: 24 to 40, a median of 32. The club that folds sits
    // at the floor of it, where the rung's middle is nowhere near its own level.
    bottom.clubIds.forEach((id, index) => {
      state.clubs[id]!.reputation = 24 + index * 2;
    });
    const reformedId = bottom.clubIds.find((id) => id !== state.userClubId)!;
    const reformed = withSeasons(state, reformedId, 4);
    reformed.supporters.confidence = 70;
    reformed.reputation = 24;
    reformed.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    // A club nobody remembers, in the same rung, as the other half of the rule.
    const successorId = bottom.clubIds.find((id) => id !== reformedId && id !== state.userClubId)!;
    const successor = state.clubs[successorId]!;
    successor.supporters.confidence = 20;
    successor.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    const outcome = reviewClubFinances(state, contextFor(state));
    // Found by what it came from rather than by its town: two clubs in one town
    // can go under in the same summer, and the two replacements then share it.
    const formedFor = (predecessorId: string): State['clubs'][string] =>
      state.clubs[
        outcome.formed.find(
          (formation) => state.clubs[formation.clubId]!.heritage!.predecessorId === predecessorId,
        )!.clubId
      ]!;
    const back = formedFor(reformedId);
    const fresh = formedFor(successorId);
    // The same club, at the level it was at — including the standing that going
    // into administration cost it, and nowhere near the rung's middle of 32.
    expect(back.reputation).toBe(state.clubs[reformedId]!.reputation);
    expect(back.reputation).toBeLessThan(32);
    // A new club, at the rung's standard and inside its band.
    expect(fresh.reputation).toBeGreaterThanOrEqual(24);
    expect(fresh.reputation).toBeLessThanOrEqual(40);
  });

  it('gives a club nobody remembers a different club in its place', () => {
    const { state } = createTestGame('club-successor');
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    // No seasons behind it and nobody watching: there is no club here to bring
    // back, so the town gets a new one.
    club.supporters.confidence = 20;
    const name = club.identity.name;
    const other = Object.values(state.clubs).find(
      (candidate) => candidate.id !== clubId && candidate.active,
    )!;
    other.rivalries[clubId] = {
      intensity: 30,
      note: 'Something or other.',
      baseline: 20,
      kind: 'competitive',
      since: '2020-01-01',
      lastMetOn: null,
      meetings: 3,
      heat: 10,
    };
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;
    expect(isReformation(club)).toBe(false);

    const outcome = reviewClubFinances(state, contextFor(state));
    const successor = state.clubs[outcome.formed[0]!.clubId]!;
    expect(outcome.formed[0]!.kind).toBe('successor');
    expect(successor.identity.name).not.toBe(name);
    expect(successor.heritage!.kind).toBe('successor');
    expect(successor.heritage!.inherited).toEqual(['the ground']);

    // Its own crowd from scratch, and no relationships it never had: the
    // relationship died with the club rather than being handed to a stranger who
    // happens to play on the same pitch.
    expect(successor.supporters.confidence).toBe(50);
    expect(Object.keys(successor.rivalries)).toEqual([]);
    expect(other.rivalries[clubId]).toBeUndefined();
  });
});

/**
 * The committee's first act in administration.
 *
 * A club in the red used to have one ending and one only: three seasons, then
 * out. What a committee actually does is ask the town, and what it can raise is
 * a fact about the club rather than a roll of a die — which is what makes the
 * way out a possibility for a small debt and no kind of hope at all for a large
 * one.
 */
describe("the committee's appeal", () => {
  it('raises a bounded sum, once, and puts it in the books', () => {
    const { state } = createTestGame('club-appeal');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 4);
    club.reputation = 60;
    club.supporters.confidence = 70;
    club.finances.balance = -1500;

    const first = reviewClubFinances(state, contextFor(state, 0));
    expect(first.appealed).toContain(clubId);
    expect(first.folded).toHaveLength(0);
    expect(club.finances.administrationSeasons).toBe(1);

    // Bounded at both ends, and nowhere near enough on its own.
    const raised = 1500 + club.finances.balance;
    expect(raised).toBeGreaterThanOrEqual(CLUB_LIFECYCLE.appeal.floor);
    expect(raised).toBeLessThanOrEqual(CLUB_LIFECYCLE.appeal.ceiling);
    expect(club.finances.balance).toBeLessThan(0);

    // In the books like every other pound, and in the club's own story.
    const line = club.finances.ledger.find((entry) => entry.description === 'Appeal to save the club');
    expect(line?.category).toBe('fundraising');
    expect(line?.amount).toBe(raised);
    expect(club.history.notableEvents[0]!.description).toContain('appeal');
    expect(
      first.events.some((event) => String(event.data.headline).includes('to stay alive')),
    ).toBe(true);

    // Once per spell: the next season it cannot ask again, and nothing moves on
    // its own.
    const before = club.finances.balance;
    const second = reviewClubFinances(state, contextFor(state, 1));
    expect(second.appealed).toEqual([]);
    expect(club.finances.balance).toBe(before);
    expect(club.finances.administrationSeasons).toBe(2);

    // ...and the grace still runs out, exactly as it did.
    const third = reviewClubFinances(state, contextFor(state, 2));
    expect(third.folded.map((fold) => fold.clubId)).toContain(clubId);
  });

  it('is spent until the books are straight, and can be earned again', () => {
    const { state } = createTestGame('club-appeal-again');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 4);
    club.finances.balance = -1500;

    reviewClubFinances(state, contextFor(state, 0));
    expect(club.finances.appealedOn).toBeTruthy();

    // A good season: out of the red, and the appeal that helped is spent.
    club.finances.balance = 500;
    reviewClubFinances(state, contextFor(state, 1));
    expect(club.finances.administrationSeasons).toBe(0);
    expect(club.finances.appealedOn).toBeNull();

    // Which is what earns a club a second one, if it falls again.
    club.finances.balance = -1500;
    const third = reviewClubFinances(state, contextFor(state, 2));
    expect(third.appealed).toContain(clubId);
  });

  it('clears a small debt and cannot clear a large one', () => {
    const { state } = createTestGame('club-appeal-bounded');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 6);
    club.reputation = 75;
    club.supporters.confidence = 80;
    club.finances.balance = -200;
    expect(appealProceeds(state, club)).toBeGreaterThan(200);

    reviewClubFinances(state, contextFor(state, 0));
    // Enough: the club is out of the red, having ended a season in it.
    expect(club.finances.balance).toBeGreaterThanOrEqual(0);

    // And the same kind of club, fifteen hundred pounds deeper, is not saved by
    // any amount of shaking a bucket: the ceiling is the ceiling.
    const other = withSeasons(
      state,
      Object.values(state.clubs).find(
        (candidate) => candidate.active && candidate.id !== clubId && candidate.id !== state.userClubId,
      )!.id,
      6,
    );
    other.reputation = 75;
    other.supporters.confidence = 80;
    // Entering administration for the first time: a generated club can already
    // be a season into the red, and this test is about the appeal itself.
    other.finances.balance = -3000;
    other.finances.administrationSeasons = 0;
    other.finances.appealedOn = null;

    reviewClubFinances(state, contextFor(state, 1));
    expect(other.finances.balance).toBeLessThan(0);
    expect(other.active).toBe(true);
    expect(other.finances.balance).toBeGreaterThanOrEqual(-3000 + CLUB_LIFECYCLE.appeal.floor);
    expect(other.finances.balance).toBeLessThanOrEqual(-3000 + CLUB_LIFECYCLE.appeal.ceiling);
  });
});

/**
 * The club going under him.
 *
 * The ordinary cycle leaves the player's club alone: a club folding is a
 * career-ending event and the game does not spring it on a manager over a bad
 * season. What it cannot do is make a club immortal — a debt beyond anything a
 * committee can survive takes any club, including his — and when it happens the
 * career has to move rather than point at a club that no longer plays.
 */
describe('the club folding under the manager', () => {
  it('hands him to the job market with his record intact', () => {
    const { state } = createTestGame('club-user-folds');
    const clubId = state.userClubId;
    const club = withSeasons(state, clubId, 4);
    club.supporters.confidence = 60;
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;
    const manager = state.people[MANAGER_PERSON_ID]!;

    startNextSeason(state);

    expect(club.active).toBe(false);
    expect(club.managerId).toBeNull();

    // The manager is not deleted by the club folding: he is the career, and the
    // fold used to take every official the club had with it.
    expect(state.people[MANAGER_PERSON_ID]).toBeDefined();
    expect(manager.clubId).toBeNull();
    expect(state.career!.status).toBe('unemployed');
    expect(state.career!.clubId).toBeNull();
    expect(state.career!.lastClubId).toBe(clubId);
    const spell = state.career!.spells[state.career!.spells.length - 1]!;
    expect(spell.clubId).toBe(clubId);
    expect(spell.ending).toBe('club-folded');
    expect(spell.to).not.toBeNull();
    // The tenure closes in the club's own record, as every tenure does.
    expect(club.history.managers[0]!.to).not.toBeNull();

    // And the county is not left with a hole in it: a club took his club's
    // place, it is registered in exactly one division, and it is either managed
    // already or held open for him.
    const successor = successorOf(state, clubId)!;
    expect(successor).toBeTruthy();
    expect(successor.heritage!.kind).toBe('reformed');
    const memberships = leagueCompetitions(state).filter((competition) =>
      competition.clubIds.includes(successor.id),
    );
    expect(memberships).toHaveLength(1);
    expect(
      successor.managerId !== null ||
        state.career!.openings.some((opening) => opening.clubId === successor.id),
    ).toBe(true);
  });

  it('folds his club too at a debt no committee can survive', () => {
    const { state } = createTestGame('club-user-terminal');
    state.clubs[state.userClubId]!.finances.balance = CLUB_LIFECYCLE.terminalDebt - 1;

    const outcome = reviewClubFinances(state, {
      ...contextFor(state),
      protectedClubIds: [state.userClubId],
    });

    expect(outcome.folded.map((fold) => fold.clubId)).toContain(state.userClubId);
    expect(state.clubs[state.userClubId]!.active).toBe(false);
  });

  it('does not mint a second club when the same boundary is processed twice', () => {
    const { state } = createTestGame('club-fold-twice');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 4);
    club.supporters.confidence = 70;
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    const first = reviewClubFinances(state, contextFor(state));
    const active = Object.values(state.clubs).filter((candidate) => candidate.active).length;
    const second = reviewClubFinances(state, contextFor(state));

    expect(first.formed).toHaveLength(1);
    expect(second.formed).toHaveLength(0);
    expect(second.folded).toHaveLength(0);
    expect(Object.values(state.clubs).filter((candidate) => candidate.active)).toHaveLength(active);
    expect(
      Object.values(state.clubs).filter((candidate) => candidate.heritage?.predecessorId === clubId),
    ).toHaveLength(1);
  });

  it('keeps a reformed club, its crowd and its heritage across a save', () => {
    const { state } = createTestGame('club-reformation-save');
    const clubId = firstNonUserClub(state);
    const club = withSeasons(state, clubId, 4);
    club.supporters.confidence = 66;
    const seasonsBefore = club.history.seasons.length;
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;
    const successorId = reviewClubFinances(state, contextFor(state)).formed[0]!.clubId;

    const restored = deserialiseGame(serialiseGame(state)).state!;
    const successor = restored.clubs[successorId]!;

    expect(successor.heritage).toMatchObject({ predecessorId: clubId, kind: 'reformed' });
    expect(successor.heritage!.predecessorFounded).toBe(club.history.founded);
    expect(successor.supporters.confidence).toBe(66);
    expect(successor.rivalries).toEqual(state.clubs[successorId]!.rivalries);
    expect(restored.clubs[clubId]!.active).toBe(false);
    expect(restored.clubs[clubId]!.history.seasons).toHaveLength(seasonsBefore);
  });
});
