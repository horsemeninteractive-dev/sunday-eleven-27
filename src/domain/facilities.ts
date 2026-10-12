import type { ClubId, GroundId, ISODate } from './ids';

/**
 * The ground, and the work a committee can put into it.
 *
 * A Sunday club's ground is the most expensive thing it owns and the thing it
 * complains about most: the far corner holds water, the surface is bald by
 * February, there is nowhere to get changed, and the bar is a hatch in a shed.
 * This is that, as data. What each job *costs* and how long it takes lives here
 * with everything else the game knows about money, so no screen invents a price.
 *
 * The jobs are deliberately a short list with a distinct shape rather than a
 * menu. Two of them are work on the pitch itself — the drainage and the surface
 * — and both are read by systems that already exist: the surface is what the
 * engine's pitch penalty and the league's ground standard are measured in, and
 * the drainage is what decides whether a Sunday is lost to water. The other two
 * are what a ground has: lights, and a roof over the bar. Every one of them ends
 * in a fact the rest of the game already reads, which is the whole test of
 * whether a job is worth offering. Nothing here is a number that only the
 * ground screen can see.
 *
 * What a club may commission depends on the ground, not on the club: a side
 * that only hires somebody else's pitch cannot relay it, and the screen says so
 * rather than greying the button out and leaving the manager to guess.
 */

export type GroundWork = 'drainage' | 'surface' | 'floodlights' | 'clubhouse';

export interface GroundWorkLevel {
  /** What this stage of the job costs, in pounds. */
  cost: number;
  /** Days from commissioning to handover. The season carries on while it is done. */
  days: number;
}

export interface GroundWorkProfile {
  id: GroundWork;
  label: string;
  /** One line on what the job is, in the committee's words. */
  blurb: string;
  /**
   * What it changes about the world, and which system reads it. Deliberately
   * about the simulation rather than the number: "fewer Sundays lost to water"
   * is the benefit, and the drainage figure is how it is done.
   */
  effect: string;
  /**
   * Whether the work is the ground-holder's to commission.
   *
   * The pitch and anything built on it belong to whoever holds the ground. A
   * club that hires its pitch pays for the hire, not for a new surface, and that
   * is a real restriction rather than a difficulty setting.
   */
  needsTheLease: boolean;
  /** Each level of the job, cheapest and quickest first. */
  levels: GroundWorkLevel[];
}

/**
 * The four jobs.
 *
 * Sizes are grassroots: a couple of hundred pounds for a drainage scheme on a
 * recreation ground, a few hundred for a re-lay, four figures for the lights and
 * the bar. The order matters to the club that reads them, so they are listed
 * pitch first, buildings second.
 */
export const GROUND_WORKS: Record<GroundWork, GroundWorkProfile> = {
  drainage: {
    id: 'drainage',
    label: 'Pitch drainage',
    blurb: 'Herringbone drains, sand slits and a new soakaway under the worst corner.',
    effect: 'The pitch holds less water, so fewer Sundays are lost to a waterlogged or muddy surface.',
    needsTheLease: true,
    levels: [
      { cost: 320, days: 10 },
      { cost: 520, days: 14 },
      { cost: 760, days: 18 },
    ],
  },
  surface: {
    id: 'surface',
    label: 'Pitch surface',
    blurb: 'Scarify, re-seed and top-dress — a proper job on the grass, not a lick of paint.',
    effect: 'The surface reads better on the day: the ball misbehaves less and the ground meets the league’s standard.',
    needsTheLease: true,
    levels: [
      { cost: 480, days: 14 },
      { cost: 700, days: 21 },
      { cost: 980, days: 28 },
    ],
  },
  floodlights: {
    id: 'floodlights',
    label: 'Floodlights',
    blurb: 'Four heads on two masts and the cable trench to feed them.',
    effect: 'Thursday nights run their full length through the winter, and a frozen pitch is less often called off.',
    needsTheLease: true,
    levels: [{ cost: 1150, days: 21 }],
  },
  clubhouse: {
    id: 'clubhouse',
    label: 'Clubhouse',
    blurb: 'A bar that opens, a kitchen and somewhere to sit down after the game.',
    effect: 'The bar takes proper money on a home Sunday, and a few more come through the gate.',
    needsTheLease: true,
    levels: [{ cost: 1600, days: 28 }],
  },
};

/** The jobs in the order the ground screen offers them. */
export const GROUND_WORK_ORDER: readonly GroundWork[] = ['drainage', 'surface', 'floodlights', 'clubhouse'];

/**
 * How much of a 1-20 ground fact one level of a job is worth.
 *
 * Both are three, which is a step a manager can see in the number and feel in
 * the football: the drainage step is the difference between losing a Sunday in
 * February and playing it, and the surface step is the difference between the
 * league's ground standard and missing it. The cap is the ground itself — there
 * is no drainage 23 — so the last level of either is worth less than the first
 * and the screen says so rather than selling a number the ground cannot hold.
 */
export const GROUND_WORK_STEP: Record<'drainage' | 'surface', number> = {
  drainage: 3,
  surface: 3,
};

/** What a club gets back when it pulls out of a job already paid for. */
export const GROUND_WORK_CANCELLATION_REFUND = 0.5;

/**
 * The club's standing arrangement with the ground.
 *
 * Not an upgrade: a commitment. A pitch that is cut, marked, rolled and covered
 * holds the condition it is in; one that is not is ground down by a winter of
 * Sundays until it is back to whatever the ground was born with. So the weekly
 * sum is the price of keeping what the club has already paid for, which is the
 * only honest way for a Sunday club to think about ground maintenance.
 */
/**
 * The id the upkeep's weekly date is scheduled under.
 *
 * Named here rather than in either module that uses it, because two of them do:
 * the calendar publishes the rule (`recurringEvents`) and the ground service
 * charges against it, and those two have to agree on the name or the club is
 * never billed.
 */
export const RECURRING_UPKEEP_ID = 'rec_upkeep';

export const GROUND_UPKEEP = {
  perWeek: 9,
  label: 'Ground upkeep',
  detail: 'The groundsman’s money, the mower, the line paint and the winter covers.',
  /** The day of the week the upkeep is charged, 0-7 with 5 a Friday. */
  weekday: 5,
  /**
   * Home fixtures on a pitch before the winter takes a point off the surface.
   *
   * Four matches is roughly two months of Sundays: fast enough that a manager
   * sees the ground going off in a bad winter and does something about it, slow
   * enough that one wet fortnight is not the end of the surface.
   */
  fixturesPerWear: 4,
} as const;

/**
 * One job, commissioned.
 *
 * The money leaves the account the day it is commissioned — a contractor is
 * engaged and paid a deposit, and a club that has spent it has spent it — and
 * what the club gets for it arrives on `completesOn`. `completedOn` is what
 * makes the handover apply exactly once: a day processed twice cannot buy the
 * club the same drainage twice.
 */
export interface GroundWorkProject {
  id: string;
  clubId: ClubId;
  groundId: GroundId;
  work: GroundWork;
  /** The stage this job delivers, counted from one. */
  level: number;
  /** What it cost, and what went on the ledger the day it was commissioned. */
  cost: number;
  startedOn: ISODate;
  completesOn: ISODate;
  /** The day the work was handed over, or null while it is still in hand. */
  completedOn: ISODate | null;
  /** The day the club pulled out of it, or null. Never set on a finished job. */
  cancelledOn: ISODate | null;
}

export interface FacilitiesState {
  /** Every job commissioned, newest first. Finished and cancelled jobs are the record. */
  projects: GroundWorkProject[];
  /** Clubs paying the weekly upkeep. Only the manager's club ever does. */
  upkeep: Record<ClubId, boolean>;
  /**
   * The last date each club's weekly upkeep was booked.
   *
   * The charge is dated by the calendar rather than by the click, so the day it
   * falls on can be processed twice — a save resumed on it, a day re-run by a
   * tool. This is what makes the week a club has paid for a week it has paid for
   * once, whatever happens to the date afterwards.
   */
  upkeepPaidOn: Record<ClubId, ISODate>;
}

export function emptyFacilitiesState(): FacilitiesState {
  return { projects: [], upkeep: {} as Record<ClubId, boolean>, upkeepPaidOn: {} as Record<ClubId, ISODate> };
}

/** The ground fields the club's own work is measured against. */
export interface GroundConditionFields {
  quality: number;
  drainage: number;
  hasFloodlights: boolean;
  hasClubhouse: boolean;
}

/** Whether a work would change anything at all on a ground as it stands. */
export function workWouldChange(work: GroundWork, ground: GroundConditionFields): boolean {
  switch (work) {
    case 'floodlights':
      return !ground.hasFloodlights;
    case 'clubhouse':
      return !ground.hasClubhouse;
    case 'drainage':
      return ground.drainage < 20;
    case 'surface':
      return ground.quality < 20;
  }
}
