import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import {
  emptyAdminState,
  isAdminOutstanding,
  isAdminOverdue,
  type AdminCategory,
  type AdminEvent,
  type AdminImportance,
  type AdminSource,
  type AdminState,
} from '@/domain/admin';
import { isOfficial, isPlayer, personDisplayName } from '@/domain/person';
import { addDays, formatDayMonth } from './calendar';
import { nextId } from './ids';
import { createEvent } from './news';
import { staffCompetence, staffIsAvailable } from './staff';

/**
 * The secretary.
 *
 * Football administration is the paperwork nobody watches: registrations, league
 * deadlines, AGMs, cup entry forms, suspensions the county has confirmed, a
 * fixture the league has moved. It all has one natural owner, and without him it
 * lands on the manager's desk half-read.
 *
 * This service is the secretary's desk. It does not keep a second calendar and
 * it does not decide any football: a fixture change is read *out of* the match
 * record and merely written up as correspondence, and an AGM is read off the
 * season's own dates. What it owns is the *inbox* — what has been received, what
 * the manager has to do about it, and whether it was done in time.
 *
 * Competence is expressed the way every other role's is: as a nudge, never as a
 * new rule. A good secretary gets the letter to the manager early and files the
 * routine noise himself; a poor one delivers it late and lets it clutter the
 * desk. Nothing either of them does can move a fixture, change a result or
 * corrupt a save — the worst a bad secretary can do is cost the manager time.
 */

/* ------------------------------------------------------------------------ *\
 * The store
 * ------------------------------------------------------------------------ */

export function secretaryStore(state: GameState): AdminState {
  if (!state.admin) state.admin = emptyAdminState();
  if (!Array.isArray(state.admin.events)) state.admin.events = [];
  return state.admin;
}

/* ------------------------------------------------------------------------ *\
 * Who keeps the paperwork
 * ------------------------------------------------------------------------ */

export interface SecretaryIdentity {
  personId: PersonId | null;
  name: string | null;
  /** 1-20, on the same scale as every other staff judgement. 0 when unknowable. */
  competence: number;
  available: boolean;
}

export function clubSecretary(state: GameState, clubId: ClubId = state.userClubId): SecretaryIdentity {
  const id = state.clubs[clubId]?.staff?.secretaryId ?? null;
  const person = id ? state.people[id] : undefined;
  if (!person) return { personId: null, name: null, competence: 0, available: true };
  const official = isOfficial(person) ? person : null;
  return {
    personId: person.id,
    name: personDisplayName(person),
    competence: official ? staffCompetence(official, 'secretary') : 0,
    available: official ? staffIsAvailable(official) : true,
  };
}

/* ------------------------------------------------------------------------ *\
 * Receiving correspondence
 * ------------------------------------------------------------------------ */

/** How far ahead of a dated item the secretary puts it in front of the manager. */
function leadDays(competence: number): number {
  if (competence <= 0) return 0;
  return Math.max(1, Math.round((competence / 20) * 8));
}

interface AdminSeed {
  key: string;
  date: ISODate;
  deadline?: ISODate | null;
  source: AdminSource;
  category: AdminCategory;
  importance: AdminImportance;
  actionRequired: boolean;
  title: string;
  detail: string;
  /** Reactive correspondence, logged the moment it is true rather than with lead. */
  immediate?: boolean;
  /** The underlying fact can change — refresh the letter rather than post another. */
  refresh?: boolean;
  attendanceRequired?: boolean;
  agenda?: string[];
  personIds?: PersonId[];
  competitionId?: string | null;
  matchId?: string | null;
}

/**
 * Everything the secretary is holding this season.
 *
 * The season items are read off the calendar's own dates; the fixture and
 * disciplinary items come from the authoritative records those systems already
 * keep. Nothing here invents an event the rest of the game does not already know
 * about — it is correspondence *about* facts, not the facts themselves.
 */
function adminCandidates(state: GameState, clubId: ClubId): AdminSeed[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const season = state.season;
  const calendar = season.calendar;
  const first = calendar[0]?.date ?? season.startDate;
  const last = calendar[calendar.length - 1]?.date ?? season.endDate;
  const seeds: AdminSeed[] = [];

  // --- Season paperwork, keyed by the season so next year brings its own ----

  seeds.push({
    key: `admin:registration:${season.id}`,
    date: season.startDate,
    deadline: addDays(first, -3),
    source: 'league',
    category: 'registration',
    importance: 3,
    actionRequired: true,
    title: 'League registration',
    detail: `Squad lists, player registrations and the league forms must be with the league by ${formatDayMonth(addDays(first, -3))}.`,
    competitionId: null,
  });

  seeds.push({
    key: `admin:league-agm:${season.id}`,
    date: addDays(last, 14),
    deadline: addDays(last, 7),
    source: 'league',
    category: 'agm',
    importance: 3,
    actionRequired: true,
    attendanceRequired: true,
    agenda: [
      'Election of league officers',
      'Rule changes and club proposals',
      'Fees for the coming season',
      'Any other business',
    ],
    title: 'League AGM',
    detail: `The league meets at the end of the season. Clubs must submit proposals by ${formatDayMonth(addDays(last, 7))} and send a delegate.`,
  });

  seeds.push({
    key: `admin:club-agm:${season.id}`,
    date: addDays(last, 5),
    deadline: addDays(last, 5),
    source: 'club',
    category: 'agm',
    importance: 2,
    actionRequired: true,
    attendanceRequired: true,
    agenda: [
      'Accounts for the season',
      'Election of the committee',
      'Subs and fees for next season',
      'Any other business',
    ],
    title: 'Club AGM',
    detail: 'The committee meets in the clubhouse. The accounts and the committee are up for approval.',
  });

  seeds.push({
    key: `admin:bulletin:${season.id}`,
    date: addDays(first, 21),
    source: 'league',
    category: 'correspondence',
    importance: 1,
    actionRequired: false,
    title: 'League bulletin',
    detail: "This month's league notes: pitch inspections, a shortage of referees, and the usual reminders.",
  });

  // --- Fixtures the league has moved ----------------------------------------
  // Read out of `state.matches`, which stays the authority on when the game is
  // played. The secretary writes the letter; he does not schedule the game, and
  // a letter is not a fixture.
  for (const match of Object.values(state.matches)) {
    if (match.homeClubId !== clubId && match.awayClubId !== clubId) continue;
    if (match.status !== 'postponed' && match.status !== 'abandoned') continue;
    const reason = match.postponementReason;
    if (!reason) continue;
    const replacement = match.replacedByMatchId ? state.matches[match.replacedByMatchId] : undefined;
    const when = replacement
      ? ` It has been rearranged for ${formatDayMonth(replacement.date)}.`
      : ' There is no new date yet.';
    seeds.push({
      key: `admin:fixture:${match.id}`,
      date: match.postponedOn ?? match.date,
      source: 'competition',
      category: 'fixture-admin',
      importance: 2,
      actionRequired: false,
      immediate: true,
      refresh: true,
      matchId: match.id,
      competitionId: match.competitionId,
      title: match.status === 'abandoned' ? 'Fixture abandoned' : 'Fixture called off',
      detail: `${match.competitionName}: ${reason}.${when}`,
    });
  }

  // --- Disciplinary correspondence ------------------------------------------
  for (const playerId of club.squadIds) {
    const person = state.people[playerId];
    if (!isPlayer(person)) continue;
    if (person.availability?.reason !== 'suspension') continue;
    const until = person.availability.until;
    seeds.push({
      key: `admin:suspension:${person.id}:${until ?? 'open'}`,
      date: state.date,
      source: 'fa',
      category: 'disciplinary',
      importance: 2,
      actionRequired: false,
      immediate: true,
      personIds: [person.id],
      title: `${personDisplayName(person)} suspended`,
      detail: `The county has confirmed ${personDisplayName(person)}'s ${person.availability.note ?? 'suspension'}${until ? `, back on ${formatDayMonth(until)}` : ''}.`,
    });
  }

  return seeds;
}

function logAdminEvent(
  state: GameState,
  clubId: ClubId,
  seed: AdminSeed,
  identity: SecretaryIdentity,
  receivedOn: ISODate,
  filedAutomatically: boolean,
): AdminEvent {
  const store = secretaryStore(state);
  const event: AdminEvent = {
    id: nextId(state, 'admin'),
    key: seed.key,
    receivedOn,
    date: seed.date,
    deadline: seed.deadline ?? null,
    source: seed.source,
    category: seed.category,
    importance: seed.importance,
    actionRequired: seed.actionRequired,
    title: seed.title,
    detail: seed.detail,
    status: filedAutomatically ? 'handled' : 'open',
    handledOn: filedAutomatically ? receivedOn : null,
    handledBy: filedAutomatically ? (identity.personId ?? null) : null,
    attendanceRequired: seed.attendanceRequired ?? false,
    agenda: seed.agenda ?? [],
    clubIds: [clubId],
    personIds: seed.personIds ?? [],
    competitionId: seed.competitionId ?? null,
    matchId: seed.matchId ?? null,
  };
  store.events.push(event);
  // A career keeps its desk, not an archive: the oldest closed letters go first.
  if (store.events.length > 200) {
    const open = store.events.filter((item) => item.status === 'open');
    const closed = store.events.filter((item) => item.status !== 'open');
    store.events = [...open, ...closed.slice(-80)];
  }
  return event;
}

export interface SecretaryOutcome {
  events: GameEvent[];
  /** Correspondence received on this day. */
  received: AdminEvent[];
  /** Items whose deadline passed with nothing done. */
  missed: AdminEvent[];
}

/**
 * The secretary's day.
 *
 * Runs every day and does two things, in order:
 *
 *  1. Anything whose deadline has passed while still open is marked missed, and
 *     the manager is told. This happens whether or not there is a secretary — a
 *     missed league deadline is a fact about the club, not about the man.
 *  2. New correspondence is logged, with the lead a competent secretary buys.
 *     A secretary who is away does not log anything: the post waits on the mat,
 *     and that is the honest cost of a week without him.
 *
 * Nothing here moves a fixture, changes a result, or touches the ledger. The
 * worst a poor secretary can do is hand something to the manager late.
 */
export function runSecretary(
  state: GameState,
  date: ISODate = state.date,
  clubId: ClubId = state.userClubId,
): SecretaryOutcome {
  const out: SecretaryOutcome = { events: [], received: [], missed: [] };
  const club = state.clubs[clubId];
  if (!club) return out;
  const identity = clubSecretary(state, clubId);

  // 1. Deadlines that have gone by.
  for (const event of secretaryStore(state).events) {
    if (!isAdminOverdue(event, date)) continue;
    event.status = 'missed';
    out.missed.push(event);
    out.events.push(
      createEvent(state, {
        type: 'club-event',
        importance: 3,
        clubIds: event.clubIds,
        personIds: event.personIds,
        data: {
          headline: `Missed deadline: ${event.title}`,
          body: `${event.detail} The deadline was ${formatDayMonth(event.deadline!)} and nothing was submitted.`,
        },
      }),
    );
  }

  // 2. New correspondence. An absent secretary receives nothing today.
  if (identity.personId && !identity.available) return out;

  const lead = leadDays(identity.competence);
  for (const seed of adminCandidates(state, clubId)) {
    if (!seed.immediate && date < addDays(seed.date, -lead)) continue;

    const existing = secretaryStore(state).events.find((event) => event.key === seed.key);
    if (existing) {
      // A fact that has changed — a fixture moved again — updates the letter in
      // hand rather than posting a second one.
      if (seed.refresh && existing.status === 'open') {
        existing.date = seed.date;
        existing.detail = seed.detail;
        existing.deadline = seed.deadline ?? null;
        existing.importance = seed.importance;
      }
      continue;
    }

    // A competent secretary files the routine noise himself. A poor one lets it
    // pile up on the manager's desk, which is the extra work the role is meant
    // to prevent.
    const filedAutomatically = !seed.actionRequired && seed.importance <= 1 && identity.competence >= 10;
    const event = logAdminEvent(state, clubId, seed, identity, date, filedAutomatically);
    out.received.push(event);

    if (!filedAutomatically && (event.actionRequired || event.importance >= 2)) {
      out.events.push(
        createEvent(state, {
          type: 'club-event',
          importance: event.importance,
          clubIds: event.clubIds,
          personIds: event.personIds,
          data: { headline: event.title, body: event.detail },
        }),
      );
    }
  }

  return out;
}

/* ------------------------------------------------------------------------ *\
 * Reading the desk
 * ------------------------------------------------------------------------ */

/** Open correspondence for the club, the manager's own work first. */
export function outstandingAdmin(state: GameState, clubId: ClubId = state.userClubId): AdminEvent[] {
  return secretaryStore(state)
    .events.filter((event) => isAdminOutstanding(event) && (event.clubIds.length === 0 || event.clubIds.includes(clubId)))
    .sort((a, b) => {
      if (a.actionRequired !== b.actionRequired) return a.actionRequired ? -1 : 1;
      const aDue = a.deadline ?? a.date;
      const bDue = b.deadline ?? b.date;
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;
      return b.importance - a.importance;
    });
}

/** Everything already closed, newest first — the record of what was done. */
export function filedAdmin(state: GameState, clubId: ClubId = state.userClubId): AdminEvent[] {
  return secretaryStore(state)
    .events.filter((event) => event.status !== 'open' && (event.clubIds.length === 0 || event.clubIds.includes(clubId)))
    .sort((a, b) => (a.receivedOn === b.receivedOn ? 0 : a.receivedOn < b.receivedOn ? 1 : -1));
}

export function overdueAdmin(state: GameState, date: ISODate = state.date, clubId: ClubId = state.userClubId): AdminEvent[] {
  return outstandingAdmin(state, clubId).filter((event) => isAdminOverdue(event, date));
}

/**
 * Close an item.
 *
 * Whose desk it was is recorded: an item that needed the manager and got him is
 * marked handled by him, and a routine one filed by the secretary names the
 * secretary. This closes a letter and nothing else.
 */
export function resolveAdminEvent(
  state: GameState,
  id: string,
  date: ISODate = state.date,
  by: PersonId | null = null,
): AdminEvent | null {
  const event = secretaryStore(state).events.find((item) => item.id === id);
  if (!event || event.status !== 'open') return null;
  event.status = 'handled';
  event.handledOn = date;
  event.handledBy = by;
  return event;
}

export interface SecretarySummary {
  identity: SecretaryIdentity;
  outstanding: AdminEvent[];
  /** Open items the manager himself has to deal with. */
  needsManager: number;
  /** Open items already past their deadline. */
  overdue: number;
  /** Closed by the secretary without troubling the manager. */
  filed: number;
}

export function secretarySummary(state: GameState, clubId: ClubId = state.userClubId): SecretarySummary {
  const outstanding = outstandingAdmin(state, clubId);
  const filed = secretaryStore(state).events.filter(
    (event) => event.status === 'handled' && event.handledBy !== null && event.handledBy !== state.clubs[clubId]?.managerId,
  ).length;
  return {
    identity: clubSecretary(state, clubId),
    outstanding,
    needsManager: outstanding.filter((event) => event.actionRequired).length,
    overdue: outstanding.filter((event) => isAdminOverdue(event, state.date)).length,
    filed,
  };
}
