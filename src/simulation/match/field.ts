import type {
  BallState,
  FieldZone,
  Match,
  MatchFieldState,
  MatchPhase,
  TeamShape,
} from '@/domain/match';
import type { MatchContext, Side } from './core';
import { otherSide } from './core';

/**
 * The football pitch, as the simulation understands it.
 *
 * Not a picture — the watched match has its own, much richer, spatial state for
 * that. This is the small working model the *decisions* are made from: where the
 * ball is, how each side is standing, and how hard each is pressing. A pass is
 * risky because of where it is going and who is closing, and that has to be
 * knowable without drawing anything.
 *
 * One frame throughout: the home side always attacks toward x = 1. The away side
 * therefore attacks toward x = 0, and every helper here takes a side so a caller
 * never has to remember which way round it is. Progress is always measured from
 * the possessing side's own goal, so "0.8" means something in the final third
 * whoever has the ball.
 */

/** How far up the pitch a team's three lines sit, from its own goal (0) to theirs (1). */
const LINE_HEIGHT = {
  deep: { back: 0.15, middle: 0.33, front: 0.55 },
  standard: { back: 0.24, middle: 0.44, front: 0.67 },
  high: { back: 0.35, middle: 0.54, front: 0.78 },
} as const;

const PRESS_FACTOR = { low: 0.15, medium: 0.5, high: 1 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** The goal a side is attacking, in the fixed frame. */
export function goalX(side: Side): number {
  return side === 'home' ? 1 : 0;
}

/** The goal a side is defending, in the fixed frame. */
export function ownGoalX(side: Side): number {
  return side === 'home' ? 0 : 1;
}

/** A player's own rectory: 0 at his own goal line, 1 at the one he attacks. */
export function progressOf(side: Side, x: number): number {
  return side === 'home' ? x : 1 - x;
}

/** Turn a progress value back into a fixed-frame x. */
export function xFromProgress(side: Side, progress: number): number {
  return side === 'home' ? progress : 1 - progress;
}

export function zoneOf(side: Side, x: number): FieldZone {
  const progress = progressOf(side, x);
  if (progress < 0.12) return 'own-box';
  if (progress < 0.34) return 'own-third';
  if (progress < 0.66) return 'middle';
  if (progress < 0.84) return 'final-third';
  return 'box';
}

/** The phase a side in possession is in, read straight off where the ball is. */
export function phaseForZone(zone: FieldZone): MatchPhase {
  switch (zone) {
    case 'own-box':
    case 'own-third':
      return 'build-up';
    case 'middle':
      return 'progression';
    case 'final-third':
      return 'final-third';
    case 'box':
      return 'chance';
  }
}

/** Roughly how much a field position is worth: own box is dangerous, the box is not. */
export function dangerOf(zone: FieldZone): number {
  switch (zone) {
    case 'own-box':
      return 0.85;
    case 'own-third':
      return 0.45;
    case 'middle':
      return 0.15;
    case 'final-third':
      return 0.3;
    case 'box':
      return 0.95;
  }
}

function shapeFrom(side: Side, back: number, middle: number, front: number, compactness: number, width: number): TeamShape {
  return {
    defensiveLine: xFromProgress(side, clamp01(back)),
    midfieldLine: xFromProgress(side, clamp01(middle)),
    attackingLine: xFromProgress(side, clamp01(front)),
    compactness: clamp01(compactness),
    width: clamp01(width),
  };
}

/**
 * How a side is standing right now.
 *
 * The shape comes from the manager's instructions first — where the defensive
 * line is told to hold, how hard the side is asked to press, how wide it is
 * asked to attack — and is then moved by what is actually happening: a side with
 * the ball pushes up, a side without it drops and narrows, and a tired side late
 * on cannot hold the line it was told to.
 */
export function shapeFor(
  context: MatchContext,
  side: Side,
  options: { inPossession: boolean; energy: number; urgency: number },
): TeamShape {
  const sideContext = context[side];
  const tactics = sideContext.tactics;
  const lines = LINE_HEIGHT[tactics.defensiveLine];

  let back = lines.back;
  let middle = lines.middle;
  let front = lines.front;

  // Mentality is the manager's appetite: it shifts the whole block up or down.
  const mentalityShift: Record<string, number> = {
    'very-defensive': -0.07,
    defensive: -0.035,
    balanced: 0,
    attacking: 0.035,
    'very-attacking': 0.075,
  };
  const shift = mentalityShift[tactics.mentality] ?? 0;
  back += shift;
  middle += shift * 1.15;
  front += shift * 1.3;

  // A side with the ball goes after the game; a side without it gets back in.
  if (options.inPossession) {
    back += 0.07;
    middle += 0.09;
    front += 0.07;
  } else {
    back -= 0.05;
    middle -= 0.06;
  }

  // Chasing a game lifts even a defensive side; protecting a lead late drops it.
  back += options.urgency * 0.06;
  middle += options.urgency * 0.08;
  front += options.urgency * 0.07;

  // Tired legs cannot hold a high line for ninety minutes.
  const legs = clamp01((options.energy - 35) / 65);
  back -= (1 - legs) * 0.05;
  middle -= (1 - legs) * 0.04;

  let compactness = 0.45 + PRESS_FACTOR[tactics.pressing] * 0.2;
  if (options.inPossession) compactness -= 0.12;
  if (tactics.mentality === 'very-defensive' || tactics.mentality === 'defensive') compactness += 0.1;

  let width = 0.62;
  if (tactics.attackingFocus === 'wide') width += 0.16;
  if (tactics.attackingFocus === 'central') width -= 0.18;
  if (options.inPossession) width += 0.06;
  if (tactics.passingStyle === 'short') width -= 0.04;

  return shapeFrom(side, back, middle, front, compactness, width);
}

/** How hard a side is pressing, 0..1, from its instructions and its legs. */
export function pressureFor(context: MatchContext, side: Side, options: { energy: number; inPossession: boolean }): number {
  const tactics = context[side].tactics;
  const strength = context[side].strength;
  let pressure = 0.2 + PRESS_FACTOR[tactics.pressing] * 0.45;
  pressure += (strength.aggression - 1) * 0.22;
  pressure += (strength.organisation - 1) * 0.3;
  if (!options.inPossession) pressure += 0.12;
  else pressure -= 0.18;
  pressure *= 0.7 + 0.3 * clamp01(options.energy / 100);
  return clamp01(pressure);
}

/** How aggressively a side chases a result, from the scoreline and the clock. */
export function urgencyFor(side: Side, options: { minute: number; goalDifference: number }): number {
  const { minute, goalDifference } = options;
  const late = clamp01((minute - 55) / 35);
  // A home side chasing a game gets a little more of a push from the crowd; a
  // side protecting a lead sits in a little harder.
  const crowd = side === 'home' ? 1.12 : 1;
  if (goalDifference > 0) return -0.5 * late * clamp01(goalDifference / 2) * crowd;
  if (goalDifference < 0) return 0.9 * late * clamp01(-goalDifference / 2) * crowd;
  return 0;
}

export function createBall(x = 0.5, y = 0.5): BallState {
  return { x, y, possessionSide: null, possessionPlayerId: null };
}

/**
 * Build the field state from what the match already holds.
 *
 * A save written before the simulation kept a field is given one the first time
 * it is needed — a centre ball and two shapes read off the tactics — so nothing
 * has to be versioned for it.
 */
export function ensureField(match: Match, context: MatchContext): MatchFieldState {
  if (match.field) return match.field;
  const energy = (side: Side): number => {
    let total = 0;
    let count = 0;
    for (const slot of match.lineups[side].starting) {
      const performance = match.performances[slot.playerId];
      if (!performance) continue;
      total += performance.energy;
      count += 1;
    }
    return count === 0 ? 100 : total / count;
  };
  const field: MatchFieldState = {
    ball: createBall(),
    homeShape: shapeFor(context, 'home', { inPossession: false, energy: energy('home'), urgency: 0 }),
    awayShape: shapeFor(context, 'away', { inPossession: false, energy: energy('away'), urgency: 0 }),
    pressure: { home: 0.5, away: 0.5 },
    phase: 'kickoff',
    counterPress: { home: 0, away: 0 },
  };
  match.field = field;
  return field;
}

export function shapeForSide(field: MatchFieldState, side: Side): TeamShape {
  return side === 'home' ? field.homeShape : field.awayShape;
}

export function setShape(field: MatchFieldState, side: Side, shape: TeamShape): void {
  if (side === 'home') field.homeShape = shape;
  else field.awayShape = shape;
}

/** Where the ball is, and who has it. Coordinates are the fixed frame. */
export function placeBall(field: MatchFieldState, side: Side | null, playerId: string | null, x: number, y: number): void {
  field.ball.possessionSide = side;
  field.ball.possessionPlayerId = playerId;
  field.ball.x = clamp(x, 0.01, 0.99);
  field.ball.y = clamp(y, 0.02, 0.98);
}

export function setPossession(field: MatchFieldState, side: Side | null, playerId: string | null): void {
  field.ball.possessionSide = side;
  field.ball.possessionPlayerId = playerId;
}

export function setPhase(field: MatchFieldState, phase: MatchPhase): void {
  field.phase = phase;
}

/** Everything a caller needs to know about the moment a decision is being made in. */
export interface TeamMoment {
  side: Side;
  opponent: Side;
  progress: number;
  zone: FieldZone;
  phase: MatchPhase;
  /** 0..1 how hard the defending side is pressing the ball. */
  pressure: number;
  inPossession: boolean;
}

export function momentFor(field: MatchFieldState, side: Side, playerPressure: number): TeamMoment {
  const opponent = otherSide(side);
  const zone = zoneOf(side, field.ball.x);
  return {
    side,
    opponent,
    progress: progressOf(side, field.ball.x),
    zone,
    phase: field.phase,
    pressure: clamp01(playerPressure),
    inPossession: field.ball.possessionSide === side,
  };
}
