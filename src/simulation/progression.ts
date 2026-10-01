/**
 * Time progression.
 *
 * The game advances one day at a time now (`simulation/day.ts`), so there is no
 * "weekly step" left to own. This module exists for the two callers that still
 * speak in weeks — the quick-advance shortcut and the test suite — and re-exports
 * the pieces that used to live here so nothing has to relearn their names.
 *
 * New code should import from `./day` (day-by-day) or `./season` (the ends of
 * seasons) directly.
 */

export { advanceWeek, continueTime, currentAttention, notableResultEvent, processDay } from './day';
export type { ContinueOutcome, ContinueStop, DayOutcome, MatchSummary, WeekOutcome } from './day';
export { finishSeason, startNextSeason, everyFixtureSettled } from './season';
