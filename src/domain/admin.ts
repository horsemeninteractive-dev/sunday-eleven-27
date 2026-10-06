import type { ClubId, CompetitionId, ISODate, MatchId, PersonId } from './ids';

/**
 * Club administration.
 *
 * A Sunday club is buried in paperwork nobody sees: registrations, league
 * correspondence, cup entry forms, AGMs, deadline reminders, a suspension the
 * county FA has confirmed. None of it is football, and all of it is the
 * secretary's job.
 *
 * This is deliberately *not* a second calendar and *not* a second competition
 * system. A fixture change stays in `state.matches`; an AGM stays on the
 * calendar. What lives here is the secretary's own desk: the letters and
 * deadlines he has received, which of them the manager actually has to do
 * something about, and whether they were dealt with in time. It is an inbox,
 * not a rulebook.
 *
 * The distinction that keeps it honest is `actionRequired`: most of what crosses
 * a secretary's desk he simply files, and the manager should never hear about it.
 * The few things he cannot decide alone surface here and are the whole point of
 * the role.
 */

/** Where a piece of administration came from. */
export type AdminSource =
  /** The league the club plays in. */
  | 'league'
  /** The county or national association. */
  | 'fa'
  /** The club's own business — its AGM, its committee. */
  | 'club'
  /** A competition the club is entered in. */
  | 'competition';

/** What kind of administration it is. */
export type AdminCategory =
  /** A fixture confirmed, moved or called off. */
  | 'fixture-admin'
  /** League or FA correspondence that is not a hard deadline. */
  | 'correspondence'
  /** Something due by a date. */
  | 'deadline'
  /** A club or league annual general meeting. */
  | 'agm'
  /** Player registration and eligibility. */
  | 'registration'
  /** A suspension, a caution, a disciplinary panel. */
  | 'disciplinary'
  /** Entry forms and returns. */
  | 'paperwork'
  /** Anything else, filed under "notice". */
  | 'notice';

/**
 * How much of the manager's attention this deserves.
 *
 * 1 — routine; the secretary files it unless he is not up to the job.
 * 2 — worth reading; it will be surfaced but will not stop the clock.
 * 3 — pressing; a deadline or a meeting that cannot be missed.
 */
export type AdminImportance = 1 | 2 | 3;

/** Where an item has got to. */
export type AdminStatus =
  /** Received, and nothing has closed it yet. */
  | 'open'
  /** Dealt with — by the manager, or filed by the secretary. */
  | 'handled'
  /** Its deadline passed while it was still open. */
  | 'missed';

export interface AdminEvent {
  id: string;
  /**
   * A stable key for the underlying fact, so the same letter is only ever
   * received once. A fixture that moves twice is one piece of correspondence
   * updated, not two letters.
   */
  key: string;
  /** The day the secretary logged it. */
  receivedOn: ISODate;
  /** The day the thing itself happens, or the day the notice is dated. */
  date: ISODate;
  /** The day the manager has to have done something by, or null. */
  deadline: ISODate | null;
  source: AdminSource;
  category: AdminCategory;
  importance: AdminImportance;
  /** True when this cannot be left to the secretary. */
  actionRequired: boolean;
  title: string;
  detail: string;
  status: AdminStatus;
  /** When and by whom it was closed, for the record. */
  handledOn: ISODate | null;
  handledBy: PersonId | null;
  /** AGMs: whether the manager is expected there in person. */
  attendanceRequired: boolean;
  /** AGMs and meetings: what is on the agenda. */
  agenda: string[];
  clubIds: ClubId[];
  personIds: PersonId[];
  competitionId: CompetitionId | null;
  matchId: MatchId | null;
}

/**
 * The secretary's desk.
 *
 * Held on the game state so a save carries the club's paperwork with it. It is
 * one array, capped, and nothing in it is authoritative for anything outside
 * itself: closing an item here closes a letter, not a fixture and not a rule.
 */
export interface AdminState {
  events: AdminEvent[];
}

export function emptyAdminState(): AdminState {
  return { events: [] };
}

/** Open, and so still on the desk. */
export function isAdminOutstanding(event: AdminEvent): boolean {
  return event.status === 'open';
}

/** Open, required of the manager, and past its deadline. */
export function isAdminOverdue(event: AdminEvent, date: ISODate): boolean {
  return event.status === 'open' && event.deadline !== null && event.deadline < date;
}
