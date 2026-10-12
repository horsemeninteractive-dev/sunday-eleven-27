import type { Club } from '@/domain/club';
import type { CareerState, JobOpening } from '@/domain/career';
import { emptyCareerState } from '@/domain/career';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, SeasonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import { isOfficial, type Official } from '@/domain/person';
import { defaultTactics } from '@/domain/tactics';
import { addDays, formatShortDate } from './calendar';
import { createEvent } from './news';
import { linkManagerToClub } from './generation/relationshipGenerator';
import { relationshipStore } from './relationships';
import { leagueClubIds } from './pyramid';
import { stream } from './rng';
import { ensureClubStaff } from './staff';
import { fillVacantPost, type ManagerMarketContext } from './managers';

/**
 * The manager's career, running.
 *
 * This is the layer the design always left for last: a manager could be judged
 * by his committee but never actually lose his job, and once he did there was
 * nowhere for the career to go. It turns three facts into a loop.
 *
 *  - **The committee can part ways with him.** Decided by `governance.ts` at the
 *    season boundary, on the season that was actually played; this module only
 *    carries out the decision — the tenure closes, the committee says why, and
 *    the manager is out of work.
 *  - **Out of work is a real state.** The club is no longer his, there is no
 *    match to pick a team for, and the days still pass. Every system that used
 *    to mean "the manager's club" asks {@link managingClubId}, which answers
 *    null while he is between jobs.
 *  - **There is a way back.** A handful of the vacancies his standing makes him
 *    a plausible candidate for are held open for him rather than filled the same
 *    summer, and he applies. Being appointed gives him the club — its squad, its
 *    fixtures, its money — exactly as taking one over at the start of a career
 *    does.
 *
 * Nothing here re-decides football. It moves a manager and a club's manager post
 * and leaves every other system reading the same state it always did.
 */

/**
 * The job market's knobs, in one place.
 *
 * `hold` is deliberately small: a manager between jobs is not choosing between
 * the whole county, he is waiting for one or two committees to call. The window
 * is a few weeks of pre-season — long enough to apply, short enough that a club
 * without him is not left managerless when the season starts.
 */
export const JOB_MARKET = {
  /** How many reachable vacancies the market leaves for him. */
  hold: 3,
  /** Days a post stays open before the club looks elsewhere. */
  windowDays: 21,
  /** A club this much better than his standing will not consider him yet. */
  reachAbove: 14,
  /** ...and one this much worse he would not take. */
  reachBelow: 34,
  /** The base chance an application lands, before standing and reputation move it. */
  baseChance: 0.45,
} as const;

export interface CareerContext {
  seasonId: SeasonId;
  seasonLabel: string;
  seasonStart: ISODate;
  previousSeasonId: SeasonId;
  previousSeasonLabel: string;
}

/* ------------------------------------------------------------------------ *\
 * Reading it
 * ------------------------------------------------------------------------ */

/**
 * The career store, filled in if a save predates it.
 *
 * Mutating, in the way the other stores are: it exists so a caller that is about
 * to write to the career does not have to check for its own existence first.
 * Read-only callers use {@link isEmployed} and {@link managingClubId}, which
 * tolerate a missing store.
 */
export function careerStore(state: GameState): CareerState {
  if (!state.career) state.career = emptyCareerState();
  const career = state.career;
  if (!Array.isArray(career.spells)) career.spells = [];
  if (!Array.isArray(career.openings)) career.openings = [];
  if (!Array.isArray(career.applied)) career.applied = [];
  return career;
}

/** Whether the manager is in charge of a club. True for a save that predates this. */
export function isEmployed(state: GameState): boolean {
  return !state.career || state.career.status === 'employed';
}

/**
 * The club the manager actually manages, or null while he is between jobs.
 *
 * The one question every user-gated system should ask. It reads the career when
 * it is there and falls back to `userClubId` for a save that has none, so old
 * saves behave exactly as they always did.
 */
export function managingClubId(state: GameState): ClubId | null {
  if (!state.career) return state.userClubId;
  return state.career.status === 'employed' ? state.career.clubId ?? state.userClubId : null;
}

/** The manager himself, as the world knows him. */
export function userManager(state: GameState): Official | null {
  const person = state.people[MANAGER_PERSON_ID];
  return isOfficial(person) ? person : null;
}

function displayName(person: Official): string {
  return `${person.firstName} ${person.surname}`;
}

/* ------------------------------------------------------------------------ *\
 * The season boundary: a decision, and its consequences
 * ------------------------------------------------------------------------ */

/**
 * Carry out the committee's decision to part ways.
 *
 * The decision itself belongs to `governance.ts` — this only makes it real. The
 * tenure closes in the club's own history, the post is emptied so the managers'
 * market can fill it, the committee's line is recorded, and the manager starts
 * looking for work.
 *
 * The manager is left in the world rather than deleted: he is the player, and he
 * is exactly the man the job market is about.
 */
export function dismissUserManager(state: GameState, context: CareerContext): GameEvent[] {
  const career = careerStore(state);
  const club = state.clubs[state.userClubId];
  const manager = userManager(state);
  if (!club || !manager) return [];

  const date = state.date;

  // The tenure ends. The club's own history is where a manager's time is
  // written, so that is what closes — not a second record invented here.
  const entry = club.history.managers.find((record) => record.personId === manager.id && record.to === null);
  if (entry) entry.to = date;
  club.managerId = null;
  manager.clubId = null;
  manager.role = 'manager';
  manager.roles = [];
  manager.notes = [
    ...manager.notes,
    `Left ${club.identity.shortName}.`,
    // A date a man would read, because this line is shown to him: the note is
    // printed verbatim on his own profile page, where every other date is written
    // the way the game writes them.
    `Between jobs, ${formatShortDate(date)}.`,
  ];

  // The spell in charge ends, and his career remembers why.
  const open = career.spells[career.spells.length - 1];
  if (open && open.clubId === club.id && open.to === null) {
    open.to = date;
    open.ending = 'dismissed';
  }

  career.status = 'unemployed';
  career.clubId = null;
  career.lastClubId = club.id;
  career.openings = [];
  career.applied = [];

  void context;
  return [
    createEvent(state, {
      type: 'club-news',
      importance: 3,
      clubIds: [club.id],
      personIds: [manager.id],
      data: {
        headline: `You have left ${club.identity.name}`,
        body: `After a sustained run below what the committee expected, ${club.identity.name} have decided on a change of manager. You are between jobs and looking for a club.`,
      },
    }),
  ];
}

/**
 * The club went under him.
 *
 * Not a dismissal and not a walk-out: the club the manager was in charge of
 * could not pay its way and stopped existing, which is the one way a spell in
 * charge can end without anybody deciding anything. There is no committee left
 * to tell him he has been sacked, and the career still has to move — so this
 * closes the tenure, empties the post, and leaves him exactly where a dismissal
 * leaves him: between jobs, with the record of what he did there intact and the
 * club that took the place already a vacancy a man of his standing can apply
 * for.
 *
 * Called from the season boundary, after the club has actually folded, and
 * guarded so it can only ever fire once: the post it empties is empty by then,
 * and a second call finds the manager already out of work.
 */
export function releaseManagerFromFoldedClub(
  state: GameState,
  clubId: ClubId,
  context: CareerContext,
): GameEvent[] {
  // Only a club he was actually in charge of, and only one that has gone.
  if (managingClubId(state) !== clubId) return [];
  const club = state.clubs[clubId];
  const manager = userManager(state);
  if (!club || club.active || !manager) return [];

  const career = careerStore(state);
  const date = state.date;

  // The tenure closes in the club's own history, as every tenure does: who was
  // there when it ended is a fact about the club's record.
  const entry = club.history.managers.find((record) => record.personId === manager.id && record.to === null);
  if (entry) entry.to = date;
  club.managerId = null;
  manager.clubId = null;
  manager.role = 'manager';
  manager.roles = [];
  manager.notes = [
    ...manager.notes,
    `${club.identity.shortName} folded under him.`,
    `Between jobs, ${formatShortDate(date)}.`,
  ];

  const open = career.spells[career.spells.length - 1];
  if (open && open.clubId === club.id && open.to === null) {
    open.to = date;
    // The reason is kept apart from a dismissal, and the difference is the
    // point: nobody decided this, and his record should say so.
    open.ending = 'club-folded';
  }

  career.status = 'unemployed';
  career.clubId = null;
  career.lastClubId = club.id;
  career.openings = [];
  career.applied = [];

  void context;
  return [
    createEvent(state, {
      type: 'club-news',
      importance: 3,
      clubIds: [club.id],
      personIds: [manager.id],
      data: {
        headline: `${club.identity.name} have folded — you are out of work`,
        body: `${club.identity.name} could not pay their way and have gone, and your time in charge ends with them. Nobody sacked you. You are between jobs again, and the record of what you did there stands.`,
      },
    }),
  ];
}

/**
 * Which vacancies the managers' market should leave for the unemployed player.
 *
 * Returned as a predicate so the market can call it as it walks the vacancies,
 * and so the reach is worked out once from the state rather than passed around
 * as loose numbers. Null while the manager is employed: the market fills every
 * post, exactly as it always did.
 */
export function reserveVacancyFor(state: GameState): ((club: Club) => boolean) | null {
  const career = careerStore(state);
  if (career.status !== 'unemployed') return null;
  const manager = userManager(state);
  if (!manager) return null;
  const managerReputation = manager.reputation;
  // The market holds a handful, not the whole county: a man between jobs is not
  // choosing between thirty clubs, he is waiting for one or two committees.
  let taken = 0;
  return (club: Club): boolean => {
    if (taken >= JOB_MARKET.hold) return false;
    // Never the club he has just left: a committee that has parted ways with a
    // manager does not immediately advertise for the same man.
    if (club.id === career.lastClubId) return false;
    const reachable =
      club.reputation <= managerReputation + JOB_MARKET.reachAbove &&
      club.reputation >= managerReputation - JOB_MARKET.reachBelow;
    if (reachable) taken += 1;
    return reachable;
  };
}

/**
 * The club whose committee should take a look, when the summer left him nothing.
 *
 * A way back that only exists when somebody else happens to be hiring is not a
 * way back, and a career that stalls until the next summer — or the one after —
 * is the dead end the whole feature is meant to avoid. So the caller may name
 * one club: the one nearest to him, which is the club a manager of his standing
 * would actually be talking to, and the one whose poor season makes a change
 * believable. Never the club he has just left.
 *
 * Returned as a callback for the same reason as {@link reserveVacancyFor}: the
 * market owns the change, and asks only which of the clubs it could move.
 */
export function guaranteeVacancyFor(state: GameState): ((clubs: readonly Club[]) => Club | null) | null {
  const career = careerStore(state);
  if (career.status !== 'unemployed') return null;
  const manager = userManager(state);
  if (!manager) return null;
  const reputation = manager.reputation;
  return (clubs: readonly Club[]): Club | null =>
    [...clubs]
      .filter((club) => club.id !== career.lastClubId)
      .sort(
        (a, b) =>
          Math.abs(a.reputation - reputation) - Math.abs(b.reputation - reputation) ||
          a.id.localeCompare(b.id),
      )[0] ?? null;
}

/**
 * Advertise the vacancies the market held back, with the window they are open
 * for. Called once at the boundary, after the market has run.
 */
export function openJobMarket(state: GameState, context: CareerContext, held: readonly ClubId[]): void {
  const career = careerStore(state);
  if (career.status !== 'unemployed') return;
  const closesOn = addDays(context.seasonStart, JOB_MARKET.windowDays);
  career.openings = held
    .map((clubId) => state.clubs[clubId])
    .filter((club): club is Club => !!club && !club.managerId)
    .map((club): JobOpening => ({
      clubId: club.id,
      postedOn: context.seasonStart,
      closesOn,
      note: boardNote(state, club),
    }));
  career.applied = [];
}

/* ------------------------------------------------------------------------ *\
 * Applying for a job
 * ------------------------------------------------------------------------ */

export interface JobApplicationResult {
  ok: boolean;
  accepted: boolean;
  message: string;
  events: GameEvent[];
}

/**
 * How likely this club is to take him, from standing against standing.
 *
 * The gap between what the world thinks of him and what the club is worth does
 * most of it — a man good enough for a club is an easy yes, one reaching well
 * above his level is a long shot — and his own coaching reputation nudges it, so
 * a good manager gets a second look at a club that might otherwise pass. There
 * is deliberately no hidden board percentage beyond that: it is a roll against
 * facts the manager can see.
 */
function appointmentChance(state: GameState, club: Club): number {
  const manager = userManager(state);
  if (!manager) return 0;
  const gap = manager.reputation - club.reputation;
  const coaching = manager.attributes.coaching / 20;
  const chance = JOB_MARKET.baseChance + gap / 45 + (coaching - 0.5) * 0.25;
  return Math.max(0.1, Math.min(0.85, chance));
}

/** A club's standing and division, in the words a vacancy would use. */
function boardNote(state: GameState, club: Club): string {
  const division = Object.values(state.competitions).find((competition) =>
    competition.clubIds.includes(club.id) && !competition.cup,
  );
  const where = division ? division.name : 'local football';
  return `${club.identity.name} play in ${where}. Standing ${Math.round(club.reputation)}.`;
}

/**
 * The manager applies for a post.
 *
 * One approach per club: a committee that has said no is not asked twice by the
 * same man in the same spell out of work. A yes gives him the club; a no closes
 * that post, because the club that turned him down has appointed somebody else.
 */
export function applyForJob(state: GameState, clubId: ClubId, context: CareerContext): JobApplicationResult {
  const career = careerStore(state);
  if (career.status !== 'unemployed') {
    return { ok: false, accepted: false, message: 'You are in charge of a club.', events: [] };
  }
  const opening = career.openings.find((entry) => entry.clubId === clubId);
  const club = state.clubs[clubId];
  if (!opening || !club) {
    return { ok: false, accepted: false, message: 'That post is not available.', events: [] };
  }
  if (career.applied.includes(clubId)) {
    return { ok: false, accepted: false, message: `You have already applied to ${club.identity.name}.`, events: [] };
  }
  career.applied.push(clubId);

  const rng = stream(state.seed, 'job-application', state.season.id, clubId);
  if (rng.chance(appointmentChance(state, club))) {
    const events = appointUserManager(state, club, context);
    return {
      ok: true,
      accepted: true,
      message: `${club.identity.name} have appointed you as their new manager.`,
      events,
    };
  }

  // Turned down: the post closes and the club looks elsewhere.
  career.openings = career.openings.filter((entry) => entry.clubId !== clubId);
  const events: GameEvent[] = [
    createEvent(state, {
      type: 'club-news',
      importance: 2,
      clubIds: [club.id],
      data: {
        headline: `${club.identity.name} turn you down`,
        body: `You were one of the names they considered, but ${club.identity.name} have decided to look elsewhere. The post is closed to you.`,
      },
    }),
  ];
  return { ok: true, accepted: false, message: `${club.identity.name} have gone with somebody else.`, events };
}

/**
 * Put the player in charge of a club.
 *
 * The same set of facts a career begins with: the post in the club's history,
 * the relationship with everyone at the club, his own tactics book reset to the
 * plain shape, and every system that asks "the manager's club" now pointed at
 * it. The club's own squad and finances are left exactly as they are — they are
 * what he is taking over.
 */
export function appointUserManager(state: GameState, club: Club, context: CareerContext): GameEvent[] {
  const career = careerStore(state);
  const manager = userManager(state);
  if (!manager) return [];

  manager.role = 'manager';
  manager.roles = [{ clubId: club.id, role: 'manager', since: context.seasonStart }];
  manager.clubId = club.id;
  manager.notes = [
    ...manager.notes.filter((note) => !note.startsWith('Between jobs')),
    `Took charge of ${club.identity.name}.`,
  ];
  club.managerId = manager.id;
  club.history.managers.unshift({
    personId: manager.id,
    name: displayName(manager),
    from: context.seasonStart,
    to: null,
  });
  club.tactics = defaultTactics('4-4-2');
  ensureClubStaff(club);
  linkManagerToClub(relationshipStore(state), state.seed, club, manager.id, state.people, context.seasonStart);

  state.userClubId = club.id;
  career.status = 'employed';
  career.clubId = club.id;
  career.lastClubId = null;
  career.openings = [];
  career.applied = [];
  career.spells = [...career.spells, { clubId: club.id, from: context.seasonStart, to: null, ending: null }];

  return [
    createEvent(state, {
      type: 'club-news',
      importance: 3,
      clubIds: [club.id],
      personIds: [manager.id],
      data: {
        headline: `${club.identity.name} appoint you as manager`,
        body: `You are the new manager of ${club.identity.name}. The squad, the bank balance and the history are yours now.`,
      },
    }),
  ];
}

/* ------------------------------------------------------------------------ *\
 * The days passing while he is out of work
 * ------------------------------------------------------------------------ */

/**
 * One day of the career, from the day loop.
 *
 * Two jobs, and only two: a post whose window has closed is filled — the club
 * does not stay managerless for the man who did not take it — and any other post
 * that has somehow come free is filled too, so the county never has a club
 * without a manager while the season is being played.
 *
 * While the manager is employed there is nothing to do, and this returns
 * immediately.
 */
export function runCareerDay(state: GameState, date: ISODate): GameEvent[] {
  const career = careerStore(state);
  const events: GameEvent[] = [];
  if (career.status === 'unemployed') {
    const expired = career.openings.filter((opening) => opening.closesOn < date);
    if (expired.length > 0) {
      career.openings = career.openings.filter((opening) => opening.closesOn >= date);
      for (const opening of expired) events.push(...fillVacantClub(state, opening.clubId));
    }
  }

  for (const clubId of leagueClubIds(state)) {
    const club = state.clubs[clubId];
    if (!club || club.managerId) continue;
    if (career.openings.some((opening) => opening.clubId === clubId)) continue;
    events.push(...fillVacantClub(state, clubId));
  }
  return events;
}

/**
 * Somebody takes the post — from the pool, from within the club, or by a man
 * playing for it. The market's own logic, called on a single club so a vacancy
 * can be filled the day it stops waiting rather than only at a season boundary.
 */
function fillVacantClub(state: GameState, clubId: ClubId): GameEvent[] {
  const club = state.clubs[clubId];
  if (!club || club.managerId) return [];
  const context: ManagerMarketContext = {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    seasonStart: state.date,
    previousSeasonId: state.season.id,
    previousSeasonLabel: state.season.label,
    // The player's own manager is the player's to place. The AI never appoints
    // him, however long he is out of work.
    protectedManagerIds: [MANAGER_PERSON_ID],
  };
  const change = fillVacantPost(state, club, context);
  if (!change) return [];
  const manager = state.people[change.personId];
  const name = manager ? displayName(manager as Official) : change.name;
  return [
    createEvent(state, {
      type: 'club-news',
      importance: 1,
      clubIds: [club.id],
      personIds: [change.personId],
      data: {
        headline: `${club.identity.shortName} appoint a manager`,
        body: `${club.identity.name} have appointed ${name} to take charge.`,
      },
    }),
  ];
}
