import { isCup } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { addDays, dayOfWeek } from './calendar';

/**
 * Where we are in the season, worked out from the one thing that decides it:
 * the date.
 *
 * There is deliberately no stored matchday counter. A counter and a clock are
 * two representations of the same fact, and they drift the moment a match is
 * postponed, a save is migrated or a test builds a state by hand. Everything
 * here reads `state.season.calendar` and `state.date` and derives the rest.
 *
 * The convention, unchanged from the weekly model:
 *
 *  - `matchdaysPlayed` — how many Sundays have gone by.
 *  - `nextMatchday`    — the 1-based matchday being prepared (1..N, then N+1).
 */

/** The Monday of the week containing `iso`. */
export function weekStartOf(iso: ISODate): ISODate {
  const offset = (dayOfWeek(iso) + 6) % 7;
  return addDays(iso, -offset);
}

/** The Sunday that ends the week containing `iso`. */
export function weekEndOf(iso: ISODate): ISODate {
  return addDays(weekStartOf(iso), 6);
}

/**
 * The league's own matchdays, in date order.
 *
 * The season calendar also carries cup rounds, which are numbered after the
 * league's matchdays but dated *inside* them — a cup tie in the middle of
 * matchday twelve. Counting the calendar from the top would therefore count a
 * matchday that has not happened yet as one that has. Everything that means
 * "how far through the league are we" works from the league's Sundays alone.
 */
function leagueEntries(state: GameState) {
  return state.season.calendar.filter((entry) => isLeagueMatchday(state, entry.matchday));
}

/** True when this matchday number is a league Sunday rather than a cup round. */
export function isLeagueMatchday(state: GameState, matchday: number): boolean {
  for (const [competitionId, list] of Object.entries(state.fixtures ?? {})) {
    if (!list.byMatchday[matchday]) continue;
    if (isCup(state.competitions[competitionId])) continue;
    return true;
  }
  return false;
}

/** Sundays that have already passed. On a matchday morning this is still the previous count. */
export function matchdaysPlayed(state: GameState, date: ISODate = state.date): number {
  let played = 0;
  for (const entry of leagueEntries(state)) {
    if (entry.date < date) played += 1;
  }
  return played;
}

/** The 1-based matchday now being prepared. May be one past the end of the season. */
export function nextMatchday(state: GameState, date: ISODate = state.date): number {
  return matchdaysPlayed(state, date) + 1;
}

/**
 * How many of this season's matchdays are league Sundays — the denominator for
 * "matchday X of N".
 *
 * The season calendar counts league matchdays *and* cup rounds, so its length
 * is not the league's size: a 22-matchday season with eleven cup rounds has a
 * 33-entry calendar, and reading the calendar length would show matchday one as
 * "1 of 33". Never fewer than one, so a hand-built or migrated state with no
 * league entry still has a denominator.
 */
export function leagueMatchdayCount(state: GameState): number {
  return Math.max(1, leagueEntries(state).length);
}

/** The matchday whose football falls on this date, if any. */
export function matchdayOnDate(state: GameState, date: ISODate): number | null {
  return state.season.calendar.find((entry) => entry.date === date)?.matchday ?? null;
}

/** The date of a matchday, or null when the season has no such matchday. */
export function matchdayDate(state: GameState, matchday: number): ISODate | null {
  return state.season.calendar.find((entry) => entry.matchday === matchday)?.date ?? null;
}

/** The Monday on which the build-up to a matchday begins. */
export function matchweekStart(state: GameState, matchday: number): ISODate | null {
  const date = matchdayDate(state, matchday);
  return date ? weekStartOf(date) : null;
}

/** Days from `from` to `to`, signed. Negative means "already happened". */
export function daysUntil(from: ISODate, to: ISODate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function isMatchdayDate(state: GameState, date: ISODate): boolean {
  return matchdayOnDate(state, date) !== null;
}

/** The last date the season's calendar holds, or null when it holds none. */
export function seasonEndDate(state: GameState): ISODate | null {
  let last: ISODate | null = null;
  for (const entry of state.season.calendar) {
    if (last === null || entry.date > last) last = entry.date;
  }
  return last;
}

/**
 * How many weeks of the season are left, counted on the calendar rather than in
 * fixtures.
 *
 * The club's money is a weekly figure — pitch hire, insurance and the hall come
 * round every seven days, and so does a weekly sponsor's instalment — so the
 * number a manager multiplies that figure by is the number of weeks left, not
 * the number of Sundays. Counting matchdays reads plausibly and is quietly
 * wrong: the league's twenty-two Sundays sit inside a season that runs some
 * forty weeks, so a budget built on them comes up short by every week between
 * fixtures, and a rearranged cup tie can keep the season open past the last
 * Sunday besides.
 *
 * Whole weeks to the last date on the calendar, and never negative: a season
 * that has already run out has no weeks left in it.
 */
export function weeksRemaining(state: GameState, date: ISODate = state.date): number {
  const end = seasonEndDate(state);
  if (!end) return 0;
  return Math.max(0, Math.ceil(daysUntil(date, end) / 7));
}

/**
 * True once the last date of the season has been and gone.
 *
 * Measured against the last *date* rather than a count of matchdays, because the
 * calendar is no longer one list of Sundays: the cup rounds are numbered after
 * the league's but fall in the middle of it, so the final entry by number is not
 * the final day of football. A cup tie that is rearranged past the last Sunday
 * keeps the season open through `everyFixtureSettled`.
 */
export function seasonCalendarExhausted(state: GameState, date: ISODate = state.date): boolean {
  const last = seasonEndDate(state);
  if (last === null) return true;
  return date > last;
}
