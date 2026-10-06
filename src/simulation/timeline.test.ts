import { describe, expect, it } from 'vitest';
import { createTestGame } from './testSupport';
import { addDays } from './calendar';
import {
  daysUntil,
  isLeagueMatchday,
  leagueMatchdayCount,
  matchdaysPlayed,
  nextMatchday,
  seasonEndDate,
  weeksRemaining,
} from './timeline';

/**
 * Where the game thinks it is in the season.
 *
 * The season calendar is not the league: it also carries the cup rounds, which
 * are numbered after the league's matchdays. Everything that says "matchday X
 * of N" has to count the league's Sundays, or the cup rounds inflate N — a
 * 22-matchday season reading "matchday 1 of 33".
 */
describe('the league matchday count', () => {
  it('counts the league Sundays and leaves the cup rounds out', () => {
    const { state } = createTestGame('timeline-count');
    const league = state.season.calendar.filter((entry) => isLeagueMatchday(state, entry.matchday));

    expect(league.length).toBeGreaterThan(1);
    expect(leagueMatchdayCount(state)).toBe(league.length);
    // The calendar carries the cup rounds on top of the league's Sundays, so its
    // length is not the league's size. This is the conflation the matchday
    // denominator used to make.
    expect(state.season.calendar.length).toBeGreaterThan(league.length);
  });

  it('leaves room for the matchday being prepared', () => {
    const { state } = createTestGame('timeline-denominator');
    expect(matchdaysPlayed(state)).toBe(0);
    expect(nextMatchday(state)).toBe(1);
    expect(leagueMatchdayCount(state)).toBeGreaterThanOrEqual(nextMatchday(state));
  });

  it('reads at least one, even from a state with no league entry', () => {
    const { state } = createTestGame('timeline-empty');
    state.season.calendar = [];
    expect(leagueMatchdayCount(state)).toBe(1);
  });
});

/**
 * How long the money has left to run.
 *
 * The club's net is money per *week*, so the weeks left on the books has to be
 * weeks of the calendar rather than matchdays to be multiplied by: the season
 * carries more weeks than it has Sundays. Counted in whole weeks to the last
 * date on the calendar, and never negative.
 */
describe('the weeks left in the season', () => {
  it('counts calendar weeks to the end of the season, not matchdays', () => {
    const { state } = createTestGame('timeline-weeks');
    const end = seasonEndDate(state);
    expect(end).not.toBeNull();
    expect(weeksRemaining(state)).toBe(Math.ceil(daysUntil(state.date, end!) / 7));
    // Every Sunday still to come falls inside the weeks that are left.
    expect(weeksRemaining(state)).toBeGreaterThanOrEqual(leagueMatchdayCount(state) - matchdaysPlayed(state));
  });

  it('runs for more weeks than it has matchdays', () => {
    const { state } = createTestGame('timeline-span');
    const first = state.season.calendar.reduce(
      (earliest, entry) => (entry.date < earliest ? entry.date : earliest),
      state.season.calendar[0]!.date,
    );
    const weeksOfSeason = Math.ceil(daysUntil(first, seasonEndDate(state)!) / 7);
    // This is why the old figure was misleading: the fixture list ends weeks
    // before the season does.
    expect(weeksOfSeason).toBeGreaterThan(leagueMatchdayCount(state));
  });

  it('takes the last date on the calendar, cup rounds and all', () => {
    const { state } = createTestGame('timeline-end');
    const last = state.season.calendar.reduce(
      (latest, entry) => (entry.date > latest ? entry.date : latest),
      state.season.calendar[0]!.date,
    );
    expect(seasonEndDate(state)).toBe(last);
  });

  it('has no weeks left once the season has run out', () => {
    const { state } = createTestGame('timeline-over');
    state.date = addDays(seasonEndDate(state)!, 1);
    expect(weeksRemaining(state)).toBe(0);

    state.season.calendar = [];
    expect(seasonEndDate(state)).toBeNull();
    expect(weeksRemaining(state)).toBe(0);
  });
});
