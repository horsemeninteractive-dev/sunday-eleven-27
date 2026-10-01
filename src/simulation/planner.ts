import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { addDays, dayOfWeek, toDate, toISO } from './calendar';
import type { ScheduledEvent } from '@/domain/events';
import { eventsOn } from './schedule';
import { matchdayOnDate, nextMatchday, weekEndOf, weekStartOf } from './timeline';

/**
 * The calendar screen's data.
 *
 * This module used to own a *cursor* — which day of the week the manager was
 * standing on. Continuous time made that redundant: the day he is standing on
 * is the game date. What is left is presentation: a strip of days and a month
 * grid, both read out of the schedule.
 */

export { weekEndOf, weekStartOf };

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type PlannerEventKind = ScheduledEvent['kind'];

/** Kept as the calendar's own shape, so the UI does not have to know the schedule's. */
export interface PlannerEvent {
  kind: PlannerEventKind;
  /** '19:00', '10:30am' — whatever the world says. */
  time: string;
  label: string;
  detail: string;
  priority: ScheduledEvent['priority'];
  resolved: boolean;
}

export interface PlannerDay {
  date: ISODate;
  weekday: number;
  weekdayLabel: string;
  /** '3' — the day of the month. */
  dayLabel: string;
  monthLabel: string;
  isToday: boolean;
  isPast: boolean;
  isMatchday: boolean;
  isTrainingDay: boolean;
  events: PlannerEvent[];
}

export function dayEvents(state: GameState, date: ISODate): PlannerEvent[] {
  return eventsOn(state, date).map((scheduled) => ({
    kind: scheduled.kind,
    time: scheduled.time ?? '',
    label: scheduled.title,
    detail: scheduled.detail,
    priority: scheduled.priority,
    resolved: scheduled.resolvedOn !== null,
  }));
}

export function plannerDay(state: GameState, date: ISODate): PlannerDay {
  const parsed = toDate(date);
  const weekday = parsed.getUTCDay();
  const events = dayEvents(state, date);
  return {
    date,
    weekday,
    weekdayLabel: WEEKDAY_SHORT[(weekday + 6) % 7]!,
    dayLabel: String(parsed.getUTCDate()),
    monthLabel: parsed.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
    isToday: date === state.date,
    isPast: date < state.date,
    isMatchday: events.some((event) => event.kind === 'league-match' || event.kind === 'cup-match'),
    isTrainingDay: events.some((event) => event.kind === 'training'),
    events,
  };
}

/** A run of days from the Monday of the week containing `from`. */
export function plannerDays(state: GameState, offsetWeeks = 0, count = 7, from?: ISODate): PlannerDay[] {
  const start = addDays(weekStartOf(from ?? state.date), offsetWeeks * 7);
  const days: PlannerDay[] = [];
  for (let i = 0; i < count; i += 1) days.push(plannerDay(state, addDays(start, i)));
  return days;
}

/**
 * A month laid out as calendar weeks, Monday first. `null` pads the first and
 * last rows so the grid lines up.
 */
export function plannerMonth(state: GameState, year: number, month: number): Array<PlannerDay | null> {
  const first = toISO(new Date(Date.UTC(year, month, 1)));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = (dayOfWeek(first) + 6) % 7;
  const cells: Array<PlannerDay | null> = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(plannerDay(state, toISO(new Date(Date.UTC(year, month, day)))));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Where the manager is in the match week: Monday (1) to Sunday (7).
 *
 * Kept because it is a genuinely useful thing to say — "matchday in three days"
 * reads better than a date — but it is no longer where the game keeps the time.
 */
export function weekProgress(state: GameState): { day: number; total: number } {
  const start = weekStartOf(state.date);
  const parsed = toDate(state.date);
  const offset = Math.round((parsed.getTime() - toDate(start).getTime()) / 86400000);
  return { day: offset + 1, total: 7 };
}

/** The matchday the manager is building towards, if the season still has one. */
export function upcomingMatchday(state: GameState): { matchday: number; date: ISODate | null } {
  const matchday = nextMatchday(state);
  const entry = state.season.calendar.find((candidate) => candidate.matchday === matchday);
  return { matchday, date: entry?.date ?? null };
}

export { matchdayOnDate };
