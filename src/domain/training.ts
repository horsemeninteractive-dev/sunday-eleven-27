import type { ClubId, ISODate, PersonId } from './ids';
import type { PitchCondition, Weather } from './match';
import type { SystemFamiliarity } from './person';
import type { Tactics } from './tactics';

/**
 * Training.
 *
 * A Sunday League club trains on one evening a week, on whatever pitch it can
 * get, with whoever turns up. The manager picks a handful of broad blocks
 * rather than a professional programme, and the session does three things at
 * once: it tires people out, it teaches them how this team plays, and it is one
 * of the few times in the week that the whole squad is in the same place.
 *
 * Everything here is plain data: blocks are a static catalogue, plans are what
 * the manager has set up, sessions are what actually happened.
 */

export type TrainingBlockId =
  | 'warm-up'
  | 'possession'
  | 'attacking'
  | 'defending'
  | 'fitness'
  | 'tactical'
  | 'set-pieces'
  | 'teamwork';

export interface TrainingBlockDefinition {
  id: TrainingBlockId;
  label: string;
  /** What the manager would say it is for, in one line. */
  purpose: string;
  /** Flat attribute keys (`group.key`) this block works on. */
  develops: string[];
  /** Nominal minutes; sessions scale the blocks to the length chosen. */
  minutes: number;
  /** Relative tiredness (1 = an ordinary block). */
  load: number;
  /** How much it brings the group together (0-1). */
  social: number;
  /** Familiarity this block builds when it goes well. */
  builds: Partial<Record<keyof SystemFamiliarity, number>>;
  /** Blocks that are pointless, or risky, without a warm-up first. */
  needsWarmUp: boolean;
}

export const TRAINING_BLOCKS: Record<TrainingBlockId, TrainingBlockDefinition> = {
  'warm-up': {
    id: 'warm-up',
    label: 'Warm-up',
    purpose: 'Get the legs going, loosen off whoever is carrying something.',
    develops: [],
    minutes: 12,
    load: 0.15,
    social: 0.2,
    builds: {},
    needsWarmUp: false,
  },
  possession: {
    id: 'possession',
    label: 'Possession',
    purpose: 'Passing, control and decisions in tight areas.',
    develops: ['technical.passing', 'technical.ballControl', 'mental.decisions', 'hidden.tacticalIntelligence'],
    minutes: 22,
    load: 0.85,
    social: 0.35,
    builds: { instructions: 0.08 },
    needsWarmUp: true,
  },
  attacking: {
    id: 'attacking',
    label: 'Attacking',
    purpose: 'Shooting, movement and finishing under a bit of pressure.',
    develops: ['technical.shooting', 'technical.passing', 'mental.positioning', 'mental.composure'],
    minutes: 25,
    load: 1,
    social: 0.3,
    builds: {},
    needsWarmUp: true,
  },
  defending: {
    id: 'defending',
    label: 'Defending',
    purpose: 'Tackling, marking and holding a shape.',
    develops: ['technical.tackling', 'mental.positioning', 'mental.decisions', 'physical.strength'],
    minutes: 25,
    load: 1.05,
    social: 0.25,
    builds: {},
    needsWarmUp: true,
  },
  fitness: {
    id: 'fitness',
    label: 'Fitness',
    purpose: 'Running. Everyone hates it, everybody needs it.',
    develops: ['physical.stamina', 'physical.strength', 'physical.pace'],
    minutes: 25,
    load: 1.7,
    social: 0.15,
    builds: {},
    needsWarmUp: true,
  },
  tactical: {
    id: 'tactical',
    label: 'Tactical',
    purpose: 'Walk through the shape, the triggers and who goes where.',
    develops: ['hidden.tacticalIntelligence', 'mental.positioning', 'mental.decisions'],
    minutes: 25,
    load: 0.7,
    social: 0.35,
    builds: { formation: 0.45, instructions: 0.5 },
    needsWarmUp: true,
  },
  'set-pieces': {
    id: 'set-pieces',
    label: 'Set pieces',
    purpose: 'Corners, free kicks and who is marking who.',
    develops: ['technical.crossing', 'technical.heading', 'technical.shooting', 'technical.passing'],
    minutes: 20,
    load: 0.6,
    social: 0.35,
    builds: { setPieces: 0.65, instructions: 0.1 },
    needsWarmUp: true,
  },
  teamwork: {
    id: 'teamwork',
    label: 'Teamwork',
    purpose: 'Small-sided games, talking, getting to know each other.',
    develops: ['mental.workRate', 'mental.determination', 'behavioural.commitment', 'hidden.tacticalIntelligence'],
    minutes: 20,
    load: 0.9,
    social: 0.8,
    builds: { formation: 0.15, instructions: 0.15 },
    needsWarmUp: true,
  },
};

export const TRAINING_BLOCK_ORDER: TrainingBlockId[] = [
  'warm-up',
  'possession',
  'attacking',
  'defending',
  'fitness',
  'tactical',
  'set-pieces',
  'teamwork',
];

export type TrainingLength = 'short' | 'normal' | 'long';

export const TRAINING_LENGTH_MINUTES: Record<TrainingLength, number> = {
  short: 60,
  normal: 90,
  long: 120,
};

export const TRAINING_LENGTH_LABEL: Record<TrainingLength, string> = {
  short: 'Short',
  normal: 'Normal',
  long: 'Long',
};

export const TRAINING_LENGTH_DETAIL: Record<TrainingLength, string> = {
  short: 'About an hour. Enough to work on one thing.',
  normal: 'An hour and a half, the usual.',
  long: 'Two hours. More work, more tired legs.',
};

/** How many blocks fit in a session of each length. */
export const TRAINING_LENGTH_BLOCKS: Record<TrainingLength, number> = {
  short: 3,
  normal: 4,
  long: 5,
};

export function blockCapacity(length: TrainingLength): number {
  return TRAINING_LENGTH_BLOCKS[length];
}

/**
 * The plan is the manager's standing arrangement: it carries over from week to
 * week (most clubs do roughly the same thing every Thursday) until it is
 * changed.
 */
export interface TrainingPlan {
  clubId: ClubId;
  /** Matchday this session is being prepared for. */
  matchday: number;
  length: TrainingLength;
  blocks: TrainingBlockId[];
  /** Book the sports hall if the pitch is unfit — costs a bit more. */
  fallbackVenue: boolean;
}

export type TrainingAttendanceStatus = 'attending' | 'doubtful' | 'absent' | 'trialist';

export interface TrainingAttendanceEntry {
  personId: PersonId;
  status: TrainingAttendanceStatus;
  /** Why he is a doubt, or why he is missing. */
  reason: string | null;
}

export interface TrainingStandout {
  personId: PersonId;
  line: string;
}

export interface TrainingImprovement {
  personId: PersonId;
  attribute: string;
  label: string;
}

/**
 * An attribute lost to age rather than to injury. The mirror of an improvement,
 * and the reason a squad's quality settles instead of climbing for ever.
 */
export interface TrainingDecline {
  personId: PersonId;
  attribute: string;
  label: string;
}

export interface TrainingSession {
  id: string;
  clubId: ClubId;
  matchday: number;
  date: ISODate;
  length: TrainingLength;
  minutes: number;
  blocks: TrainingBlockId[];
  venueName: string;
  /** True when the session was moved off the grass. */
  indoor: boolean;
  weather: Weather;
  pitch: PitchCondition;
  temperatureC: number;
  /** Ran out of light, or the pitch was only half usable. */
  shortened: string | null;
  cancelled: boolean;
  cancelReason: string | null;
  attended: number;
  doubtful: number;
  absent: number;
  /** How many the manager was expecting on the grass beforehand. */
  expectedAttending: number;
  /** Full detail for the manager's own club; other clubs keep the numbers only. */
  attendance: TrainingAttendanceEntry[];
  coachName: string;
  coachRole: string;
  /** 0-1: the best coach who actually turned up. */
  coachQuality: number;
  /** 0-100 how well the session went. */
  quality: number;
  summary: string;
  /** Things the manager noticed. */
  observations: string[];
  standouts: TrainingStandout[];
  trialistIds: PersonId[];
  injuredIds: PersonId[];
  /** Attribute increases that actually landed. Rare, and worth mentioning. */
  improvements: TrainingImprovement[];
  /** Attributes given back to age over this session. */
  declines: TrainingDecline[];
  /** Mean system familiarity gained by those who trained (0-1 scale). */
  familiarityGain: number;
}

export interface TrainingStore {
  /** The session set up for the coming week, per club. */
  plans: Record<ClubId, TrainingPlan>;
  /** Completed sessions, newest first, pruned per club. */
  history: TrainingSession[];
  /**
   * Accumulated development opportunity per person, per attribute key. Work
   * builds up here over weeks; only occasionally does it turn into a visible
   * improvement in the attribute itself.
   */
  development: Record<PersonId, Record<string, number>>;
  /** The tactical system each club's familiarity was earned under. */
  systemSignatures: Record<ClubId, string>;
}

export function emptyTrainingStore(): TrainingStore {
  return { plans: {}, history: [], development: {}, systemSignatures: {} };
}

export const TRAINING_SESSION_HISTORY_PER_CLUB = 8;

/** A stable signature of the way a club is trying to play, for familiarity. */
export function tacticsSignature(tactics: Tactics): string {
  return [
    tactics.formation,
    tactics.mentality,
    tactics.passingStyle,
    tactics.tempo,
    tactics.pressing,
    tactics.defensiveLine,
    tactics.attackingFocus,
  ].join('|');
}

export interface QualityDescription {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted' | 'accent';
}

/** How the manager would describe a session afterwards. */
export function describeSessionQuality(quality: number): QualityDescription {
  if (quality >= 78) return { label: 'Excellent', tone: 'ok' };
  if (quality >= 64) return { label: 'Good', tone: 'ok' };
  if (quality >= 50) return { label: 'Decent', tone: 'accent' };
  if (quality >= 36) return { label: 'Ordinary', tone: 'muted' };
  if (quality >= 22) return { label: 'Poor', tone: 'warn' };
  return { label: 'A waste of an evening', tone: 'bad' };
}

/** System familiarity as the squad would talk about it (value is 0-1). */
export function describeSystemFamiliarity(value: number): string {
  if (value >= 0.85) return 'Knows it inside out';
  if (value >= 0.72) return 'Knows the system';
  if (value >= 0.58) return 'Getting there';
  if (value >= 0.44) return 'Still learning it';
  return 'New to the way we play';
}

/** Cohesion is derived from the squad, never stored (0-1). */
export function describeCohesion(value: number): string {
  if (value >= 0.72) return 'Very settled';
  if (value >= 0.6) return 'Good understanding';
  if (value >= 0.46) return 'Developing';
  return 'Settling in';
}

export function describeSetPieceWork(value: number): string {
  if (value >= 0.8) return 'Rehearsed';
  if (value >= 0.6) return 'Organised';
  if (value >= 0.4) return 'Basic';
  return 'Not worked on';
}

export interface TrainingAdvice {
  /** Short line shown to the manager; never a command. */
  text: string;
  tone: 'ok' | 'warn' | 'muted' | 'accent';
}

export function sessionBlockMinutes(blocks: readonly TrainingBlockId[], sessionMinutes: number): Map<TrainingBlockId, number> {
  const total = blocks.reduce((sum, id) => sum + TRAINING_BLOCKS[id].minutes, 0);
  const scale = total > 0 ? sessionMinutes / total : 1;
  const result = new Map<TrainingBlockId, number>();
  for (const id of blocks) {
    result.set(id, Math.max(4, Math.round(TRAINING_BLOCKS[id].minutes * scale)));
  }
  return result;
}
