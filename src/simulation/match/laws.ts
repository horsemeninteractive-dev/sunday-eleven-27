import type { Rng } from '../rng';
import { otherSide, type Side } from './core';
import { clamp, clampPitch, goalLine, MAX_Y, MIN_Y, ownGoalLine, penaltySpot } from './matchEngine/pitch';
import type { SetPieceKind } from './matchEngine/types';

/**
 * The laws of the game, stated once.
 *
 * Touchline is one football played at two resolutions: the detailed one
 * (`matchEngine/`, a manager's own fixture) and the abstract one (`fastMatch/`,
 * the other forty fixtures). They are allowed to *measure* differently — one
 * settles a shot physically from where the shooter is standing, the other rolls
 * for it, and their numbers therefore live apart in `FAST_CALIBRATION` — but they
 * are not allowed to disagree about what the football *is*: which restarts exist,
 * how long each is given, where each is placed, who takes it, and what a strike
 * from it is worth; and what a foul becomes.
 *
 * That knowledge used to be duplicated. The abstract resolution knew only that
 * penalties existed; the detailed one kept the rest private inside
 * `matchEngine/setPieces.ts` and `matchEngine/resolve.ts`. It is written here now,
 * so both resolutions call the same law and the only thing between them is the
 * calibration.
 *
 * This module holds **no state and no football of its own**: every function is a
 * pure reading of the laws. See `TOUCHLINE_ARCHITECTURE.md` § "Set pieces" and
 * § "Fast simulation".
 */

// ---------------------------------------------------------------------------
// The restarts
// ---------------------------------------------------------------------------

/** The dead balls a match can be restarted from. */
export type RestartKind = SetPieceKind;

/** Every restart, in the order the laws list them. */
export const RESTART_KINDS: readonly RestartKind[] = [
  'kickoff',
  'throw-in',
  'goal-kick',
  'corner',
  'free-kick',
  'penalty',
];

/**
 * How long each kind of dead ball is given to arrange, in football seconds.
 *
 * A kick-off takes longer than it looks: at the restart both sides are often
 * still up the pitch from the last attack, and they have to walk back into their
 * own half and out of the centre circle before the ball may be played.
 */
export const RESTART_SETUP_SECONDS: Record<RestartKind, number> = {
  kickoff: 6,
  'throw-in': 2,
  'goal-kick': 4,
  corner: 6,
  'free-kick': 5,
  penalty: 6,
};

/**
 * The touchline: where a ball that is on the line actually sits.
 *
 * A throw-in is taken from the line and a corner from the corner flag, and both
 * are the *edge* of the playable pitch rather than a spot a shade inside it —
 * which is also where the engine clamps a player, so a thrower standing over the
 * ball is standing on the line he is allowed to touch and no further.
 *
 * The retired spatial state kept its own copy of this geometry (`TOUCHLINE_Y`,
 * twelve thousandths in from the edge) and placed its throw-ins by it, a fraction
 * adrift from the way the engine clamps a man. The line is named here now, once,
 * and every resolution places a dead ball by it.
 */
export const TOUCHLINE = { near: MIN_Y, far: MAX_Y } as const;

/**
 * The spot a dead ball is placed on, given where the ball left play.
 *
 * Both resolutions place a restart here; neither is free to invent a geometry of
 * its own.
 */
export function restartSpotFor(
  kind: RestartKind,
  side: Side,
  ball: { x: number; y: number },
): { x: number; y: number } {
  switch (kind) {
    case 'kickoff':
      return { x: 0.5, y: 0.5 };
    case 'throw-in': {
      const x = clamp(ball.x, 0.06, 0.94);
      const y = ball.y <= 0.5 ? TOUCHLINE.near : TOUCHLINE.far;
      return { x, y };
    }
    case 'goal-kick': {
      const x = ownGoalLine(side) + (side === 'home' ? 0.055 : -0.055);
      return { x, y: 0.5 };
    }
    case 'corner': {
      const x = goalLine(side);
      const y = ball.y <= 0.5 ? TOUCHLINE.near : TOUCHLINE.far;
      return { x, y };
    }
    case 'free-kick':
      return clampPitch(ball.x, ball.y);
    case 'penalty':
      return penaltySpot(otherSide(side));
  }
}

/**
 * Who takes a restart.
 *
 * The laws of the game rather than a resolution's opinion: a goal kick is the
 * keeper's, a penalty is the side's nominated taker if it named one, and
 * everything else is taken by whoever is nearest to the ball. A resolution
 * decides only *how* it reads "nearest" and "best available".
 */
export type RestartTakerRule = 'keeper' | 'nearest' | 'nominated-or-best-available';

export const RESTART_TAKER: Record<RestartKind, RestartTakerRule> = {
  kickoff: 'nearest',
  'throw-in': 'nearest',
  'goal-kick': 'keeper',
  corner: 'nearest',
  'free-kick': 'nearest',
  penalty: 'nominated-or-best-available',
};

/**
 * Who steps up to a penalty: the nominated taker, or the best available man.
 *
 * Both resolutions obey this, and it used to be obeyed by only one of them: the
 * abstract resolution read the side's `setPieceRoutines.penaltyTakerId` while the
 * detailed engine gave the ball to its most advanced outfielder and left the
 * manager's nomination on the tactics screen. Naming a penalty taker is an
 * instruction, so the instruction is honoured here, once; the two resolutions
 * differ only in who they judge "best available" to be, which is a reading of
 * their own state and stays with them.
 */
export function penaltyTaker<T>(nominated: T | undefined, bestAvailable: () => T | undefined): T | undefined {
  return nominated ?? bestAvailable();
}

// ---------------------------------------------------------------------------
// The strike
// ---------------------------------------------------------------------------

/** How a strike at goal can come out. Every one of these is a `ShotOutcome`. */
export const STRIKE_OUTCOMES = ['goal', 'saved', 'wide', 'over'] as const;

export type StrikeOutcome = (typeof STRIKE_OUTCOMES)[number];

/** One rung of a strike ladder: what it is, and the share of strikes that are it. */
export type StrikeRung = readonly [StrikeOutcome, number];

/**
 * What a restart struck directly at goal is worth.
 *
 * Written as a ladder of shares — "this much of it is that" — rather than as
 * thresholds, because that is how a manager would state the law, and because a
 * ladder read top to bottom is the order the strike is judged in.
 *
 * A direct free kick is a shot like any other — usually kept out, sometimes
 * beaten, sometimes off target. A penalty is struck from twelve yards with only
 * the keeper to beat, which is why its ladder is so much steeper; it is walked
 * from what can go wrong, in the order the football has always read it in. No
 * restart is modelled as charged down: a wall is part of the delivery's aim, not
 * an outcome of its own.
 */
export const RESTART_STRIKES: Record<'free-kick' | 'penalty', readonly StrikeRung[]> = {
  'free-kick': [
    ['goal', 0.12],
    ['saved', 0.55],
    ['wide', 0.2],
    ['over', 0.13],
  ],
  penalty: [
    ['wide', 0.1],
    ['saved', 0.2],
    ['goal', 0.7],
  ],
};

/**
 * Walk a strike ladder with one roll in [0, 1).
 *
 * The roll is the caller's — both resolutions draw from their own generator, so
 * the randomness stays where the football is decided.
 */
export function strikeOutcome(ladder: readonly StrikeRung[], roll: number): StrikeOutcome {
  let edge = 0;
  for (const [outcome, share] of ladder) {
    edge += share;
    if (roll < edge) return outcome;
  }
  return 'over';
}

// ---------------------------------------------------------------------------
// The challenge
// ---------------------------------------------------------------------------

/**
 * What the referee did about a foul.
 *
 * `second-yellow` and `straight-red` both mean the man is off; they are different
 * entries because the record and the statistics keep them apart, and because a
 * second booking is not a red card in a player's career figures.
 */
export type CardDecision = 'none' | 'yellow' | 'second-yellow' | 'straight-red';

/**
 * The referee's chances for one foul, as each resolution judges them.
 *
 * The chances themselves are a resolution's own business — a watched match knows
 * the offender's state, a background one knows the minute's shape — so they are
 * passed in, and only the ladder below is shared.
 */
export interface CardChances {
  /** The chance this challenge is a straight red, before anything else. */
  straightRed: number;
  /** The chance it is a booking — which, on a booked man, is the second booking. */
  yellow: number;
  /**
   * The chance a booking on a booked man *is* the second booking.
   *
   * `1` is the law, and the detailed resolution passes `1`: a booked man who is
   * booked again is off. The abstract resolution passes its own calibrated share
   * instead, because at its foul rate the law sent men off several times more
   * often than a watched match does. That calibration is deliberate, and this is
   * now the one visible place where the two disagree.
   */
  secondYellowShare: number;
}

/**
 * Judge one foul.
 *
 * A straight red is its own event, not a worse booking: it is decided first, so
 * it cannot be swallowed by the yellow that would otherwise have followed.
 *
 * The `secondYellowShare >= 1` short-circuit is not an optimisation. It keeps the
 * law's automatic dismissal from spending a random draw, so the detailed
 * resolution's football is bit for bit what it was before this rule was shared —
 * which is what makes sharing it a refactor rather than a recalibration.
 */
export function cardForFoul(rng: Rng, chances: CardChances, booked: boolean): CardDecision {
  if (rng.chance(chances.straightRed)) return 'straight-red';
  if (!rng.chance(chances.yellow)) return 'none';
  if (!booked) return 'yellow';
  if (chances.secondYellowShare >= 1) return 'second-yellow';
  return rng.chance(chances.secondYellowShare) ? 'second-yellow' : 'none';
}

// ---------------------------------------------------------------------------
// The changes
// ---------------------------------------------------------------------------

/**
 * The most changes a side may make in a match.
 *
 * The game's ceiling rather than a competition's, stated once because both
 * resolutions carry it and because they used to carry it in two different ways:
 * the abstract resolution capped the competition's allowance at its own constant
 * while the detailed engine took the environment's number as final. Every
 * competition allows three today, so this is exactly what both already did — but
 * it is now one number in one place, and a competition allowed five changes the
 * day it exists will change it here, not in two files that have to be found.
 */
export const CHANGES_PER_MATCH = 3;

/** The changes a side may actually make: the competition's allowance, capped. */
export function changesAllowed(competitionAllowance: number): number {
  return Math.max(0, Math.min(CHANGES_PER_MATCH, competitionAllowance));
}
