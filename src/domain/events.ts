import type { ClubId, ISODate, MatchId, PersonId } from './ids';

/**
 * The calendar.
 *
 * Game time does not move in weeks: it moves one day at a time, and everything
 * that happens is an *event* on a date. A fixture is an event, Thursday night is
 * an event, a player's shift rota is an event, the subs go out on a Friday and
 * the AGM is an event. Systems do not each keep their own clock — they schedule
 * against this one.
 *
 * Two kinds of event exist:
 *
 *  - **Derived** events are worked out from state that already exists (the
 *    fixture list, the season calendar, a club's training plan, the recurring
 *    finance dates). They are never saved, because saving them would give the
 *    same fact two homes.
 *  - **Stored** events are scheduled on the spot by a system that knows
 *    something the rest of the world does not: a trial on Thursday, a committee
 *    meeting, a sponsor coming to the ground. These live in `state.schedule`.
 *
 * `ScheduleState` also remembers how far the manager has been *told* about what
 * is coming, so Continue can stop on a day worth stopping on exactly once.
 */

export type ScheduledEventKind =
  // Football
  | 'league-match'
  | 'cup-match'
  | 'friendly'
  | 'postponed'
  // Training
  | 'training'
  | 'training-cancelled'
  // Player
  | 'availability-roll'
  | 'availability-change'
  | 'injury'
  | 'return-from-injury'
  | 'suspension'
  | 'approach'
  | 'trial'
  | 'signing'
  | 'departure'
  // Club
  | 'agm'
  | 'committee'
  | 'fundraising'
  | 'sponsor'
  | 'ground'
  | 'finance'
  | 'registration'
  // Social
  | 'five-a-side'
  | 'social'
  | 'testimonial'
  | 'charity'
  // World
  | 'world-news'
  | 'club-formed'
  | 'club-folded'
  | 'manager-movement'
  // Season
  | 'season-start'
  | 'season-end'
  | 'awards'
  | 'offseason';

/**
 * How much of the manager's attention an event deserves.
 *
 * This is the only thing that decides whether the clock stops, whether the
 * event makes the news, and how loudly the interface presents it.
 */
export type EventPriority =
  /** Stop the clock: the day cannot pass until the manager has dealt with it. */
  | 'critical'
  /** Stop the clock on arrival, and say so in the news. */
  | 'important'
  /** No interruption; it belongs in the feed. */
  | 'informational'
  /** Simulated silently. */
  | 'background';

/** Where an event came from — useful for filtering and for honest UI labels. */
export type ScheduleSource =
  | 'fixture'
  | 'training'
  | 'player'
  | 'club'
  | 'social'
  | 'world'
  | 'finance'
  | 'recruitment'
  | 'season';

export interface ScheduledEvent {
  id: string;
  date: ISODate;
  /** '19:00', '10:30am' — or null for something with no particular hour. */
  time: string | null;
  kind: ScheduledEventKind;
  priority: EventPriority;
  source: ScheduleSource;
  title: string;
  detail: string;
  /** True when the manager has already cleared it (played the match, run the session). */
  resolvedOn: ISODate | null;
  resolution: string | null;
  matchId: MatchId | null;
  clubIds: ClubId[];
  personIds: PersonId[];
  /** Structured extras, for templates and for systems that need the specifics. */
  data: Record<string, string | number>;
}

/** What the manager has to be told before a day can pass. */
export function isBlocking(event: ScheduledEvent): boolean {
  return event.priority === 'critical' && event.resolvedOn === null;
}

/** Worth stopping on when the clock arrives, but not worth refusing to move on. */
export function isFlagged(event: ScheduledEvent): boolean {
  return event.priority === 'important' && event.resolvedOn === null;
}

export function needsAttention(event: ScheduledEvent): boolean {
  return isBlocking(event) || isFlagged(event);
}

/**
 * A repeating commitment.
 *
 * Deliberately tiny: a frequency, a date it starts, an optional end, and a
 * rule for which days it lands on. There is no cron engine and there does not
 * need to be one — "training every Thursday" and "subs every Friday" are the
 * whole requirement.
 */
export type RecurrenceFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'annual';

export interface RecurringEvent {
  id: string;
  kind: ScheduledEventKind;
  priority: EventPriority;
  source: ScheduleSource;
  title: string;
  detail: string;
  frequency: RecurrenceFrequency;
  /** 0 = Sunday. Used by weekly and fortnightly rules. */
  weekday?: number;
  /** 1-31. Used by monthly and annual rules. */
  dayOfMonth?: number;
  /** 0-11. Used by annual rules. */
  month?: number;
  /** The first date the rule can fire on. */
  startsOn: ISODate;
  /** The last date it can fire on, or null for "until the world ends". */
  endsOn: ISODate | null;
  /** How much of the day it eats up, for the calendar's benefit only. */
  time?: string | null;
}

export interface ScheduleState {
  /** Events scheduled on the spot by systems, in date order. */
  events: ScheduledEvent[];
  /**
   * The last date whose arrivals have already been shown to the manager.
   * Continue stops once on a day worth stopping on, and never twice.
   */
  notifiedThrough: ISODate | null;
}

export function emptyScheduleState(): ScheduleState {
  return { events: [], notifiedThrough: null };
}
