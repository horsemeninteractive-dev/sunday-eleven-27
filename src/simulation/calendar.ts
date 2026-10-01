import type { ISODate } from '@/domain/ids';
import type { SeasonCalendarEntry } from '@/domain/world';

/**
 * Game time is day-granular and stored as `YYYY-MM-DD`. All helpers here work
 * on UTC to avoid timezone drift between sessions and machines.
 */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function toDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toISO(date: Date): ISODate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86400000);
}

/** 0 = Sunday. */
export function dayOfWeek(iso: ISODate): number {
  return toDate(iso).getUTCDay();
}

export function isSunday(iso: ISODate): boolean {
  return dayOfWeek(iso) === 0;
}

export function nextWeekday(iso: ISODate, weekday: number): ISODate {
  let cursor = addDays(iso, 1);
  while (dayOfWeek(cursor) !== weekday) cursor = addDays(cursor, 1);
  return cursor;
}

export function formatDate(iso: ISODate): string {
  const date = toDate(iso);
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatShortDate(iso: ISODate): string {
  const date = toDate(iso);
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]!.slice(0, 3)} ${date.getUTCFullYear()}`;
}

export function formatDayMonth(iso: ISODate): string {
  const date = toDate(iso);
  return `${DAY_NAMES[date.getUTCDay()]!.slice(0, 3)} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]!.slice(0, 3)}`;
}

export function monthOf(iso: ISODate): number {
  return toDate(iso).getUTCMonth();
}

export function yearOf(iso: ISODate): number {
  return toDate(iso).getUTCFullYear();
}

export function seasonLabelFor(iso: ISODate): string {
  const year = yearOf(iso);
  const startYear = monthOf(iso) >= 6 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Sundays over the Christmas period are traditionally free in grassroots
 * football, so the calendar skips them.
 */
export function isChristmasBreak(iso: ISODate): boolean {
  const date = toDate(iso);
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return (month === 11 && day >= 20) || (month === 0 && day <= 4);
}

/**
 * How long the manager gets between taking the job and the first league game.
 *
 * Pre-season is not an off switch: the squad trains, the phone rings, players
 * are signed and friendlies are arranged — none of which there is any time for
 * if a career lands on the morning of the first fixture.
 */
export const PRE_SEASON_WEEKS = 6;

/** The Sunday the manager takes charge, `PRE_SEASON_WEEKS` before the opener. */
export function preSeasonStart(firstLeagueDate: ISODate): ISODate {
  return addDays(firstLeagueDate, -7 * PRE_SEASON_WEEKS);
}

/** Build the season's matchday calendar: consecutive Sundays from `startDate`. */
export function buildSeasonCalendar(startDate: ISODate, matchdays: number): SeasonCalendarEntry[] {
  const entries: SeasonCalendarEntry[] = [];
  let cursor = startDate;
  while (entries.length < matchdays) {
    entries.push({ matchday: entries.length + 1, date: cursor });
    cursor = addDays(cursor, 7);
    while (isChristmasBreak(cursor)) cursor = addDays(cursor, 7);
  }
  return entries;
}

export function kickOffTimeFor(iso: ISODate): string {
  const date = toDate(iso);
  // Sunday mornings dominate, with occasional earlier or later kick-offs.
  const minute = date.getUTCDate() % 3 === 0 ? '00' : date.getUTCDate() % 3 === 1 ? '30' : '15';
  const hour = date.getUTCDate() % 4 === 0 ? 10 : 10;
  return `${hour}:${minute}am`;
}
