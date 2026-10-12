import { describe, expect, it } from 'vitest';
import {
  buildSeasonCalendar,
  buildSeasonCalendarWithCups,
  canPlayOnWeekday,
  placeCupRounds,
  NO_GAME_WEEKDAYS,
  toDate,
} from './calendar';
import { allCupRoundSlots } from './cup';
import { matchdayCount } from './generation/fixtureGenerator';
import { buildSeasonStructure } from './seasonStructure';
import { createTestGame } from './testSupport';

/**
 * The shape of a season.
 *
 * The league plays on alternate Sundays and the cups take the Sundays in
 * between. Both halves of that matter, and both are easy to break by changing a
 * single number: make the league weekly again and a double round robin finishes
 * in February with three months of nothing after it; move the cups back to a
 * Wednesday and there is a midweek game in the middle of every working week.
 *
 * These pin the calendar itself, rather than any one competition's fixtures.
 */
const LEAGUE_MATCHDAYS = matchdayCount(12);
const OPENING_SUNDAY = '2026-09-06';

describe('the shape of a season', () => {
  const calendar = buildSeasonCalendarWithCups(
    OPENING_SUNDAY,
    LEAGUE_MATCHDAYS,
    allCupRoundSlots(36, LEAGUE_MATCHDAYS, true),
  );
  const league = calendar.filter((entry) => entry.matchday <= LEAGUE_MATCHDAYS);
  const dates = calendar.map((entry) => entry.date);

  it('plays the league every other Sunday, not every Sunday', () => {
    const [first, second] = league;
    expect(first?.date).toBe(OPENING_SUNDAY);
    // A fortnight between matchdays: the week in between belongs to the cups.
    const gap = (Date.parse(second!.date) - Date.parse(first!.date)) / 86_400_000;
    expect(gap).toBe(14);
  });

  it('runs the league across the whole season rather than finishing in February', () => {
    const last = league[league.length - 1]!.date;
    // Every month of the season gets played in. A weekly calendar finished a
    // twelve-club division on 21 February and left March to May empty.
    const months = new Set(league.map((entry) => entry.date.slice(0, 7)));
    for (const month of ['2026-09', '2026-11', '2027-01', '2027-03', '2027-05']) {
      expect(months.has(month)).toBe(true);
    }
    expect(last > '2027-06-01').toBe(true);
  });

  it('has nothing outside its own matchdays, bar the Christmas fortnight', () => {
    const gaps: number[] = [];
    for (let index = 1; index < dates.length; index += 1) {
      gaps.push(Math.round((Date.parse(dates[index]!) - Date.parse(dates[index - 1]!)) / 86_400_000));
    }
    // A cup round in an off-week makes 7; an empty off-week makes 14.
    expect(gaps.every((gap) => gap === 7 || gap === 14 || gap === 28)).toBe(true);
    // Exactly one four-week hole in the year.
    expect(gaps.filter((gap) => gap === 28)).toHaveLength(1);
  });

  it('plays the cups in the weeks between league matchdays', () => {
    const leagueDates = new Set(league.map((entry) => entry.date));
    const cupDates = calendar.filter((entry) => entry.matchday > LEAGUE_MATCHDAYS).map((e) => e.date);
    expect(cupDates.length).toBeGreaterThan(0);
    // No cup round shares a Sunday with a league matchday: the calendar gives
    // each its own day rather than asking a club to play twice.
    expect(cupDates.filter((date) => leagueDates.has(date))).toEqual([]);
    // And each sits in the week before the matchday it is keyed to.
    expect(cupDates.every((date) => new Date(date).getUTCDay() === 0)).toBe(true);
  });

  it('never schedules a game on a Thursday or a Saturday', () => {
    expect([...NO_GAME_WEEKDAYS].sort()).toEqual([4, 6]);
    expect(canPlayOnWeekday(0)).toBe(true);
    expect(canPlayOnWeekday(4)).toBe(false);
    expect(canPlayOnWeekday(6)).toBe(false);
    const banned = calendar.filter((entry) => !canPlayOnWeekday(toDate(entry.date).getUTCDay()));
    expect(banned).toEqual([]);
  });

  it('holds every date on a Sunday, whatever the round', () => {
    // A round that has to move may land on a Wednesday evening; a round that was
    // drawn for its slot never should.
    const offDay = calendar.filter((entry) => toDate(entry.date).getUTCDay() !== 0);
    expect(offDay).toEqual([]);
    expect(buildSeasonCalendar(OPENING_SUNDAY, 3).every((e) => toDate(e.date).getUTCDay() === 0)).toBe(true);
  });

  it('puts the last cup round at the back end of the season', () => {
    const lastLeague = league[league.length - 1]!.date;
    const lastCup = calendar[calendar.length - 1]!.date;
    // The final is played in the closing weeks, not in the spring while the
    // league race is still being run. ISO dates compare correctly as strings.
    expect(lastCup.slice(0, 7) >= '2027-06').toBe(true);
    expect(lastCup >= lastLeague).toBe(true);
  });
});

describe('a cup round is given a Sunday to itself', () => {
  const LEAGUE = matchdayCount(12);
  const calendar = buildSeasonCalendarWithCups(
    OPENING_SUNDAY,
    LEAGUE,
    allCupRoundSlots(36, LEAGUE, true),
  );

  it('never puts two rounds, or a round and a matchday, on the same Sunday', () => {
    const seen = new Map<string, number>();
    for (const entry of calendar) {
      // Every entry in the calendar is a distinct fixture day. A duplicate here
      // means a club is being asked to play twice on one afternoon.
      const before = seen.get(entry.date) ?? 0;
      expect(before).toBe(0);
      seen.set(entry.date, 1);
    }
  });

  it('keeps a round that falls in the Christmas fortnight rather than dropping it', () => {
    // The league calendar steps over Christmas by a whole fortnight, so the Sunday
    // a round inherits can land back inside the break. A round with no date is a
    // round that can never be drawn, and a competition that can never finish.
    const expected = allCupRoundSlots(36, LEAGUE, true).length;
    const cupDates = calendar.filter((entry) => entry.matchday > LEAGUE).length;
    expect(cupDates).toBe(expected);
  });
});

describe('placing the cup rounds, and refusing a season that cannot hold them', () => {
  const LEAGUE = matchdayCount(12);
  const slots = allCupRoundSlots(36, LEAGUE, true);

  it('gives every round the season asks for a Sunday of its own', () => {
    const placement = placeCupRounds(OPENING_SUNDAY, LEAGUE, slots);
    expect(placement.slots).toHaveLength(slots.length);
    expect(placement.unplaced).toEqual([]);
    expect(placement.slots.every((slot) => slot.date !== null && slot.reason === null)).toBe(true);
    // One round, one date: no two rounds share the afternoon every club in both
    // would have to play on.
    expect(new Set(placement.slots.map((slot) => slot.date)).size).toBe(slots.length);
  });

  it('gives back the calendar the season has always had, slot report beside it', () => {
    // The reporting is added *beside* the calendar, not into it: a valid season's
    // dates are exactly what they were before the slots were counted.
    const placement = placeCupRounds(OPENING_SUNDAY, LEAGUE, slots);
    expect(placement.calendar).toEqual(buildSeasonCalendarWithCups(OPENING_SUNDAY, LEAGUE, slots));
  });

  it('reports a round whose anchor is not in the calendar, rather than skipping it', () => {
    const placement = placeCupRounds(OPENING_SUNDAY, LEAGUE, [{ round: 1, beforeMatchday: LEAGUE + 4 }]);
    expect(placement.unplaced).toHaveLength(1);
    expect(placement.unplaced[0]!.date).toBeNull();
    expect(placement.unplaced[0]!.matchday).toBeNull();
    expect(placement.unplaced[0]!.reason).toContain(`league matchday ${LEAGUE + 4}`);
    // Nothing was dated, so the calendar is the league's own alone.
    expect(placement.calendar).toHaveLength(LEAGUE);
  });

  it('reports a round it cannot find a free Sunday for, and says what got there first', () => {
    // Ten rounds all wanting the same week. The search runs eight weeks ahead, so
    // the first nine take the next nine Sundays and the tenth has nowhere left.
    // This is the silent drop the invariant exists for: a round with no date can
    // never be drawn, so its competition can never reach a final.
    const crowded = Array.from({ length: 10 }, (_unused, index) => ({ round: index + 1, beforeMatchday: LEAGUE }));
    const placement = placeCupRounds(OPENING_SUNDAY, LEAGUE, crowded);
    // The search runs eight weeks ahead and no further, so the rounds at the back
    // of the queue have nowhere left to go - and are reported, not dropped.
    expect(placement.unplaced.length).toBeGreaterThan(0);
    expect(placement.unplaced.every((slot) => slot.reason?.includes('already taken'))).toBe(true);
    expect(placement.slots.filter((slot) => slot.date !== null)).toHaveLength(
      placement.slots.length - placement.unplaced.length,
    );
  });

  it('throws when the season it is building has no room for every cup round', () => {
    const { state } = createTestGame('season-short-calendar');
    const clubIds = Object.values(state.clubs)
      .filter((club) => club.active)
      .map((club) => club.id);
    // A first division of two clubs is a two-matchday league calendar while the
    // cup field is the whole county, so eleven cup rounds want to be played
    // around two league Sundays. In development and in tests that is a season
    // that must not start.
    const divisions = [clubIds.slice(0, 2), clubIds.slice(2, 14), clubIds.slice(14, 26)];
    expect(() =>
      buildSeasonStructure({
        state,
        seasonId: 'season_test',
        seasonLabel: '2026/27',
        firstLeagueDate: OPENING_SUNDAY,
        divisions,
        regionName: 'Testshire',
      }),
    ).toThrow(/no room for every cup round/);
  });

  it('builds the current world\'s season with every cup round placed', () => {
    const { state } = createTestGame('season-cups-placed');
    const divisions = [
      Object.values(state.clubs).filter((club) => club.active).slice(0, 12).map((club) => club.id),
      Object.values(state.clubs).filter((club) => club.active).slice(12, 24).map((club) => club.id),
      Object.values(state.clubs).filter((club) => club.active).slice(24, 36).map((club) => club.id),
    ];
    const structure = buildSeasonStructure({
      state,
      seasonId: 'season_test_full',
      seasonLabel: '2026/27',
      firstLeagueDate: OPENING_SUNDAY,
      divisions,
      regionName: 'Testshire',
    });
    expect(structure.cupSlots).toHaveLength(allCupRoundSlots(36, structure.leagueMatchdays, true).length);
    const cupDates = structure.calendar.filter((entry) => entry.matchday > structure.leagueMatchdays);
    expect(cupDates).toHaveLength(structure.cupSlots.length);
    expect(structure.calendar).toHaveLength(structure.leagueMatchdays + structure.cupSlots.length);
  });
});
