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

/** Sundays that have already passed. On a matchday morning this is still the previous count. */
export function matchdaysPlayed(state: GameState, date: ISODate = state.date): number {
  let played = 0;
  for (const entry of state.season.calendar) {
    if (entry.date < date) played += 1;
  }
  return played;
}

/** The 1-based matchday now being prepared. May be one past the end of the season. */
export function nextMatchday(state: GameState, date: ISODate = state.date): number {
  return matchdaysPlayed(state, date) + 1;
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

/** True once the last Sunday of the season has been and gone. */
export function seasonCalendarExhausted(state: GameState, date: ISODate = state.date): boolean {
  if (state.season.calendar.length === 0) return true;
  return nextMatchday(state, date) > state.season.calendar.length;
}
