/**
 * The parts of a match, and where each one sits on the clock.
 *
 * The engine's clock is monotonic seconds since kick-off. That is what makes an
 * event's `second` sortable: a second-half event can never sort before the
 * half-time whistle that preceded it, and a replay can lay the record out in the
 * order it happened. But a match is not one stretch of time under a single
 * label. It is two halves, and in a knockout tie two periods of extra time, and
 * each is shown to a manager in its own way — "45+2", then 45 again, then "90+4",
 * then 105. Deriving that from the clock, rather than rewinding the clock itself,
 * is what this module is for: it is the single place that knows which part of the
 * game a given second belongs to, and what the clock should read there.
 */

import type { Match, MatchPeriod } from '@/domain/match';
import { stoppageMinutes } from '../core';

export type { MatchPeriod };

export interface PeriodSpec {
  period: MatchPeriod;
  /** The minute the period nominally begins at, before any added time. */
  nominalStart: number;
  /** The minute it nominally ends at, before any added time. */
  nominalEnd: number;
  /** The half number the season records: 1 and 2 are the halves, 3 extra time. */
  half: 1 | 2 | 3;
  /** What to call it, for a report or a clock label. */
  label: string;
  /**
   * Whether the period takes added time.
   *
   * The halves do; extra time does not. The whole point of it is that it is short
   * and every leg in it is heavy, so its fifteen minutes are its fifteen minutes.
   */
  takesStoppage: boolean;
}

/** The periods, in the order they are played. */
export const PERIODS: readonly PeriodSpec[] = [
  { period: 'first-half', nominalStart: 0, nominalEnd: 45, half: 1, label: 'First half', takesStoppage: true },
  { period: 'second-half', nominalStart: 45, nominalEnd: 90, half: 2, label: 'Second half', takesStoppage: true },
  { period: 'extra-first', nominalStart: 90, nominalEnd: 105, half: 3, label: 'Extra time, first half', takesStoppage: false },
  { period: 'extra-second', nominalStart: 105, nominalEnd: 120, half: 3, label: 'Extra time, second half', takesStoppage: false },
];

/** The spec of each period, by key, so a lookup does not walk the list. */
const SPEC_BY_PERIOD: Record<MatchPeriod, PeriodSpec> = Object.fromEntries(
  PERIODS.map((spec) => [spec.period, spec]),
) as Record<MatchPeriod, PeriodSpec>;

export function specFor(period: MatchPeriod): PeriodSpec {
  const spec = SPEC_BY_PERIOD[period];
  if (!spec) throw new Error(`unknown match period: ${period}`);
  return spec;
}

/** The period after this one, or null when it is the last. */
export function nextPeriod(period: MatchPeriod): MatchPeriod | null {
  const index = PERIODS.findIndex((entry) => entry.period === period);
  return index >= 0 && index + 1 < PERIODS.length ? PERIODS[index + 1]!.period : null;
}

/**
 * The minute a period begins on, once the added time played before it is taken
 * into account.
 *
 * The second half begins at 45 plus the first half's stoppage on the *clock*,
 * because the clock never stops; it is only the label that is rebased.
 */
export function periodStartMinute(period: MatchPeriod, addedBefore: number): number {
  return specFor(period).nominalStart + addedBefore;
}

/** The clock second a period begins on, added time included. */
export function periodStartSecond(period: MatchPeriod, addedBefore: number): number {
  return periodStartMinute(period, addedBefore) * 60;
}

/** The clock second a period ends on, given the added time through it. */
export function periodEndSecond(period: MatchPeriod, addedThrough: number): number {
  return (specFor(period).nominalEnd + addedThrough) * 60;
}

/**
 * The minute to *show*, from the monotonic clock.
 *
 * The clock keeps counting seconds since kick-off; the display takes back out
 * every minute of added time already played, so a second half opens at 45 and an
 * extra-time period opens at 90 or 105 where it belongs — even though the clock
 * itself has run past the nominal end of the half before it.
 */
export function displayedMinuteFor(period: MatchPeriod, clock: number, addedBefore: number): number {
  // One spec lookup, not three: this is read on every step of a match.
  const spec = specFor(period);
  const elapsed = Math.max(0, clock - (spec.nominalStart + addedBefore) * 60);
  return spec.nominalStart + Math.floor(elapsed / 60);
}

/**
 * The added time a period itself carries, in minutes.
 *
 * The halves carry what the engine measured as they ended; extra time is played
 * short, so it carries none of its own.
 */
export function periodStoppage(match: Match, period: MatchPeriod): number {
  if (period === 'first-half') return stoppageMinutes(match, 1);
  if (period === 'second-half') return stoppageMinutes(match, 2);
  return 0;
}

/**
 * The added time played before a period, in minutes.
 *
 * Read from the match's own record, which the engine writes as each half ends.
 * Extra time inherits the halves' total: a 90th minute that ran to 90+5 is still
 * 90+5 when extra time begins.
 */
export function addedTimeBefore(match: Match, period: MatchPeriod): number {
  let added = 0;
  for (const spec of PERIODS) {
    if (spec.period === period) break;
    added += periodStoppage(match, spec.period);
  }
  return added;
}
