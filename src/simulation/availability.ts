import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { isOfficial, type AvailabilityReason, type AvailabilityState, type Official, type Player, type StaffAvailability } from '@/domain/person';
import { addDays, monthOf } from './calendar';
import { Rng, stream } from './rng';

/**
 * Availability is the heart of grassroots management: being registered does
 * not mean being available. Every week, each player's life rolls around
 * football — shifts, holidays, kids' birthdays, bad knees and hangovers.
 *
 * The model is intentionally simple for this slice, but every factor is
 * derived from the player's situation (occupation, age, reliability,
 * personality, month), so a richer life simulation can extend it later without
 * changing the surrounding systems.
 */

const SUNDAY_MORNING_UNFRIENDLY_JOBS = [
  'Barman',
  'Bar manager',
  'Chef',
  'Pub landlord',
  'Nurse',
  'Paramedic',
  'Care worker',
  'Police officer',
  'Firefighter',
  'Security guard',
  'Postman',
  'Delivery driver',
];

function monthHolidayWeight(month: number): number {
  // June-September is peak holiday season for family breaks.
  if (month >= 5 && month <= 8) return 3.2;
  if (month === 3 || month === 4 || month === 9 || month === 11) return 1.4;
  return 0.8;
}

export interface AvailabilityInput {
  rng: Rng;
  player: Player;
  date: ISODate;
  /** Match date this availability covers. */
  matchDate: ISODate | null;
  /** Conflicts with work are found out earlier at well-run clubs. */
  clubOrganisation: number;
}

export function rollAvailability(input: AvailabilityInput): AvailabilityState {
  const { rng, player, date } = input;

  if (player.injury && player.injury.daysOut > 0) {
    return {
      status: 'unavailable',
      reason: 'injury',
      note: `Out with ${player.injury.description}`,
      until: addDays(date, player.injury.daysOut),
      discoveredLate: false,
    };
  }

  const reliability = player.attributes.behavioural.reliability / 20;
  const commitment = player.attributes.behavioural.commitment / 20;
  const age = player.age;

  // Rates are tuned so a squad of 20-25 usually leaves the manager roughly
  // 18-20 players to choose from — enough to make real decisions, never enough
  // to feel safe. Shifts, holidays and family come before football.
  const workBase = SUNDAY_MORNING_UNFRIENDLY_JOBS.includes(player.occupation) ? 0.28 : 0.05;
  const workChance = workBase * (1.35 - reliability * 0.5);
  const holidayChance = 0.018 * monthHolidayWeight(monthOf(date));
  const familyChance = (0.022 + (age > 28 ? 0.022 : 0) + (age < 21 ? 0.015 : 0)) * (1.4 - commitment * 0.8);
  const illnessChance = 0.018 + (age > 34 ? 0.015 : 0);
  const otherFootballChance = age < 24 ? 0.02 : 0.008;
  const lateWithdrawalChance = Math.max(0.002, 0.06 * (1 - reliability) * (1 - reliability + 0.3));
  const personalChance = 0.014;
  const doubtfulChance = 0.07 + (1 - reliability) * 0.05;

  const roll = rng.next();
  let cursor = workChance;
  if (roll < cursor) {
    return {
      status: rng.chance(0.55) ? 'unavailable' : 'doubtful',
      reason: 'work',
      note: 'On shift Sunday morning',
      until: null,
      discoveredLate: false,
    };
  }
  cursor += holidayChance;
  if (roll < cursor) {
    return { status: 'unavailable', reason: 'holiday', note: 'Away on holiday', until: null, discoveredLate: false };
  }
  cursor += familyChance;
  if (roll < cursor) {
    return { status: 'unavailable', reason: 'family', note: 'Family commitment', until: null, discoveredLate: false };
  }
  cursor += illnessChance;
  if (roll < cursor) {
    return { status: 'doubtful', reason: 'illness', note: 'Under the weather', until: null, discoveredLate: false };
  }
  cursor += otherFootballChance;
  if (roll < cursor) {
    return {
      status: rng.chance(0.5) ? 'doubtful' : 'unavailable',
      reason: 'other-football',
      note: 'Playing Saturday football too',
      until: null,
      discoveredLate: false,
    };
  }
  cursor += personalChance;
  if (roll < cursor) {
    return { status: 'doubtful', reason: 'personal', note: 'Something on at home', until: null, discoveredLate: false };
  }
  cursor += lateWithdrawalChance;
  if (roll < cursor) {
    return {
      status: 'doubtful',
      reason: 'unexplained',
      note: 'Not answering his phone',
      until: null,
      discoveredLate: true,
    };
  }
  cursor += doubtfulChance;
  if (roll < cursor) {
    const niggles: Array<{ reason: AvailabilityReason; note: string }> = [
      { reason: 'injury', note: 'Knee playing up in training' },
      { reason: 'injury', note: 'Took a knock last week' },
      { reason: 'personal', note: 'Might be late' },
      { reason: 'work', note: 'On call, may get called out' },
      { reason: 'illness', note: 'Cold hanging around' },
    ];
    const niggle = rng.pick(niggles);
    return { status: 'doubtful', reason: niggle.reason, note: niggle.note, until: null, discoveredLate: rng.chance(0.25) };
  }

  return { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
}

/**
 * Recovery, by the day.
 *
 * A ten-day injury is ten days: `daysOut` counts down to zero and the player
 * comes back on the day it reaches it, not "a week later". Fitness, form and
 * morale all drift on the same clock.
 *
 * The drift is scaled so that a full week of daily calls lands where the old
 * single weekly tick used to: form moves 12% of the way to average across seven
 * days, morale 5%. Nothing about the underlying model changed — only how finely
 * it is stepped.
 */
export function recoverPlayer(player: Player, days: number, physioSupport = 0): void {
  // A physio at the club gets a man back to full fitness a little quicker, but
  // the injury itself is the body's business: `physioSupport` (0-1) scales only
  // the fitness regained, never the `daysOut` countdown below. "A ten-day injury
  // is ten days" stays true whichever club the man plays for.
  const support = Math.max(0, Math.min(1, physioSupport));
  const fitnessGain = Math.min(100, player.fitness + days * 3.2 * (1 + support * 0.6));
  player.fitness = Math.round(fitnessGain * 10) / 10;

  if (player.injury) {
    player.injury.daysOut = Math.max(0, player.injury.daysOut - days);
    if (player.injury.daysOut === 0) player.injury = null;
  }

  const weeks = days / 7;
  const formPull = 1 - Math.pow(1 - 0.12, weeks);
  const moralePull = 1 - Math.pow(1 - 0.05, weeks);
  player.form = Math.round((player.form + (50 - player.form) * formPull) * 10) / 10;
  player.morale = Math.round(
    Math.max(20, Math.min(99, player.morale + (60 - player.morale) * moralePull)),
  );
}

/** One day of the same recovery, plus the one thing a week hides: who returned. */
export interface DailyRecovery {
  /** He came back from injury today. */
  returned: boolean;
  /** Days still to go on an injury, or null when he is fit. */
  daysOut: number | null;
}

export function recoverPlayerDaily(
  player: Player,
  options: { physioSupport?: number } = {},
): DailyRecovery {
  const hadInjury = Boolean(player.injury);
  const before = player.injury?.daysOut ?? null;
  const support = Math.max(0, Math.min(1, options.physioSupport ?? 0));
  // One day of the same recovery, physio or no physio. The injury state — the
  // countdown and the day it clears — is exactly what the body decided.
  recoverPlayer(player, 1, support);
  const returned = hadInjury && player.injury === null;
  if (returned) {
    player.availability = { status: 'available', reason: null, note: null, until: null, discoveredLate: false };
  }
  return { returned, daysOut: returned ? null : (player.injury?.daysOut ?? before) };
}

/**
 * The life that gets in the way, one day at a time.
 *
 * This is deliberately quiet: most days, nothing happens to anybody. What it
 * adds over the weekly roll is *when* things are found out — a shift change on
 * Wednesday, a family birthday mentioned on Friday, a niggle that clears
 * overnight. Availability is no longer a number that resets on a Monday.
 */
export type LifeChangeKind = 'loses' | 'doubts' | 'clears' | 'worsens';

export interface DailyLifeChange {
  kind: LifeChangeKind;
  reason: AvailabilityReason;
  note: string;
}

function monthLifeWeight(month: number): number {
  if (month >= 5 && month <= 8) return 2.4;
  if (month === 3 || month === 4 || month === 9 || month === 11) return 1.2;
  return 0.8;
}

/**
 * Does anything happen to this player's availability today?
 *
 * Returns null on the overwhelming majority of player-days. Every roll comes
 * from the seed and the date, so the same save always produces the same week.
 */
export function rollDailyLifeChange(input: {
  rng: Rng;
  player: Player;
  date: ISODate;
  /** The date of the next match, when the club has one. */
  matchDate: ISODate | null;
}): DailyLifeChange | null {
  const { rng, player, date } = input;
  if (player.injury && player.injury.daysOut > 0) return null;

  const reliability = player.attributes.behavioural.reliability / 20;
  const commitment = player.attributes.behavioural.commitment / 20;
  const status = player.availability.status;

  // Somebody who is already a doubt can sort it out — or have it get worse.
  if (status === 'doubtful') {
    if (rng.chance(0.16)) {
      return { kind: 'clears', reason: player.availability.reason ?? 'personal', note: 'It sorted itself out' };
    }
    if (rng.chance(0.07)) {
      const note = player.availability.note ?? 'It got worse';
      return { kind: 'worsens', reason: player.availability.reason ?? 'personal', note };
    }
    return null;
  }

  // Somebody who is out for non-football reasons might yet turn up.
  if (status === 'unavailable') {
    if (rng.chance(0.2)) {
      return { kind: 'clears', reason: player.availability.reason ?? 'personal', note: 'He is back in' };
    }
    return null;
  }

  // Available, and life happens.
  const workBase = SUNDAY_MORNING_UNFRIENDLY_JOBS.includes(player.occupation) ? 0.02 : 0.004;
  const chance =
    (workBase + 0.004 * monthLifeWeight(monthOf(date)) + (player.age > 32 ? 0.004 : 0)) *
    (1.4 - reliability * 0.6) *
    (1.25 - commitment * 0.4);

  const roll = rng.next();
  if (roll >= chance) return null;

  const severe = rng.chance(0.55);
  const pool: Array<{ kind: LifeChangeKind; reason: AvailabilityReason; note: string }> = [
    { kind: 'loses', reason: 'work', note: 'Shift changed — on Sunday morning now' },
    { kind: 'loses', reason: 'family', note: "Family do he can't get out of" },
    { kind: 'loses', reason: 'holiday', note: 'Booked a few days away' },
    { kind: 'loses', reason: 'other-football', note: 'Playing Saturday football instead' },
    { kind: 'doubts', reason: 'work', note: 'On call, may get called out' },
    { kind: 'doubts', reason: 'personal', note: 'Something on at home' },
    { kind: 'doubts', reason: 'illness', note: 'Feeling rough' },
    { kind: 'doubts', reason: 'injury', note: 'Something is not right with his knee' },
  ];
  const chosen = rng.pick(pool);
  if (chosen.kind === 'loses' && !severe) return { ...chosen, kind: 'doubts' };
  if (chosen.kind === 'doubts' && severe) return { ...chosen, kind: 'loses' };
  return chosen;
}

export function availabilitySummary(state: AvailabilityState): string {
  if (state.status === 'available') return 'Available';
  if (state.status === 'doubtful') return `Doubtful — ${state.note ?? 'unclear'}`;
  return `Unavailable — ${state.note ?? 'no reason given'}`;
}
/* ------------------------------------------------------------------------ *
 * Staff availability
 * ------------------------------------------------------------------------ */

/**
 * Whether a member of staff is around this week.
 *
 * The same life that gets in the way of a player gets in the way of the physio,
 * the secretary and the scout: shifts, holidays, a family do, a bad chest. It is
 * the same shape of model as a player's — a status and a note — because it
 * exists to explain why somebody is not there, not to model a second fitness
 * system. Reliability, the role's own attribute, is what makes one volunteer a
 * fixture and another a man you can never pin down.
 */
export function rollStaffAvailability(rng: Rng, official: Official, date: ISODate): StaffAvailability {
  const reliability = (official.attributes.reliability ?? 11) / 20;
  // A man whose day job already eats Sundays is likelier to be missing.
  const workBase = SUNDAY_MORNING_UNFRIENDLY_JOBS.includes(official.occupation) ? 0.05 : 0.015;
  const workChance = workBase * (1.3 - reliability * 0.5);
  const holidayChance = 0.014 * monthHolidayWeight(monthOf(date));
  const familyChance = 0.02;
  const illnessChance = official.age > 60 ? 0.03 : 0.015;
  const personalChance = 0.014;

  const roll = rng.next();
  let cursor = workChance;
  if (roll < cursor) return { status: 'unavailable', note: 'Working this week' };
  cursor += holidayChance;
  if (roll < cursor) return { status: 'unavailable', note: 'Away on holiday' };
  cursor += familyChance;
  if (roll < cursor) return { status: 'unavailable', note: 'Family commitment' };
  cursor += illnessChance;
  if (roll < cursor) return { status: 'unavailable', note: 'Under the weather' };
  cursor += personalChance;
  if (roll < cursor) return { status: 'unavailable', note: 'Something on at home' };
  return { status: 'available', note: null };
}

/**
 * Roll the committee's availability for the week, on the same Monday the
 * players' list goes up. Only serving club staff (and the chairman) are rolled:
 * the manager is the manager, and a referee is not the club's business.
 *
 * Absence never removes a role from the club — the roster is unchanged, so the
 * club keeps working, just a man short, until he is back.
 */
export function rollWeeklyStaffAvailabilityForAll(state: GameState): void {
  for (const person of Object.values(state.people)) {
    if (!isOfficial(person)) continue;
    const official: Official = person;
    if (official.role === 'manager' || official.role === 'referee') continue;
    if (official.clubId === null) continue;
    const rng = stream(state.seed, 'staff-availability', state.date, official.id);
    official.availability = rollStaffAvailability(rng, official, state.date);
  }
}
