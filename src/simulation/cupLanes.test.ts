import { describe, expect, it } from 'vitest';
import type { CompetitionId, ISODate, PyramidId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { addDays, toDate } from './calendar';
import { cupRoundMatchday, cupRoundOf, matchesForRound, planOf } from './cup';
import { readyForToday } from './day';
import { postponeFixture } from './postponement';
import {
  COUNTY_CUP_ID,
  COUNTY_CUP_NAME,
  cupCompetitionId,
  cupCompetitions,
  LEAGUE_CUP_ID,
  LEAGUE_CUP_NAME,
  PLATE_ID,
  PLATE_NAME,
  pyramidIdOf,
  regionNameFor,
} from './pyramid';
import { createTestGame } from './testSupport';
import { matchdayDate, matchdayOnDate } from './timeline';

/**
 * The calendar of a two-ladder world.
 *
 * The county's ladder and the district next door play their football on one
 * calendar, and their cups are the reason that calendar needs lanes: twenty-two
 * cup rounds want a Sunday each and the season's league Sundays alone will not
 * give them one. The two ladders' rounds have no club in common, so they are
 * played on the same afternoons; the county cup is drawn from every club in the
 * county, so it can never share, and takes Sundays of its own.
 *
 * These are the properties that arrangement has to hold to, on a career the world
 * generator actually builds: no club playing twice on a day, every round dated
 * and numbered, the date lookup answering with a round that really is on the day
 * asked about, a rearranged tie landing somewhere its clubs are free, and the same
 * seed giving the same lanes again.
 */
const SEED = 'cup-lanes';

type State = ReturnType<typeof createTestGame>['state'];

/** The ladder a career is born with that is not the founding one. */
function districtIdOf(state: State): PyramidId {
  return state.pyramidIds.find((id) => id !== 'league')!;
}

/** A competition's matches, on whatever date each one is currently due. */
function matchesOf(state: State, competitionId: CompetitionId): Match[] {
  return Object.values(state.matches).filter((match) => match.competitionId === competitionId);
}

/** The dates a competition's football is due on, earliest first, one per date. */
function datesOf(state: State, competitionId: CompetitionId): ISODate[] {
  return [...new Set(matchesOf(state, competitionId).map((match) => match.date))].sort();
}

/** True for football that counts: a league match or a cup tie, never a friendly. */
function isCompetitive(state: State, match: Match): boolean {
  const competition = state.competitions[match.competitionId];
  return competition?.kind === 'league' || competition?.kind === 'cup';
}

/** Every competitive fixture due on a date, across the whole world. */
function competitiveOn(state: State, date: ISODate): Match[] {
  return Object.values(state.matches).filter((match) => match.date === date && isCompetitive(state, match));
}

/** The first Sunday on which both of these competitions are playing. */
function firstSharedDate(state: State, first: CompetitionId, second: CompetitionId): ISODate {
  const other = new Set(datesOf(state, second));
  const shared = datesOf(state, first).find((date) => other.has(date));
  if (!shared) throw new Error(`no Sunday is shared by ${first} and ${second}`);
  return shared;
}

describe('the lanes a two-ladder season schedules in', () => {
  const { state } = createTestGame(SEED);
  const district = districtIdOf(state);
  const districtCup = cupCompetitionId(district, 'cup');
  const districtPlate = cupCompetitionId(district, 'plate');

  it('plays both ladders’ cups on the same afternoons', () => {
    const county = datesOf(state, LEAGUE_CUP_ID);
    expect(county.length).toBeGreaterThan(0);
    // Round for round, the district's cup is on the county's own dates: the two
    // fields are disjoint, so a Sunday serves both.
    expect(datesOf(state, districtCup)).toEqual(county);
    expect(datesOf(state, districtPlate)).toEqual(datesOf(state, PLATE_ID));

    // And the two ladders really are two populations — which is the whole of the
    // reason the shared Sunday is safe.
    const countyCupClubs = new Set(state.competitions[LEAGUE_CUP_ID]!.clubIds);
    for (const clubId of state.competitions[districtCup]!.clubIds) {
      expect(countyCupClubs.has(clubId)).toBe(false);
    }

    // On the shared Sunday it is two rounds playing, not one round of one cup.
    const shared = firstSharedDate(state, LEAGUE_CUP_ID, districtCup);
    const competitions = new Set(competitiveOn(state, shared).map((match) => match.competitionId));
    expect(competitions.has(LEAGUE_CUP_ID)).toBe(true);
    expect(competitions.has(districtCup)).toBe(true);
  });

  it('gives the county cup afternoons of its own', () => {
    // Drawn from both ladders at once, a county cup tie can always collide with
    // somebody's league match or somebody's own cup round, so its rounds may not
    // share a Sunday with any of them.
    const taken = new Set([
      ...datesOf(state, LEAGUE_CUP_ID),
      ...datesOf(state, PLATE_ID),
      ...datesOf(state, districtCup),
      ...datesOf(state, districtPlate),
      ...state.season.calendar.filter((entry) => !isCupEntry(state, entry.matchday)).map((entry) => entry.date),
    ]);
    const countyCupDates = datesOf(state, COUNTY_CUP_ID);
    expect(countyCupDates.length).toBeGreaterThan(0);
    for (const date of countyCupDates) {
      expect(taken.has(date), `${date} is already somebody else's afternoon`).toBe(false);
    }
  });

  it('owns the county cup nowhere, and each ladder cup on its own ladder', () => {
    const countyCup = state.competitions[COUNTY_CUP_ID]!;
    expect(pyramidIdOf(state, countyCup)).toBeNull();
    expect(state.competitions[LEAGUE_CUP_ID]!.clubIds).toHaveLength(36);
    expect(state.competitions[districtCup]!.clubIds).toHaveLength(36);
    // Seventy-two clubs across two ladders, and none of them twice.
    expect(countyCup.clubIds).toHaveLength(72);
    expect(new Set(countyCup.clubIds).size).toBe(72);
  });

  it('names every cup after the ladder that runs it, so no two share one name', () => {
    // An honour is written as `${season} ${name} winners`, so two competitions
    // called the same thing file one trophy's winner in the other's record — the
    // soak reads exactly that as `honours-not-duplicated`. Every ladder's cups
    // carry the district its clubs come from, the county's own ladder included,
    // which is the rule its divisions are named by too.
    const names = cupCompetitions(state).map((cup) => cup.name);
    expect(new Set(names).size).toBe(names.length);
    const founding = state.world.regionName;
    expect(state.competitions[LEAGUE_CUP_ID]!.name).toBe(`${founding} ${LEAGUE_CUP_NAME}`);
    expect(state.competitions[PLATE_ID]!.name).toBe(`${founding} ${PLATE_NAME}`);
    const region = regionNameFor(state, district);
    expect(state.competitions[districtCup]!.name).toBe(`${region} ${LEAGUE_CUP_NAME}`);
    expect(state.competitions[districtPlate]!.name).toBe(`${region} ${PLATE_NAME}`);
    expect(state.competitions[COUNTY_CUP_ID]!.name).toBe(COUNTY_CUP_NAME);
  });

  it('never asks a club to play two competitive matches on one day', () => {
    const clash: string[] = [];
    for (const date of new Set(Object.values(state.matches).map((match) => match.date))) {
      const seen = new Map<string, string>();
      for (const match of competitiveOn(state, date)) {
        for (const clubId of [match.homeClubId, match.awayClubId]) {
          const previous = seen.get(clubId);
          if (previous) clash.push(`${date}: ${clubId} is in ${previous} and ${match.id}`);
          seen.set(clubId, match.id);
        }
      }
    }
    expect(clash).toEqual([]);
  });

  it('dates and numbers every round of every cup, on a Sunday', () => {
    const matchdays = state.season.calendar.map((entry) => entry.matchday);
    // One calendar, one number per entry: nothing was overwritten to make room.
    expect(new Set(matchdays).size).toBe(matchdays.length);

    for (const cup of cupCompetitions(state)) {
      const rounds = planOf(cup);
      expect(rounds.length).toBeGreaterThan(0);
      const numbered: number[] = [];
      for (const entry of rounds) {
        const matchday = cupRoundMatchday(state, cup, entry.round);
        numbered.push(matchday);
        const calendarEntry = state.season.calendar.find((candidate) => candidate.matchday === matchday);
        // The round has a slot in the calendar, and it is a Sunday.
        expect(calendarEntry, `${cup.id} round ${entry.round}`).toBeDefined();
        expect(toDate(calendarEntry!.date).getUTCDay(), `${cup.id} round ${entry.round} on ${calendarEntry!.date}`).toBe(0);
      }
      // Two rounds of one cup are never numbered the same, and every round the
      // plan asks for took a matchday of its own.
      expect(new Set(numbered).size).toBe(rounds.length);

      // Every tie drawn so far belongs to the round it was drawn for.
      for (const entry of rounds) {
        for (const tie of matchesForRound(state, cup, entry.round)) {
          expect(cupRoundOf(state, cup, tie)).toBe(entry.round);
        }
      }
    }
  });

  it('looks a shared date up without naming a round that is not on it', () => {
    const shared = firstSharedDate(state, LEAGUE_CUP_ID, districtCup);
    const entries = state.season.calendar.filter((entry) => entry.date === shared);
    expect(entries.length).toBeGreaterThan(1);

    const matchday = matchdayOnDate(state, shared);
    expect(matchday).not.toBeNull();
    // Whichever of the two the lookup answers with, it has to be an entry that is
    // really on that date — the failure this guards is a consumer reading a round
    // off a position in the calendar rather than off the date.
    expect(entries.some((entry) => entry.matchday === matchday)).toBe(true);
    expect(matchdayDate(state, matchday!)).toBe(shared);

    // A date with no football on it answers with nothing at all.
    const after = addDays(state.season.endDate, 7);
    expect(matchdayOnDate(state, after)).toBeNull();
  });

  it('prepares every round that falls on one afternoon', () => {
    const prepared = createTestGame('cup-lanes-prepare');
    const districtId = districtIdOf(prepared.state);
    const shared = firstSharedDate(prepared.state, LEAGUE_CUP_ID, cupCompetitionId(districtId, 'cup'));

    prepared.state.date = shared;
    readyForToday(prepared.state, shared);

    const ties = competitiveOn(prepared.state, shared).filter(
      (match) => match.competitionId === LEAGUE_CUP_ID || match.competitionId === cupCompetitionId(districtId, 'cup'),
    );
    expect(new Set(ties.map((match) => match.competitionId)).size).toBe(2);
    for (const tie of ties) {
      expect(tie.refereeId, tie.id).toBeTruthy();
      expect(tie.lineups.home.starting.length, tie.id).toBeGreaterThan(0);
      expect(tie.lineups.away.starting.length, tie.id).toBeGreaterThan(0);
    }
  });

  it('rearranges a tie onto a day its clubs are free, and leaves the other ladder’s round alone', () => {
    const postponed = createTestGame('cup-lanes-postpone');
    const districtId = districtIdOf(postponed.state);
    const districtCup = cupCompetitionId(districtId, 'cup');
    const shared = firstSharedDate(postponed.state, LEAGUE_CUP_ID, districtCup);

    const mine = competitiveOn(postponed.state, shared).find((match) => match.competitionId === LEAGUE_CUP_ID)!;
    const others = competitiveOn(postponed.state, shared).filter((match) => match.competitionId !== LEAGUE_CUP_ID);
    expect(others.length).toBeGreaterThan(0);

    const replacement = postponeFixture(postponed.state, mine, shared, 'A waterlogged pitch.');
    expect(replacement).not.toBeNull();
    expect(replacement!.date).not.toBe(shared);
    expect(replacement!.cupRound).toBe(mine.cupRound);

    // Neither club is playing anything else on the afternoon it goes to — the
    // replacement is a second competitive fixture for nobody.
    for (const clubId of [replacement!.homeClubId, replacement!.awayClubId]) {
      const busy = Object.values(postponed.state.matches).filter(
        (other) =>
          other.id !== replacement!.id &&
          other.date === replacement!.date &&
          !other.played &&
          other.status !== 'abandoned' &&
          (other.homeClubId === clubId || other.awayClubId === clubId),
      );
      expect(busy, `${clubId} on ${replacement!.date}`).toEqual([]);
    }

    // The other ladder's round on the shared Sunday was not disturbed, and the
    // rearranged tie is the same tie on a later date rather than a second one.
    for (const other of others) {
      expect(other.status).toBe('scheduled');
      expect(other.date).toBe(shared);
    }
    expect(mine.status).toBe('postponed');
    expect(mine.replacedByMatchId).toBe(replacement!.id);
  });

  it('builds the same lanes, the same entrants and the same ties from the same seed', () => {
    const again = createTestGame(SEED);
    expect(again.state.season.calendar).toEqual(state.season.calendar);
    const described = (candidate: State) =>
      Object.values(candidate.matches)
        .filter((match) => isCompetitive(candidate, match))
        .map((match) => `${match.id} ${match.competitionId} ${match.date} r${match.cupRound ?? '-'} ${match.homeClubId}-${match.awayClubId}`)
        .sort();
    expect(described(again.state)).toEqual(described(state));
    expect(cupCompetitions(again.state).map((cup) => [cup.id, [...cup.clubIds]])).toEqual(
      cupCompetitions(state).map((cup) => [cup.id, [...cup.clubIds]]),
    );
  });
});

// A league matchday, read the way the calendar does: a matchday number that a
// league fixture list holds.
function isCupEntry(state: State, matchday: number): boolean {
  for (const [competitionId, list] of Object.entries(state.fixtures ?? {})) {
    if (!list.byMatchday[matchday]) continue;
    if (state.competitions[competitionId]?.kind === 'cup') continue;
    return false;
  }
  return true;
}
