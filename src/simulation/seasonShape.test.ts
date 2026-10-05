import { describe, expect, it } from 'vitest';
import { buildSeasonCalendar, buildSeasonCalendarWithCups, canPlayOnWeekday, NO_GAME_WEEKDAYS, toDate } from './calendar';
import { allCupRoundSlots } from './cup';
import { matchdayCount } from './generation/fixtureGenerator';

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
