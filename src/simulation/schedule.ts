import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import type { Match, MatchConditions } from '@/domain/match';
import {
  emptyScheduleState,
  isBlocking,
  isFlagged,
  type RecurringEvent,
  type ScheduleState,
  type ScheduledEvent,
} from '@/domain/events';
import { addDays, daysBetween, formatDayMonth, toDate } from './calendar';
import { rollMatchConditions } from './matchday';
import { nextId } from './ids';
import { stream } from './rng';
import { sessionDateFor, sessionDatesFor, sessionKeyFor } from './training/plan';
import { sessionRecordedFor } from './training/store';
import { nextMatchday, weekStartOf } from './timeline';

/**
 * The one index of what is happening on the calendar.
 *
 * Nothing here simulates anything. It answers three questions:
 *
 *   1. What is on a given date? (`eventsOn`)
 *   2. What is the next thing worth stopping the manager for? (`nextStop`)
 *   3. What is due to be trained, paid or arranged, and when? (`recurringEvents`)
 *
 * Football facts stay where they already live. A fixture is not copied into the
 * schedule — it is *read* out of `state.matches`, which remains the authority on
 * when a match is played and whether it has been. The same is true of training
 * plans, availability and the season calendar. Only events with no other home (a
 * trial booked for Thursday, a committee meeting, a sponsor visit) are stored,
 * in `state.schedule.events`.
 */

export { emptyScheduleState } from '@/domain/events';

export function scheduleStore(state: GameState): ScheduleState {
  if (!state.schedule) state.schedule = emptyScheduleState();
  if (!Array.isArray(state.schedule.events)) state.schedule.events = [];
  return state.schedule;
}

// ---------------------------------------------------------------------------
// What is on a date
// ---------------------------------------------------------------------------

/** Every fixture taking place on this date, earliest kick-off first. */
export function fixturesOnDate(state: GameState, date: ISODate): Match[] {
  return Object.values(state.matches)
    .filter((match) => match.date === date)
    .sort((a, b) => (a.kickOff < b.kickOff ? -1 : a.kickOff > b.kickOff ? 1 : 0));
}

/** The manager's own fixture on a date, if there is one. */
export function userMatchOn(state: GameState, date: ISODate): Match | null {
  return (
    fixturesOnDate(state, date).find(
      (match) => match.homeClubId === state.userClubId || match.awayClubId === state.userClubId,
    ) ?? null
  );
}

/** The next unplayed fixture for a club, on or after `from`. */
export function nextFixtureFor(state: GameState, clubId: ClubId, from: ISODate = state.date): Match | null {
  const upcoming = Object.values(state.matches)
    .filter(
      (match) =>
        !match.played &&
        match.status === 'scheduled' &&
        (match.homeClubId === clubId || match.awayClubId === clubId) &&
        match.date >= from,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return upcoming[0] ?? null;
}

/**
 * Events the world already knows about, worked out on the spot.
 *
 * The day's shape is: football first, then training, then the bookkeeping, then
 * the season's own milestones — the same order `day.ts` processes them in.
 */
export function derivedEventsOn(state: GameState, date: ISODate): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  const clubId = state.userClubId;
  const myMatch = userMatchOn(state, date);

  if (myMatch) {
    const opponentId = myMatch.homeClubId === clubId ? myMatch.awayClubId : myMatch.homeClubId;
    const opponent = state.clubs[opponentId]?.identity.name ?? 'the opposition';
    const home = myMatch.homeClubId === clubId;
    const groundName = state.world.grounds[myMatch.groundId]?.name ?? 'ground to confirm';
    const base = {
      time: myMatch.kickOff,
      source: 'fixture' as const,
      matchId: myMatch.id,
      clubIds: [clubId, opponentId],
      personIds: [],
      data: { competition: myMatch.competitionName, venue: home ? 'Home' : 'Away' },
    };

    if (myMatch.status === 'abandoned' || myMatch.status === 'postponed') {
      events.push({
        ...base,
        id: `fixture_${myMatch.id}`,
        date,
        kind: 'postponed',
        priority: 'informational',
        title: myMatch.status === 'abandoned' ? 'Fixture abandoned' : 'Called off',
        detail: myMatch.postponementReason ?? 'The game did not go ahead.',
        // Resolved on the day it was called off: a game that is not happening
        // must never block the clock.
        resolvedOn: date,
        resolution: myMatch.postponementReason ?? 'Abandoned',
      });
    } else if (myMatch.played) {
      const mine = home ? myMatch.result?.homeGoals ?? 0 : myMatch.result?.awayGoals ?? 0;
      const theirs = home ? myMatch.result?.awayGoals ?? 0 : myMatch.result?.homeGoals ?? 0;
      const verdict = mine > theirs ? 'Won' : mine === theirs ? 'Drew' : 'Lost';
      events.push({
        ...base,
        id: `fixture_${myMatch.id}`,
        date,
        kind: 'league-match',
        priority: 'important',
        title: `${verdict} ${mine}–${theirs} against ${opponent}`,
        detail: `${myMatch.competitionName} · ${groundName}`,
        resolvedOn: date,
        resolution: 'Played',
      });
    } else {
      events.push({
        ...base,
        id: `fixture_${myMatch.id}`,
        date,
        kind: 'league-match',
        priority: 'critical',
        title: `${home ? 'Home against' : 'Away at'} ${opponent}`,
        detail: `${myMatch.competitionName} · ${groundName}`,
        resolvedOn: null,
        resolution: null,
      });
    }

    const others = fixturesOnDate(state, date).length - 1;
    if (others > 0) {
      events.push({
        id: `other-fixtures_${date}`,
        date,
        time: null,
        kind: 'league-match',
        priority: 'informational',
        source: 'fixture',
        title: `${others} other fixture${others === 1 ? '' : 's'} in the division`,
        detail: 'Everyone else plays the same Sunday.',
        resolvedOn: null,
        resolution: null,
        matchId: null,
        clubIds: [],
        personIds: [],
        data: { others },
      });
    }
  }

  // Every Thursday the club trains, pre-season included: the session is the
  // same appointment in July as it is in February.
  if (sessionDatesFor(state).includes(date)) {
    const key = sessionKeyFor(state, date);
    const recorded = sessionRecordedFor(state, clubId, key);
    events.push({
      id: `training_${key}`,
      date,
      time: '19:00',
      kind: 'training',
      priority: recorded ? 'informational' : 'important',
      source: 'training',
      title: recorded ? 'Training (done)' : 'Training tonight',
      detail: recorded
        ? 'The session has been run.'
        : 'Once a week, half the squad straight from work. Plan it, then run it.',
      resolvedOn: recorded ? date : null,
      resolution: recorded ? 'Run' : null,
      matchId: null,
      clubIds: [clubId],
      personIds: [],
      data: { sessionKey: key },
    });
  }

  for (const rule of recurringEvents(state)) {
    if (rule.id === 'rec_training') continue;
    if (!recursOn(rule, date)) continue;
    events.push({
      id: `${rule.id}_${date}`,
      date,
      time: rule.time ?? null,
      kind: rule.kind,
      priority: rule.priority,
      source: rule.source,
      title: rule.title,
      detail: rule.detail,
      resolvedOn: null,
      resolution: null,
      matchId: null,
      clubIds: [clubId],
      personIds: [],
      data: {},
    });
  }

  const first = state.season.calendar[0]?.date;
  const last = state.season.calendar[state.season.calendar.length - 1]?.date;

  // Pre-season begins on the season's own start date, which is the Monday the
  // club's year opens. It used to be dated to the Monday of the week the first
  // fixture falls in, which is the *last* Monday of pre-season: the game
  // announced that pre-season had begun on the day it finished, six weeks
  // after it had.
  const preSeasonOpens = state.season.startDate;
  if (first && preSeasonOpens && date === preSeasonOpens) {
    events.push({
      id: `season-start_${first}`,
      date,
      time: null,
      kind: 'registration',
      priority: 'important',
      source: 'season',
      title: 'Pre-season begins',
      detail: `Registration is open, the pitch needs marking, and the first Sunday is ${formatDayMonth(first)}.`,
      resolvedOn: null,
      resolution: null,
      matchId: null,
      clubIds: [clubId],
      personIds: [],
      data: {},
    });
  }

  if (last && date === addDays(last, 1)) {
    events.push({
      id: `season-end_${last}`,
      date,
      time: null,
      kind: 'season-end',
      priority: 'critical',
      source: 'season',
      title: state.phase === 'complete' ? `${state.season.label} is over` : 'The last Sunday has been played',
      detail:
        state.phase === 'complete'
          ? 'Positions are settled. Time for the AGM, the presentation night and a rest.'
          : 'One more day to see the season out properly.',
      resolvedOn: state.phase === 'complete' ? null : date,
      resolution: null,
      matchId: null,
      clubIds: [clubId],
      personIds: [],
      data: {},
    });
  }

  if (last && date === addDays(last, 5)) {
    events.push({
      id: `agm_${last}`,
      date,
      time: '19:30',
      kind: 'agm',
      priority: 'informational',
      source: 'club',
      title: 'Annual general meeting',
      detail: 'The committee, the treasurer and whoever else turns up in the clubhouse.',
      resolvedOn: null,
      resolution: null,
      matchId: null,
      clubIds: [clubId],
      personIds: [],
      data: {},
    });
  }

  return events;
}

/** Derived events plus anything systems have scheduled, in day order. */
export function eventsOn(state: GameState, date: ISODate): ScheduledEvent[] {
  const stored = scheduleStore(state).events.filter((item) => item.date === date);
  return [...derivedEventsOn(state, date), ...stored].sort(compareEvents);
}

const PRIORITY_WEIGHT = { critical: 0, important: 1, informational: 2, background: 3 } as const;

function compareEvents(a: ScheduledEvent, b: ScheduledEvent): number {
  const aTime = a.time ?? '';
  const bTime = b.time ?? '';
  if (aTime !== bTime) {
    if (!aTime) return -1;
    if (!bTime) return 1;
    return aTime < bTime ? -1 : 1;
  }
  return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
}

/** The next handful of things worth putting in front of the manager. */
export function upcomingEvents(state: GameState, from: ISODate = state.date, count = 8): ScheduledEvent[] {
  const found: ScheduledEvent[] = [];
  let date = from;
  for (let day = 0; day < 120 && found.length < count; day += 1) {
    found.push(
      ...eventsOn(state, date).filter(
        (item) => item.priority === 'critical' || item.priority === 'important',
      ),
    );
    date = addDays(date, 1);
  }
  return found.slice(0, count);
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

/** Events that stop the clock: the day cannot pass until they are dealt with. */
export function blockingEventsOn(state: GameState, date: ISODate): ScheduledEvent[] {
  return eventsOn(state, date).filter(isBlocking);
}

/** Events worth showing the manager when the clock reaches the day. */
export function flaggedEventsOn(state: GameState, date: ISODate): ScheduledEvent[] {
  return eventsOn(state, date).filter(isFlagged);
}

export interface ScheduleStop {
  date: ISODate;
  events: ScheduledEvent[];
  headline: string;
  detail: string;
  kind: 'blocking' | 'flagged' | 'none';
}

/** The next date worth stopping on, and why. */
export function nextStop(state: GameState, from: ISODate = state.date, horizon = 120): ScheduleStop {
  let date = from;
  for (let i = 0; i < horizon; i += 1) {
    const blocking = blockingEventsOn(state, date);
    if (blocking.length > 0) return stopAt(date, blocking, 'blocking');
    const flagged = flaggedEventsOn(state, date);
    if (flagged.length > 0 && !alreadyShown(state, date)) return stopAt(date, flagged, 'flagged');
    date = addDays(date, 1);
  }
  return { date, events: [], headline: 'Nothing on the horizon', detail: 'The calendar is clear.', kind: 'none' };
}

function alreadyShown(state: GameState, date: ISODate): boolean {
  const through = scheduleStore(state).notifiedThrough;
  return through !== null && date <= through;
}

function stopAt(date: ISODate, events: ScheduledEvent[], kind: ScheduleStop['kind']): ScheduleStop {
  const lead = events[0]!;
  return { date, events, headline: lead.title, detail: lead.detail, kind };
}

// ---------------------------------------------------------------------------
// Scheduling and resolving
// ---------------------------------------------------------------------------

export interface ScheduledEventSeed {
  date: ISODate;
  time?: string | null;
  kind: ScheduledEvent['kind'];
  priority: ScheduledEvent['priority'];
  source: ScheduledEvent['source'];
  title: string;
  detail: string;
  clubIds?: ClubId[];
  personIds?: PersonId[];
  data?: Record<string, string | number>;
}

/** Book something in. Used by systems that know something the calendar does not. */
export function scheduleEvent(state: GameState, seed: ScheduledEventSeed): ScheduledEvent {
  const store = scheduleStore(state);
  const created: ScheduledEvent = {
    id: nextId(state, 'event'),
    date: seed.date,
    time: seed.time ?? null,
    kind: seed.kind,
    priority: seed.priority,
    source: seed.source,
    title: seed.title,
    detail: seed.detail,
    resolvedOn: null,
    resolution: null,
    matchId: null,
    clubIds: seed.clubIds ?? [],
    personIds: seed.personIds ?? [],
    data: seed.data ?? {},
  };
  store.events.push(created);
  // Keep the store tidy: a career should not grow a diary it can never forget.
  const resolved = store.events.filter((item) => item.resolvedOn !== null);
  if (store.events.length > 160) {
    store.events = store.events.filter((item) => item.resolvedOn === null).concat(resolved.slice(-40));
  }
  return created;
}

export function resolveScheduledEvent(
  state: GameState,
  id: string,
  resolution = 'Done',
  on: ISODate = state.date,
): void {
  const found = scheduleStore(state).events.find((item) => item.id === id);
  if (!found || found.resolvedOn) return;
  found.resolvedOn = on;
  found.resolution = resolution;
}

/** Mark the manager as having been shown everything up to and including a date. */
export function markNotifiedThrough(state: GameState, date: ISODate): void {
  const store = scheduleStore(state);
  if (!store.notifiedThrough || store.notifiedThrough < date) store.notifiedThrough = date;
}

/**
 * Book a trial that has been agreed against the calendar.
 *
 * The trial itself is run by the training session on its own date — this only
 * makes the promise visible: the manager can see who is coming down, and when,
 * without the recruitment screen having to remember it.
 */
export function scheduleTrial(state: GameState, personId: PersonId, note: string): ScheduledEvent {
  // The next night the club actually trains, which in pre-season is that week's
  // session rather than the one before the opening fixture.
  const date =
    sessionDatesFor(state).find((candidate) => candidate >= state.date) ?? sessionDateFor(state, nextMatchday(state));
  return scheduleEvent(state, {
    date,
    time: '19:00',
    kind: 'trial',
    priority: 'informational',
    source: 'recruitment',
    title: 'Trialist down at training',
    detail: note,
    clubIds: [state.userClubId],
    personIds: [personId],
  });
}

/** Events scheduled for a person, on or after a date — used by trials and approaches. */
export function scheduledForPerson(state: GameState, personId: PersonId, from: ISODate): ScheduledEvent[] {
  return scheduleStore(state)
    .events.filter((item) => item.date >= from && item.personIds.includes(personId))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Recurring commitments
// ---------------------------------------------------------------------------

/**
 * The club's standing arrangements, expressed as dates rather than as a weekly
 * tick. "Training every Thursday" is a rule; "training happened because the week
 * advanced" was not.
 */
export function recurringEvents(state: GameState): RecurringEvent[] {
  const first = state.season.calendar[0]?.date;
  const last = state.season.calendar[state.season.calendar.length - 1]?.date;
  if (!first || !last) return [];
  // The club's week starts when the manager does, not when the league does: subs
  // are collected, the pitch is paid for and training happens in July too.
  const startsOn = weekStartOf(state.season.startDate);

  return [
    {
      id: 'rec_training',
      kind: 'training',
      priority: 'important',
      source: 'training',
      title: 'Training',
      detail: 'Once a week, whatever the weather.',
      frequency: 'weekly',
      weekday: 4, // Thursday
      startsOn,
      endsOn: last,
      time: '19:00',
    },
    {
      id: 'rec_availability',
      kind: 'availability-roll',
      priority: 'background',
      source: 'player',
      title: "The week's availability goes up",
      detail: 'Shifts, holidays and family plans are sorted for the coming Sunday.',
      frequency: 'weekly',
      weekday: 1, // Monday
      startsOn,
      endsOn: last,
    },
    {
      id: 'rec_costs',
      kind: 'finance',
      priority: 'background',
      source: 'finance',
      title: 'Standing costs paid',
      detail: 'Pitch hire, insurance and equipment come out of the account.',
      frequency: 'weekly',
      weekday: 3, // Wednesday
      startsOn,
      endsOn: last,
    },
  ];
}

/** Does a repeating commitment fall on this date? */
export function recursOn(rule: RecurringEvent, date: ISODate): boolean {
  if (date < rule.startsOn) return false;
  if (rule.endsOn && date > rule.endsOn) return false;
  const parsed = toDate(date);
  const weekday = rule.weekday ?? toDate(rule.startsOn).getUTCDay();
  switch (rule.frequency) {
    case 'weekly':
      return parsed.getUTCDay() === weekday;
    case 'fortnightly':
      return (
        parsed.getUTCDay() === weekday && Math.floor(daysBetween(rule.startsOn, date) / 7) % 2 === 0
      );
    case 'monthly':
      return parsed.getUTCDate() === (rule.dayOfMonth ?? 1);
    case 'annual':
      return (
        parsed.getUTCMonth() === (rule.month ?? toDate(rule.startsOn).getUTCMonth()) &&
        parsed.getUTCDate() === (rule.dayOfMonth ?? toDate(rule.startsOn).getUTCDate())
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export interface DayWeather extends MatchConditions {
  date: ISODate;
  groundName: string;
}

/**
 * What it is like outside on a given date.
 *
 * Weather belongs to a place and a day, not to a match: the same Sunday is the
 * same Sunday whether or not anybody is playing on it. It is derived from the
 * seed, so a save resumes with exactly the weather it would have had.
 */
export function dayWeather(state: GameState, date: ISODate): DayWeather | null {
  const club = state.clubs[state.userClubId];
  const ground = club ? state.world.grounds[club.groundId] : undefined;
  if (!ground) return null;
  const conditions = rollMatchConditions(stream(state.seed, 'day-weather', ground.id, date), ground, date);
  return { ...conditions, date, groundName: ground.name };
}
