import {
  emptyFacilitiesState,
  GROUND_UPKEEP,
  GROUND_WORK_CANCELLATION_REFUND,
  GROUND_WORK_ORDER,
  GROUND_WORK_STEP,
  GROUND_WORKS,
  RECURRING_UPKEEP_ID,
  workWouldChange,
  type FacilitiesState,
  type GroundWork,
  type GroundWorkLevel,
  type GroundWorkProject,
} from '@/domain/facilities';
import type { GameState } from '@/domain/game';
import type { ClubId, GroundId, ISODate } from '@/domain/ids';
import { isCompetitiveMatch, type Match, type MatchConditions, type MatchSurface } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import type { Ground } from '@/domain/world';
import { addDays, daysBetween, monthOf } from './calendar';
import { managingClubId } from './career';
import { addLedgerEntry } from './finance';
import { recentHomeCrowd } from './fundraising';
import { nextId } from './ids';
import { expectedAttendanceFor, rollMatchConditions } from './matchday';
import { createEvent } from './news';
import { stream } from './rng';
import { recurringEvents, recursOn } from './schedule';

/**
 * The club's ground, and what it can do about it.
 *
 * The rest of the game already reads a ground on its own terms — the pitch
 * inspection rolls its drainage and quality into the day's surface, the engine
 * reads that surface back as a passing penalty, the training screen looks for
 * floodlights in December, the bar is what a gate is worth, and the league reads
 * the standard of the pitch before it lets a club up. Nothing here invents a
 * second version of any of that. A job is commissioned, the money goes on the
 * ledger through `addLedgerEntry`, the work is carried out by the day loop on
 * the date it was promised for, and what it changes is *the ground itself* —
 * the same fields every one of those systems was already reading.
 *
 * So the whole of this file is four things:
 *
 *  1. **What is on offer** (`groundSummary`) — the jobs the club could start,
 *     what each one costs and what it would leave the ground reading, whether it
 *     can afford it, and, when it cannot be done, why not, in words. Both the
 *     screen and the action read this one function, so what the manager is
 *     offered and what he is allowed to do cannot drift apart.
 *  2. **Starting one** (`commissionGroundWork`) — the club's money leaves the
 *     account once, dated today, and a project is opened for a date in the
 *     future. Nothing else about the ground changes yet.
 *  3. **Carrying it out** (`runGroundDay`) — the day loop hands over any job
 *     that has come due, exactly once, and collects the weekly upkeep from the
 *     clubs that pay it.
 *  4. **The winter** (`wearGroundsFor`) — a pitch that nobody looks after is
 *     ground down by the Sundays played on it, back to the surface it was born
 *     with and no further. This is what the upkeep is *for*, and it is the one
 *     number in the system that a manager has to stay on top of.
 *
 * Only the manager's own club ever commissions anything or pays upkeep, on the
 * same principle the fundraising system already works to: the county's other
 * committees are not asked to imagine their own ground improvements.
 */

/* ------------------------------------------------------------------------ *\
 * Reading the ground
 * ------------------------------------------------------------------------ */

/** The ground store, filled in if a save predates it. */
export function facilitiesStore(state: GameState): FacilitiesState {
  if (!state.facilities) state.facilities = emptyFacilitiesState();
  const store = state.facilities;
  if (!Array.isArray(store.projects)) store.projects = [];
  if (!store.upkeep || typeof store.upkeep !== 'object') store.upkeep = {} as Record<ClubId, boolean>;
  if (!store.upkeepPaidOn || typeof store.upkeepPaidOn !== 'object') {
    store.upkeepPaidOn = {} as Record<ClubId, ISODate>;
  }
  return store;
}

/** The pitch a club plays its home games on. */
export function homeGroundFor(state: GameState, clubId: ClubId): Ground | undefined {
  const club = state.clubs[clubId];
  return club ? state.world.grounds[club.groundId] : undefined;
}

/** Whether the club holds the ground rather than hiring it from somebody else. */
export function holdsTheGround(state: GameState, clubId: ClubId): boolean {
  const ground = homeGroundFor(state, clubId);
  return Boolean(ground && ground.tenantClubId === clubId);
}

/** The club that holds the ground, when it is not this one. */
export function groundHolderName(state: GameState, ground: Ground): string | null {
  if (!ground.tenantClubId) return null;
  return state.clubs[ground.tenantClubId]?.identity.name ?? 'another club';
}

/**
 * The surface the ground was born with, which is as low as the winter can take it.
 *
 * A ground nobody has touched has no recorded baseline, so it is its own
 * current reading — the first time anything would move, that value is written
 * down and becomes the floor for the rest of the career.
 */
export function groundBaselineQuality(ground: Ground): number {
  return ground.baseQuality ?? ground.quality;
}

/** Is the club paying the weekly upkeep? */
export function upkeepPlanFor(state: GameState, clubId: ClubId): boolean {
  return facilitiesStore(state).upkeep[clubId] === true;
}

/** The weekly upkeep the club has committed to, as one number out of the account. */
export function upkeepCostFor(state: GameState, clubId: ClubId): number {
  return upkeepPlanFor(state, clubId) ? GROUND_UPKEEP.perWeek : 0;
}

/** Every job commissioned on the ground, newest first. */
export function groundProjects(state: GameState, clubId: ClubId): GroundWorkProject[] {
  return facilitiesStore(state)
    .projects.filter((project) => project.clubId === clubId)
    .sort((a, b) => (a.startedOn < b.startedOn ? 1 : a.startedOn > b.startedOn ? -1 : 0));
}

/** Jobs paid for and not yet finished or cancelled: the contractor is on the site. */
export function groundWorkInHand(state: GameState, clubId: ClubId): GroundWorkProject[] {
  return groundProjects(state, clubId)
    .filter((project) => project.completedOn === null && project.cancelledOn === null)
    .sort((a, b) => (a.completesOn < b.completesOn ? -1 : 1));
}

/** Jobs finished, newest first. The record of what the club has built. */
export function groundWorkHistory(state: GameState, clubId: ClubId): GroundWorkProject[] {
  return groundProjects(state, clubId).filter((project) => project.completedOn !== null);
}

/**
 * How far the club has taken a job.
 *
 * Counted from the jobs it has *finished*, plus the ground's own state for the
 * two that are a yes-or-no: a club that inherited lights off the world has the
 * lights, whether or not it paid for them, and offering it four heads on masts
 * it already has would be selling nothing.
 */
export function groundWorkLevel(state: GameState, clubId: ClubId, work: GroundWork): number {
  const ground = homeGroundFor(state, clubId);
  const fromGround =
    work === 'floodlights' ? (ground?.hasFloodlights ? 1 : 0) : work === 'clubhouse' ? (ground?.hasClubhouse ? 1 : 0) : 0;
  const fromProjects = groundWorkHistory(state, clubId)
    .filter((project) => project.work === work)
    .reduce((highest, project) => Math.max(highest, project.level), 0);
  return Math.max(fromGround, fromProjects);
}

/** The next stage of a job, or null when there is nothing left to do. */
export function nextGroundWorkLevel(state: GameState, clubId: ClubId, work: GroundWork): GroundWorkLevel | null {
  const profile = GROUND_WORKS[work];
  const level = groundWorkLevel(state, clubId, work);
  return profile.levels[level] ?? null;
}

/* ------------------------------------------------------------------------ *\
 * The grass an afternoon is played on
 * ------------------------------------------------------------------------ */

/**
 * How far into its next point of wear a ground is, 0..1.
 *
 * Nought while the club is paying for the pitch to be looked after — that is the
 * whole of what the £9 a week buys, and a picture on a match screen is the one
 * place a manager can *see* it — and otherwise the football played since the last
 * point came off the surface, as a fraction of the fixtures a point costs. A
 * ground nobody has played on reads nought either way, which is right: no wear is
 * no wear, whether or not anybody is mowing it.
 */
export function groundScuffFor(state: GameState, groundId: GroundId): number {
  if (groundIsKeptUp(state, groundId)) return 0;
  const ground = state.world.grounds[groundId];
  return Math.min(1, (ground?.fixturesSinceAttention ?? 0) / GROUND_UPKEEP.fixturesPerWear);
}

/**
 * The surface a fixture is being played on, as the ground reads itself.
 *
 * Read off the match's own ground rather than off the home club, because a cup
 * tie on a neutral ground is played on somebody else's pitch. The day's verdict
 * is taken from the fixture's own conditions — rolled from this ground when the
 * matchday was prepared — so a club that re-lays its pitch in February plays on
 * the better surface from its next home game, and the picture of it changes with
 * it. A match with no ground behind it (a fixture built by a test, or a save old
 * enough to have lost one) falls back to grass at the quality the day reads.
 */
export function matchSurfaceFor(state: GameState, match: Match): MatchSurface {
  const ground = state.world.grounds[match.groundId];
  return {
    surface: ground?.surface ?? 'grass',
    condition: match.conditions.pitch,
    quality: ground?.quality ?? match.conditions.pitchQuality,
    scuff: ground ? groundScuffFor(state, ground.id) : 0,
  };
}

/* ------------------------------------------------------------------------ *\
 * What it would change, measured on this club's own fixtures
 * ------------------------------------------------------------------------ */

/**
 * How the remaining Sundays at a ground come out, on the game's own weather.
 *
 * Three buckets rather than a score, because the two jobs move different ones
 * and a manager is entitled to see which: water is what the drains answer for,
 * the muddy in-between is what better drains turn a lost Sunday *into*, and a
 * bald, worn surface is the one the grass answers for.
 */
export interface PitchOutlook {
  /** How many of the dates were rolled. All of them: this is a forecast, not a sample. */
  dates: number;
  /** Sundays the league would call off for standing water. */
  waterlogged: number;
  /** Sundays that would play, but heavy — ankle-deep in the goalmouths. */
  muddy: number;
  /** Sundays the surface itself would be bald and worn on. */
  worn: number;
}

/**
 * Roll the remaining fixtures at this ground and count what the surface does.
 *
 * Deliberately the game's own weather rather than a statistic about drainage:
 * the same stream the day itself is rolled from (`dayWeather`), with the
 * drainage that is actually on the ground, and then again with the drainage the
 * work would leave behind. The weather draws are identical between the two
 * readings — only the pitch they fall on is different — so the difference the
 * manager is shown is the difference the work makes and nothing else.
 */
export function pitchOutlook(state: GameState, ground: Ground, dates: ISODate[], patch: Partial<Ground> = {}): PitchOutlook {
  const outlook: PitchOutlook = { dates: dates.length, waterlogged: 0, muddy: 0, worn: 0 };
  const reading = { ...ground, ...patch };
  for (const date of dates) {
    const conditions = rollMatchConditions(stream(state.seed, 'day-weather', ground.id, date), reading, date);
    if (conditions.pitch === 'waterlogged') outlook.waterlogged += 1;
    else if (conditions.pitch === 'muddy') outlook.muddy += 1;
    else if (conditions.pitch === 'worn') outlook.worn += 1;
  }
  return outlook;
}

/** The competitive home fixtures this club still has at its ground, soonest first. */
export function remainingHomeFixtures(state: GameState, clubId: ClubId, limit = 12): Array<{ id: string; date: ISODate; groundId: GroundId }> {
  return Object.values(state.matches)
    .filter(
      (match) =>
        !match.played &&
        match.status === 'scheduled' &&
        match.homeClubId === clubId &&
        daysBetween(state.date, match.date) >= 0 &&
        isCompetitiveMatch(state, match),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, limit)
    .map((match) => ({ id: match.id, date: match.date, groundId: match.groundId }));
}

/* ------------------------------------------------------------------------ *\
 * What is on offer
 * ------------------------------------------------------------------------ */

export interface GroundWorkOption {
  work: GroundWork;
  label: string;
  blurb: string;
  effect: string;
  /** The stage this job would deliver, and how many stages there are. */
  level: number;
  maxLevel: number;
  cost: number;
  days: number;
  /** The day it would be finished if it were started today. */
  completesOn: ISODate;
  /** What the ground reads now, and what it would read. */
  change: string;
  /** What the change is worth, measured where it can be measured. */
  forecast: string[] | null;
  /** True when the club can commission it today. */
  available: boolean;
  /** True when the club's balance covers it. */
  affordable: boolean;
  /**
   * What is in the way, as a state rather than a sentence.
   *
   * The screen decides how to draw each of these — a job already in hand and a
   * job the club cannot afford are both unavailable and are not the same thing
   * — and matching on the wording of a sentence to tell them apart is how a
   * screen ends up broken by an edit to a string.
   */
  blocked: 'administration' | 'tenancy' | 'in-hand' | 'complete' | 'no-change' | 'money' | null;
  /** Why not, in the manager's words. Null when there is nothing in the way. */
  reason: string | null;
}

export interface GroundSummary {
  ground: Ground;
  groundName: string;
  townName: string | null;
  surface: Ground['surface'];
  capacity: number;
  /** True when the club holds the ground; false when it hires somebody else's. */
  holdsTheGround: boolean;
  /** The club that holds it, when that is not the manager's club. */
  holderName: string | null;
  quality: number;
  /** The surface the ground was born with: as low as the winter can take it. */
  baselineQuality: number;
  drainage: number;
  hasFloodlights: boolean;
  hasChangingRooms: boolean;
  hasClubhouse: boolean;
  /** Today's weather and the surface it leaves, for the badge and the sentence. */
  conditions: MatchConditions;
  balance: number;
  inAdministration: boolean;
  options: GroundWorkOption[];
  inHand: GroundWorkProject[];
  history: GroundWorkProject[];
  upkeep: {
    on: boolean;
    perWeek: number;
    detail: string;
    /** The next date it is charged. */
    nextDue: ISODate | null;
  };
}

/** One job, priced and judged, or null when the club has no ground to work on. */
export function groundWorkOption(state: GameState, clubId: ClubId, work: GroundWork): GroundWorkOption | null {
  const club = state.clubs[clubId];
  const ground = homeGroundFor(state, clubId);
  if (!club || !ground) return null;

  const profile = GROUND_WORKS[work];
  const level = groundWorkLevel(state, clubId, work);
  const next = nextGroundWorkLevel(state, clubId, work);
  const inHand = groundWorkInHand(state, clubId);
  const cost = next?.cost ?? 0;
  const days = next?.days ?? 0;
  const affordable = club.finances.balance >= cost;

  // The first thing that is genuinely in the way, in the order a committee
  // would raise it. The screen shows this sentence rather than a dead button.
  let blocked: GroundWorkOption['blocked'] = null;
  let reason: string | null = null;
  if ((club.finances.administrationSeasons ?? 0) > 0) {
    blocked = 'administration';
    reason = 'The club is in administration — nothing is spent on the ground until the books are straight.';
  } else if (profile.needsTheLease && ground.tenantClubId !== clubId) {
    blocked = 'tenancy';
    const holder = groundHolderName(state, ground);
    reason = holder
      ? `The ground is ${holder}'s, not the club's. Work on the pitch is theirs to commission.`
      : 'The club does not hold this ground, so the work is the landlord’s to do.';
  } else if (!next || !workWouldChange(work, ground)) {
    blocked = 'complete';
    reason = 'There is nothing left to do here.';
  } else if (inHand.length > 0) {
    blocked = 'in-hand';
    reason = `There is already work in hand — the ${GROUND_WORKS[inHand[0]!.work].label.toLowerCase()}, due ${inHand[0]!.completesOn}.`;
  } else if (!affordable) {
    blocked = 'money';
    reason = `The work is £${cost.toLocaleString('en-GB')} and the club has £${Math.round(club.finances.balance).toLocaleString('en-GB')}.`;
  }

  const completesOn = addDays(state.date, days);
  return {
    work,
    label: profile.label,
    blurb: profile.blurb,
    effect: profile.effect,
    level: level + 1,
    maxLevel: profile.levels.length,
    cost,
    days,
    completesOn,
    change: groundWorkChange(work, ground, next),
    forecast: groundWorkForecast(state, clubId, ground, work),
    available: reason === null,
    affordable,
    blocked,
    reason,
  };
}

/** The ground's own numbers before and after a stage of the job. */
function groundWorkChange(work: GroundWork, ground: Ground, next: GroundWorkLevel | null): string {
  switch (work) {
    case 'drainage': {
      const after = Math.min(20, ground.drainage + (next ? GROUND_WORK_STEP.drainage : 0));
      return `Drainage ${ground.drainage} → ${after} of 20`;
    }
    case 'surface': {
      const after = Math.min(20, ground.quality + (next ? GROUND_WORK_STEP.surface : 0));
      return `Pitch ${ground.quality} → ${after} of 20`;
    }
    case 'floodlights':
      return `Floodlights ${ground.hasFloodlights ? 'yes' : 'no'} → yes`;
    case 'clubhouse':
      return `Clubhouse ${ground.hasClubhouse ? 'yes' : 'no'} → yes`;
  }
}

/**
 * What the job is worth here, in the club's own numbers.
 *
 * A drainage job is measured by rolling the Sundays the club has left and
 * counting how many of them the league would lose to water with the drains as
 * they are and with the drains as they would be. A surface job is measured the
 * same way, by how many of those afternoons would play soft. The two buildings
 * are measured in money and in minutes, because that is what they are worth.
 */
function groundWorkForecast(state: GameState, clubId: ClubId, ground: Ground, work: GroundWork): string[] | null {
  const club = state.clubs[clubId];
  if (!club) return null;
  const dates = remainingHomeFixtures(state, clubId).map((fixture) => fixture.date);
  const lines: string[] = [];

  if (work === 'drainage') {
    if (dates.length === 0) return ['No home fixtures left this season to measure it against.'];
    const before = pitchOutlook(state, ground, dates);
    const after = pitchOutlook(state, ground, dates, { drainage: Math.min(20, ground.drainage + GROUND_WORK_STEP.drainage) });
    lines.push(
      `Of the ${before.dates} Sundays left at this ground, ${before.waterlogged} would be lost to standing water as it is and ${after.waterlogged} with the drains in.`,
    );
    lines.push(
      `The heavy, ankle-deep afternoons those Sundays turn into: ${before.muddy} now, ${after.muddy} after the work — played, but still not a pitch to pass on.`,
    );
    return lines;
  }

  if (work === 'surface') {
    if (dates.length === 0) return ['No home fixtures left this season to measure it against.'];
    const before = pitchOutlook(state, ground, dates);
    const after = pitchOutlook(state, ground, dates, { quality: Math.min(20, ground.quality + GROUND_WORK_STEP.surface) });
    lines.push(
      `Of the ${before.dates} Sundays left at this ground, ${before.worn} would come out a bare, worn surface and ${after.worn} after the work.`,
    );
    const standard = ground.quality < 9 && Math.min(20, ground.quality + GROUND_WORK_STEP.surface) >= 9;
    if (standard) lines.push('It also takes the pitch past the standard the league wants for the division above.');
    return lines;
  }

  if (work === 'floodlights') {
    const next = state.season.calendar.find((entry) => daysBetween(state.date, entry.date) >= 0)?.date ?? state.date;
    const winter = monthOf(next) >= 10 || monthOf(next) <= 2;
    lines.push(
      winter
        ? 'Thursday nights are in the dark months now: a session without lights loses its last twenty minutes.'
        : 'From October to February a session without lights loses its last twenty minutes.',
    );
    lines.push('And a frozen morning is one of the ways a Sunday is called off without them.');
    return lines;
  }

  // The clubhouse: what the bar is worth on the crowd the club actually draws.
  const crowd = recentHomeCrowd(state, clubId) ?? nextHomeCrowd(state, clubId);
  if (crowd === null) {
    return ['The bar takes proper money on a home Sunday, and a few more come through the gate.'];
  }
  const perSunday = Math.round(crowd * (1.1 - 0.4));
  const fixtures = remainingHomeFixtures(state, clubId).length;
  lines.push(`About £${perSunday} more behind the bar on a home Sunday at the crowd you have been drawing.`);
  if (fixtures > 0) lines.push(`Roughly £${perSunday * fixtures} over the ${fixtures} Sundays left at home.`);
  return lines;
}

/** What the next home fixture might draw, for a club that has not played one yet. */
function nextHomeCrowd(state: GameState, clubId: ClubId): number | null {
  const next = Object.values(state.matches)
    .filter(
      (match) => !match.played && match.status === 'scheduled' && match.homeClubId === clubId && daysBetween(state.date, match.date) >= 0,
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (!next) return null;
  const expected = expectedAttendanceFor(state, next);
  return expected > 0 ? expected : null;
}

/** Everything the ground screen needs, worked out once. */
export function groundSummary(state: GameState, clubId: ClubId = state.userClubId): GroundSummary | null {
  const club = state.clubs[clubId];
  const ground = homeGroundFor(state, clubId);
  if (!club || !ground) return null;

  const conditions = rollMatchConditions(stream(state.seed, 'day-weather', ground.id, state.date), ground, state.date);
  const upkeepRule = recurringEvents(state).find((rule) => rule.id === RECURRING_UPKEEP_ID) ?? null;
  const nextDue = upkeepRule ? nextDateFor(state, upkeepRule.weekday ?? 5) : null;

  return {
    ground,
    groundName: ground.name,
    townName: state.world.towns[ground.townId]?.name ?? null,
    surface: ground.surface,
    capacity: ground.capacity,
    holdsTheGround: ground.tenantClubId === clubId,
    holderName: groundHolderName(state, ground),
    quality: ground.quality,
    baselineQuality: groundBaselineQuality(ground),
    drainage: ground.drainage,
    hasFloodlights: ground.hasFloodlights,
    hasChangingRooms: ground.hasChangingRooms,
    hasClubhouse: ground.hasClubhouse,
    conditions,
    balance: club.finances.balance,
    inAdministration: (club.finances.administrationSeasons ?? 0) > 0,
    options: GROUND_WORK_ORDER.map((work) => groundWorkOption(state, clubId, work)).filter(
      (option): option is GroundWorkOption => option !== null,
    ),
    inHand: groundWorkInHand(state, clubId),
    history: groundWorkHistory(state, clubId).slice(0, 6),
    upkeep: {
      on: upkeepPlanFor(state, clubId),
      perWeek: GROUND_UPKEEP.perWeek,
      detail: GROUND_UPKEEP.detail,
      nextDue,
    },
  };
}

/** The next date this weekday falls on, today included. */
function nextDateFor(state: GameState, weekday: number): ISODate {
  let date = state.date;
  for (let day = 0; day < 7; day += 1) {
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date;
    date = addDays(date, 1);
  }
  return state.date;
}

/* ------------------------------------------------------------------------ *\
 * Starting a job
 * ------------------------------------------------------------------------ */

export interface GroundWorkResult {
  ok: boolean;
  message: string;
  project?: GroundWorkProject;
}

/**
 * Commission a job on the club's ground.
 *
 * The money leaves the account now and the work arrives later, which is the
 * whole shape of the decision: a club that spends its last £480 on a re-lay in
 * October has to get through November on nothing. A job already in hand blocks
 * a second one — one contractor on the site at a time, and no club paying for
 * two jobs at once — and the refusal says which job it is waiting on.
 *
 * Everything is decided by `groundWorkOption`, so this cannot do something the
 * screen gave no sign of: if the option is not available, the reason is the
 * refusal.
 */
export function commissionGroundWork(state: GameState, clubId: ClubId, work: GroundWork, when?: ISODate): GroundWorkResult {
  const club = state.clubs[clubId];
  const ground = homeGroundFor(state, clubId);
  if (!club || !ground) return { ok: false, message: 'There is no ground for the club to work on.' };
  if (managingClubId(state) !== clubId) return { ok: false, message: 'That is not your club’s ground to spend money on.' };

  const option = groundWorkOption(state, clubId, work);
  if (!option) return { ok: false, message: 'There is no ground for the club to work on.' };
  if (!option.available) return { ok: false, message: option.reason ?? 'That work cannot be done just now.' };

  const startedOn = when && when >= state.date ? when : state.date;
  const project: GroundWorkProject = {
    id: nextId(state, 'groundwork'),
    clubId,
    groundId: ground.id,
    work,
    level: option.level,
    cost: option.cost,
    startedOn,
    completesOn: addDays(startedOn, option.days),
    completedOn: null,
    cancelledOn: null,
  };

  // The one ledger line, dated the day the club committed to it, under its own
  // category so the treasurer's book can answer "what has the ground cost us?".
  addLedgerEntry(state, clubId, {
    date: startedOn,
    description: `${option.label} — stage ${option.level} of ${option.maxLevel}`,
    category: 'ground',
    amount: -option.cost,
  });

  facilitiesStore(state).projects.unshift(project);
  return {
    ok: true,
    message: `${option.label} commissioned — finished around ${project.completesOn}.`,
    project,
  };
}

/**
 * Pull out of a job already paid for.
 *
 * The club gets back what a contractor would give back — half, and no more — and
 * the work simply never happens: the ground is not touched, so a cancelled job
 * cannot leave the club with half a drainage scheme. A job that has already been
 * handed over is not cancellable at all, because the money bought a pitch that
 * has already been played on.
 */
export function cancelGroundWork(state: GameState, clubId: ClubId, projectId: string): GroundWorkResult {
  const store = facilitiesStore(state);
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) return { ok: false, message: 'That work is not on the books.' };
  if (project.clubId !== clubId || managingClubId(state) !== clubId) {
    return { ok: false, message: 'That is not your club’s work to cancel.' };
  }
  if (project.completedOn !== null) return { ok: false, message: 'That work is already done.' };
  if (project.cancelledOn !== null) return { ok: false, message: 'That work has already been cancelled.' };

  const label = GROUND_WORKS[project.work].label;
  const refund = Math.round(project.cost * GROUND_WORK_CANCELLATION_REFUND * 100) / 100;
  project.cancelledOn = state.date;
  addLedgerEntry(state, clubId, {
    date: state.date,
    description: `${label} cancelled — deposit returned`,
    category: 'ground',
    amount: refund,
  });
  return {
    ok: true,
    message: `${label} cancelled. £${Math.round(refund).toLocaleString('en-GB')} of the £${Math.round(project.cost).toLocaleString('en-GB')} came back.`,
    project,
  };
}

/**
 * Take the club's ground upkeep on, or stop paying for it.
 *
 * A commitment rather than an upgrade: while it is paid, a winter of Sundays
 * does not take the surface back; while it is not, it does. Turning it off is
 * allowed at any time and takes effect from the next Friday it would have been
 * charged on, because a club that cannot afford £9 a week has to be able to stop.
 */
export function setUpGroundUpkeep(state: GameState, clubId: ClubId, on: boolean): GroundWorkResult {
  const club = state.clubs[clubId];
  const ground = homeGroundFor(state, clubId);
  if (!club || !ground) return { ok: false, message: 'The club has no ground to look after.' };
  if (managingClubId(state) !== clubId) return { ok: false, message: 'That is not your club’s ground to look after.' };

  const store = facilitiesStore(state);
  if (store.upkeep[clubId] === on) {
    return { ok: true, message: on ? 'The ground is already being looked after.' : 'The club is not paying for the ground.' };
  }
  store.upkeep[clubId] = on;
  return {
    ok: true,
    message: on
      ? `${GROUND_UPKEEP.label} on — £${GROUND_UPKEEP.perWeek} a week, charged on a Friday.`
      : `${GROUND_UPKEEP.label} off. Nobody is looking after the pitch now.`,
  };
}

/* ------------------------------------------------------------------------ *\
 * The day it happens
 * ------------------------------------------------------------------------ */

/**
 * The ground's own business on a date: hand over work that has come due, collect
 * the week's upkeep, and count the football played on the pitch.
 *
 * Called from the day loop, in the same pass as the rest of the bookkeeping, so
 * a job finishes on the morning it was promised for and the charge lands on the
 * Friday it belongs to. Every part of it is a no-op on a date with nothing on,
 * which is most of them.
 */
export function runGroundDay(state: GameState, date: ISODate): GameEvent[] {
  const events = carryOutGroundWork(state, date);
  chargeGroundUpkeep(state, date);
  wearGroundsFor(state, date);
  return events;
}

/** Hand over any job that has come due, and only ever once. */
function carryOutGroundWork(state: GameState, date: ISODate): GameEvent[] {
  const events: GameEvent[] = [];
  for (const project of facilitiesStore(state).projects) {
    if (project.completedOn !== null || project.cancelledOn !== null) continue;
    if (daysBetween(date, project.completesOn) > 0) continue;
    const club = state.clubs[project.clubId];
    const ground = state.world.grounds[project.groundId];
    // A club that has gone, or a ground that has, is not a job anybody can do.
    // It is closed out rather than left open for ever.
    if (!club || !club.active || !ground) {
      project.cancelledOn = date;
      continue;
    }

    const profile = GROUND_WORKS[project.work];
    const before = describeGround(project.work, ground);
    applyGroundWork(project.work, ground);
    project.completedOn = date;
    const after = describeGround(project.work, ground);

    if (project.clubId === managingClubId(state)) {
      events.push(
        createEvent(state, {
          type: 'club-news',
          importance: 2,
          clubIds: [project.clubId],
          personIds: club.managerId ? [club.managerId] : [],
          data: {
            headline: `${profile.label} finished at ${ground.name}`,
            body: `The work the club commissioned is done: ${before} is now ${after}. ${profile.effect}`,
          },
        }),
      );
    }
  }
  return events;
}

function applyGroundWork(work: GroundWork, ground: Ground): void {
  switch (work) {
    case 'drainage':
      ground.drainage = Math.min(20, ground.drainage + GROUND_WORK_STEP.drainage);
      return;
    case 'surface':
      // The surface the club is re-laying over is the surface it keeps if it
      // never looks after the new one: the baseline is whatever it had before
      // the first job, and is written the first time there is one.
      if (ground.baseQuality === undefined) ground.baseQuality = ground.quality;
      ground.quality = Math.min(20, ground.quality + GROUND_WORK_STEP.surface);
      return;
    case 'floodlights':
      ground.hasFloodlights = true;
      return;
    case 'clubhouse':
      ground.hasClubhouse = true;
      return;
  }
}

/** The ground's own reading of the fact a job changes, for the news line. */
function describeGround(work: GroundWork, ground: Ground): string {
  switch (work) {
    case 'drainage':
      return `drainage ${ground.drainage} of 20`;
    case 'surface':
      return `a pitch reading ${ground.quality} of 20`;
    case 'floodlights':
      return ground.hasFloodlights ? 'floodlights' : 'no floodlights';
    case 'clubhouse':
      return ground.hasClubhouse ? 'a clubhouse that opens' : 'no clubhouse';
  }
}

/**
 * The week's upkeep, on the calendar's own date.
 *
 * Charged from the club's own commitment and dated by the Friday the rule falls
 * on, so the treasurer's forward look (`obligations.ts`) and the ledger agree
 * about the same £9. `upkeepPaidOn` is what makes a date that gets processed
 * twice — a save resumed on a Friday, a day re-run by a tool — a week paid once.
 */
function chargeGroundUpkeep(state: GameState, date: ISODate): void {
  const store = facilitiesStore(state);
  const rule = recurringEvents(state).find((candidate) => candidate.id === RECURRING_UPKEEP_ID);
  if (!rule || !recursOn(rule, date)) return;

  for (const [clubId, on] of Object.entries(store.upkeep)) {
    if (!on) continue;
    const club = state.clubs[clubId as ClubId];
    if (!club || !club.active) continue;
    if (store.upkeepPaidOn[clubId as ClubId] === date) continue;
    store.upkeepPaidOn[clubId as ClubId] = date;
    addLedgerEntry(state, clubId as ClubId, {
      date,
      description: `${GROUND_UPKEEP.label} (weekly)`,
      category: 'ground',
      amount: -GROUND_UPKEEP.perWeek,
    });
  }
}

/**
 * What a winter of football does to a pitch nobody is looking after.
 *
 * The surface is a physical thing used by whoever plays on it, so this is the
 * ground's own count of the fixtures played on it, and it wears whether or not
 * the club that commissioned the work is the one playing. Every fourth home
 * fixture the winter takes a point off the surface — unless somebody is paying
 * the upkeep, in which case the pitch is cut, marked, rolled and covered and
 * holds what it has.
 *
 * The floor is the surface the ground was born with, written the first time
 * anything moves it. So a club can lose what it has bought and never what the
 * world gave it, and a county of unimproved pitches — which is most of them —
 * does not slowly erode over a career.
 */
function wearGroundsFor(state: GameState, date: ISODate): void {
  // Every fixture actually played on the pitch, friendlies included: a ground
  // does not know whether the league was counting, and a pre-season friendly in
  // August is twenty-two men on the same grass as a Sunday in February. What is
  // excluded is football that was never played — a fixture still in hand is not
  // `played` and a game called off has no result to count.
  const played = Object.values(state.matches).filter(
    (match) => match.played && match.date === date && match.result !== null,
  );
  if (played.length === 0) return;

  const perGround = new Map<GroundId, number>();
  for (const match of played) perGround.set(match.groundId, (perGround.get(match.groundId) ?? 0) + 1);

  for (const [groundId, count] of perGround) {
    const ground = state.world.grounds[groundId];
    // An artificial pitch does not wear, and a day already counted is not
    // counted again: a save resumed on a Sunday does not wear it twice.
    if (!ground || ground.surface === '3G') continue;
    if (ground.lastWearOn === date) continue;
    ground.lastWearOn = date;
    ground.fixturesSinceAttention = (ground.fixturesSinceAttention ?? 0) + count;
    if (groundIsKeptUp(state, groundId)) continue;

    while ((ground.fixturesSinceAttention ?? 0) >= GROUND_UPKEEP.fixturesPerWear) {
      ground.fixturesSinceAttention -= GROUND_UPKEEP.fixturesPerWear;
      if (ground.baseQuality === undefined) ground.baseQuality = ground.quality;
      if (ground.quality > ground.baseQuality) ground.quality -= 1;
    }
  }
}

/** True when any club using this ground is paying for it to be looked after. */
function groundIsKeptUp(state: GameState, groundId: GroundId): boolean {
  const upkeep = facilitiesStore(state).upkeep;
  for (const clubId of Object.keys(upkeep)) {
    if (upkeep[clubId as ClubId] !== true) continue;
    if (state.clubs[clubId as ClubId]?.groundId === groundId) return true;
  }
  return false;
}

