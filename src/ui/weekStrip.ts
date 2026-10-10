import type { ISODate } from '@/domain/ids';
import { toDate } from '@/simulation/calendar';
import type { PlannerDay, PlannerEvent, PlannerEventKind } from '@/simulation/planner';

/**
 * The week, as a bar across the top of a screen.
 *
 * A manager's week is not a list of fixtures — it is seven days with things on
 * some of them: a session tonight, a scout's report due, a friendly on Sunday,
 * and three days with nothing at all, which is information too. The calendar
 * screen shows that in a month grid, which answers "what is happening this
 * month"; this answers the question actually asked forty times a season — *what
 * is happening this week, and how long have I got* — without opening anything.
 *
 * Everything here is presentation of the schedule's own facts: the events come
 * from `plannerDays`, and this module decides only **how much weight** each one
 * gets and how the seven days are labelled. It imports no React and no state, so
 * the whole of it is testable without rendering.
 *
 * Two decisions worth knowing about:
 *
 *   - **a day has one colour and its events have their own.** The day's weight
 *     belongs to the match — the column a season is actually spent waiting for —
 *     so a matchday is tinted in the club's colour whatever else is on it. The
 *     events inside carry their own tone, so a training session on the Sunday
 *     still reads as a session;
 *   - **a column is not a page.** At most `limit` entries are shown and the rest
 *     are counted, because the strip's job is to say that Thursday is busy, not
 *     to be Thursday's screen.
 */

/** How heavy a day's event is, which is the only thing that decides its dot. */
export type WeekTone =
  /** A match — the thing the week is arranged around. */
  | 'match'
  /** A session: training, or the light work before a game. */
  | 'training'
  /** Something that wants the manager: an injury, a decision, a called-off game. */
  | 'attention'
  /** Club business he will be told about: a committee, a sponsor, a social. */
  | 'club'
  /** Background: the money, the world, the things that simply happen. */
  | 'quiet';

export interface WeekEntry {
  /** '19:00' or '', when the event has no particular hour. */
  time: string;
  label: string;
  tone: WeekTone;
  /** True when the manager has already dealt with it — played, or run. */
  resolved: boolean;
}

export interface WeekDayView {
  date: ISODate;
  /** 'Mon' — the column's own label. */
  weekdayLabel: string;
  /** '3' — the day of the month. */
  dayLabel: string;
  isToday: boolean;
  isPast: boolean;
  /** Whether the day holds a match, which is what a Thursday is waiting for. */
  isMatchday: boolean;
  entries: WeekEntry[];
  /** How many of the day's events a column was not big enough for. */
  hidden: number;
}

export interface WeekView {
  /** '3–9 August 2026' — the week's own name. */
  label: string;
  days: WeekDayView[];
  /** Days of the week from today onwards, today included; 0 once it is over. */
  remaining: number;
  /** How many matches the week holds, which is why there is a Saturday at all. */
  matchdays: number;
}

/** The kinds that *are* the week: everything else is what happens around them. */
const MATCH_KINDS: readonly PlannerEventKind[] = ['league-match', 'cup-match', 'friendly'];

/**
 * The kinds that simply happen: the money moving, the world turning, a squad's
 * availability rolling over. Nothing here is anybody's decision.
 *
 * Read from the kind rather than from the schedule's `source`, because a
 * `PlannerEvent` is the calendar's own shape and deliberately does not carry the
 * schedule's internals — the strip is downstream of the calendar, not beside it.
 */
const QUIET_KINDS: readonly PlannerEventKind[] = [
  'finance',
  'world-news',
  'club-formed',
  'club-folded',
  'manager-movement',
  'availability-roll',
  'availability-change',
  'registration',
];

/**
 * A day's tone, from what the event is and how loudly the schedule rates it.
 *
 * The order of these questions is the whole of the rule: a match is a match even
 * though it is `critical`, and a postponed one is still the day it was going to
 * be played on — which is exactly why it is flagged rather than hidden.
 */
export function toneOf(event: { kind: PlannerEventKind; priority: PlannerEvent['priority']; resolved: boolean }): WeekTone {
  if (MATCH_KINDS.includes(event.kind)) return 'match';
  if (event.kind === 'training') return 'training';
  if (event.kind === 'postponed' || event.kind === 'training-cancelled') return 'attention';
  // A cleared event stops asking for attention, which is how a resolved injury
  // stops shouting on the day it is fine again.
  if (!event.resolved && (event.priority === 'critical' || event.priority === 'important')) return 'attention';
  if (QUIET_KINDS.includes(event.kind)) return 'quiet';
  return 'club';
}

/**
 * An hour, as minutes past midnight, or `null` when the string is not one.
 *
 * Handles both shapes the world writes — '19:00' and '10:15am' — because the
 * calendar uses a 24-hour clock and a kick-off is written for a person. Sorting
 * is by this rather than by the string, so '9:00am' does not come after '10:00'.
 */
export function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(time.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const suffix = match[3]?.toLowerCase();
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * The day's entries, heaviest first and then in the order the day happens.
 *
 * A match leads whichever way round the clock it is, because the strip exists to
 * say "there is a game on Sunday" before it says anything else; an event with no
 * hour at all goes last, and a cleared one keeps its place rather than
 * disappearing — a session that has been run is worth seeing.
 */
function entriesFor(day: PlannerDay): WeekEntry[] {
  return day.events
    .map((event) => ({ event, minutes: minutesOf(event.time) }))
    .sort((a, b) => {
      const byMatch = Number(b.event.kind === 'league-match' || b.event.kind === 'cup-match') -
        Number(a.event.kind === 'league-match' || a.event.kind === 'cup-match');
      if (byMatch !== 0) return byMatch;
      const aTime = a.minutes;
      const bTime = b.minutes;
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return aTime - bTime;
    })
    .map(({ event }) => ({
      time: event.time,
      label: event.label,
      tone: toneOf(event),
      resolved: event.resolved,
    }));
}

/** 'August' for a date, in the same voice the rest of the calendar uses. */
function monthName(date: ISODate): string {
  return toDate(date).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/**
 * The week's own name.
 *
 * Three shapes, because a week does not care where the month boundary is:
 * '3–9 August 2026' inside one month, '31 August – 6 September 2026' across two,
 * and the year written out at both ends only when the week straddles that too —
 * which happens exactly once a season, and would otherwise read as a typo.
 */
export function weekLabel(days: readonly { date: ISODate; dayLabel: string }[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return '';
  const startYear = toDate(first.date).getUTCFullYear();
  const endYear = toDate(last.date).getUTCFullYear();
  const startMonth = monthName(first.date);
  const endMonth = monthName(last.date);
  if (startYear !== endYear) {
    return `${first.dayLabel} ${startMonth} ${startYear} – ${last.dayLabel} ${endMonth} ${endYear}`;
  }
  if (startMonth !== endMonth) {
    return `${first.dayLabel} ${startMonth} – ${last.dayLabel} ${endMonth} ${endYear}`;
  }
  return `${first.dayLabel}–${last.dayLabel} ${startMonth} ${startYear}`;
}

export interface WeekStripOptions {
  /** Entries shown per day before the rest are counted. */
  limit?: number;
}

/** Seven days as a bar: the labels, the weights, and how much did not fit. */
export function weekStripView(
  days: readonly PlannerDay[],
  today: ISODate,
  options: WeekStripOptions = {},
): WeekView {
  const limit = options.limit ?? 3;
  const view: WeekDayView[] = days.map((day) => {
    const all = entriesFor(day);
    return {
      date: day.date,
      weekdayLabel: day.weekdayLabel,
      dayLabel: day.dayLabel,
      isToday: day.date === today,
      isPast: day.date < today,
      isMatchday: all.some((entry) => entry.tone === 'match'),
      entries: all.slice(0, limit),
      hidden: Math.max(0, all.length - limit),
    };
  });

  return {
    label: weekLabel(view),
    days: view,
    remaining: view.filter((day) => !day.isPast).length,
    matchdays: view.filter((day) => day.isMatchday).length,
  };
}
