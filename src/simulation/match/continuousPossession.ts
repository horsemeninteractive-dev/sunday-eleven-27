import type { PlayerId } from '@/domain/ids';
import type { PossessionPlan, PossessionStep } from '@/domain/matchState';
import type { Side } from './core';
import { isDelivery, isOnBall, type TimelineAction } from './actionTimeline';

/**
 * The empirical half of the continuous possession: the plan, and the numbers
 * that size it.
 *
 * The possession model decides a minute as a run of actions and records them as
 * {@link TimelineAction}s — who did what, from where to where, and what it came
 * to. This module turns that record into the *execution* plan the continuous
 * state follows: the same men, in the same order, with the geometry and the
 * durations the pitch needs, and no opinions of its own.
 *
 * It is deliberately free of the spatial layer. It asks for player positions
 * through {@link PlanGeometry} rather than reaching into a `MatchSpatial`, so it
 * can be built and tested without a football pitch around it — and so the
 * dependency only ever runs one way (the pitch imports this, not the other way
 * round).
 *
 * Nothing here decides anything. Every step's `outcome` was settled by the
 * possession model before this was called, and building or executing a plan can
 * never change it.
 */

/** How long a carry is given, matching the legacy passage so the two agree. */
export const CARRY_SECONDS = 1.2;
/** How far a pass travels per simulation second, in pitch-lengths. */
export const PASS_SPEED = 0.34;
/** A shot is struck harder than a pass. */
export const SHOT_SPEED = 0.72;
/** And the strike itself. */
export const SHOT_SECONDS = 1.3;

/**
 * How long a shield is held.
 *
 * Bounded, and that is the whole point of it. A hold is a real football action —
 * a man putting his body between the ball and a challenge — but it is not a way
 * to stop the clock, and an unbounded one turns into the dead patch of football
 * the rest of the movement system exists to remove.
 *
 * A shade over a second. Long enough to read as a man shielding the ball rather
 * than hesitating, short enough that the chain — and the ball — moves on. Set
 * against the 1.5s the movement test allows rather than by feel: a shield that
 * ran to 1.2s put the ball still for 1.73s once the step leading into it was
 * counted, which is over the line.
 */
export const HOLD_SECONDS = 1.1;

/** How long a hold step is given. */
function holdStepDuration(): number {
  return HOLD_SECONDS;
}

/**
 * The most steps of one chain that are executed.
 *
 * A move must fit inside the minute it belongs to, so only the finish and the
 * build-up that led to it are played: the same ceiling the legacy passage used,
 * so the pitch and the words stay in step.
 */
const MAX_PLAN_STEPS = 4;

/**
 * How far a pass may be led ahead of the man it is aimed at.
 *
 * A pass played into the space a player is moving into is how football actually
 * works, and it is what gives the receiver something to run onto — without the
 * ball being aimed so far from him that the possession change has to jump. The
 * lead comes from the receiver's own simulated target, and is capped here so it
 * stays a pass to a man rather than a ball to nobody.
 */
const LEAD_MAX = 0.06;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A point on the pitch, in the fixed frame. */
export interface PitchPoint {
  x: number;
  y: number;
}

/**
 * Where the plan's players are, as the builder needs them.
 *
 * A small seam rather than a dependency: the plan is built from positions, and
 * positions live on the pitch, but the builder must not know about the pitch.
 */
export interface PlanGeometry {
  /** Where a player now stands, or undefined if he is not out there. */
  pointOf(playerId: PlayerId): PitchPoint | undefined;
  /** Where a player is heading, so a pass can be led into his run. */
  targetOf(playerId: PlayerId): PitchPoint | undefined;
  /** Whether a player is on the pitch at all. */
  onPitch(playerId: PlayerId | null | undefined): boolean;
}

/** How long a pass between two places is given, from the ground it must cover. */
export function passSeconds(from: PitchPoint, to: PitchPoint): number {
  return clamp(Math.hypot(from.x - to.x, from.y - to.y) / PASS_SPEED, 0.6, 1.4);
}

/**
 * Turn the possession model's decisions into the chain the pitch executes.
 *
 * The mapping is the same one the legacy passage made, so the move is the move
 * the model played and not a reconstruction: deliveries become passes to the man
 * they named, anything on the ball becomes a carry, and a shot is struck at the
 * goal the side is attacking. A move that names nobody on the pitch has nothing
 * to play, and returns null.
 */
export function buildPossessionPlan(
  side: Side,
  actions: readonly TimelineAction[],
  geometry: PlanGeometry,
): PossessionPlan | null {
  const steps: PossessionStep[] = [];

  for (const action of actions) {
    // A shield immediately after a shield is one long pause, not two.
    //
    // The decision model will decide to hold, end the possession, and decide to
    // hold again on the next one if nothing has changed — and each hold is
    // bounded on its own, so nothing objects while the ball stands still for the
    // length of both. Dropping the second leaves one shield, which is a football
    // action, instead of two in a row, which is a gap in the match.
    if (action.kind === 'hold' && steps.length > 0 && steps[steps.length - 1]!.kind === 'hold') continue;
    const playerId = action.playerId;
    if (!playerId || !geometry.onPitch(playerId)) continue;

    if (action.kind === 'hold') {
      // A hold is a step like any other: the carrier keeps the ball and stands
      // still, and the chain waits him out. It used to be a gap in the chain —
      // seconds consumed by the decision model with nothing on the pitch to show
      // for it — which is exactly how a dead patch of football gets into the
      // middle of a move.
      const node = geometry.pointOf(playerId);
      steps.push({
        kind: 'hold',
        playerId,
        targetPlayerId: null,
        fromX: node?.x ?? action.fromX,
        fromY: node?.y ?? action.fromY,
        toX: node?.x ?? action.fromX,
        toY: node?.y ?? action.fromY,
        duration: holdStepDuration(),
        outcome: action.outcome,
      });
      continue;
    }

    if (action.kind === 'shot') {
      const from = geometry.pointOf(playerId) ?? { x: action.fromX, y: action.fromY };
      steps.push({
        kind: 'shot',
        playerId,
        targetPlayerId: null,
        fromX: from.x,
        fromY: from.y,
        toX: side === 'home' ? 0.995 : 0.005,
        toY: clamp(0.5 + (from.y - 0.5) * 0.35, 0.15, 0.85),
        duration: SHOT_SECONDS,
        outcome: action.outcome,
      });
      continue;
    }

    // A ball played to a named teammate — and not back to himself, which a
    // clearance sometimes looks like — is a pass.
    if (
      isDelivery(action.kind) &&
      action.targetPlayerId &&
      action.targetPlayerId !== playerId &&
      geometry.onPitch(action.targetPlayerId)
    ) {
      const from = geometry.pointOf(playerId) ?? { x: action.fromX, y: action.fromY };
      const to = geometry.pointOf(action.targetPlayerId) ?? { x: action.toX, y: action.toY };
      // Led into his run when he is moving somewhere, so the receiver has a ball
      // to go onto; otherwise aimed at his feet. The lead is bounded, so the
      // change of possession never has to jump to reach him.
      const heading = geometry.targetOf(action.targetPlayerId);
      const aim =
        heading && Math.hypot(heading.x - to.x, heading.y - to.y) <= LEAD_MAX ? heading : to;
      steps.push({
        kind: 'pass',
        playerId,
        targetPlayerId: action.targetPlayerId,
        fromX: from.x,
        fromY: from.y,
        toX: aim.x,
        toY: aim.y,
        duration: passSeconds(from, to),
        outcome: action.outcome,
      });
      continue;
    }

    // A delivery that names nobody is still a delivery, and this is where set
    // pieces come from.
    //
    // A corner is crossed into the box and the model decided who won the header
    // separately — it does not name a man to cross to, because the whole point
    // of a cross is that it is aimed at a *place* and contested. Dropping it here
    // left the cross with nothing to play: the corner's own chain had no step for
    // it, so the ball sat on the flag until the step after the last one, and the
    // cross was never struck at all.
    if (isDelivery(action.kind)) {
      const from = geometry.pointOf(playerId) ?? { x: action.fromX, y: action.fromY };
      steps.push({
        kind: 'pass',
        playerId,
        // Nobody is named, so the ball is aimed at the place and finds whoever is
        // standing there — which is how a cross into a box is contested.
        targetPlayerId: null,
        fromX: from.x,
        fromY: from.y,
        toX: action.toX,
        toY: action.toY,
        duration: action.duration,
        outcome: action.outcome,
      });
      continue;
    }

    if (isOnBall(action.kind) || action.kind === 'cross' || action.kind === 'clear') {
      steps.push({
        kind: 'carry',
        playerId,
        targetPlayerId: null,
        fromX: action.fromX,
        fromY: action.fromY,
        toX: action.toX,
        toY: action.toY,
        duration: CARRY_SECONDS,
        outcome: action.outcome,
      });
    }
  }

  if (steps.length === 0) return null;
  return { side, steps: steps.slice(-MAX_PLAN_STEPS), index: 0 };
}

/** The step being played out (or about to be), or null when the chain is done. */
export function currentStep(plan: PossessionPlan | null | undefined): PossessionStep | null {
  if (!plan) return null;
  return plan.steps[plan.index] ?? null;
}
