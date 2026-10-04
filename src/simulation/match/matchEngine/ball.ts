import type { MatchEngineState, ShotOutcome, Side } from './types';

/**
 * Giving the ball, and striking it.
 *
 * These are the two things that can happen to the ball: it is at somebody's
 * feet, or it is not. A pass does not transfer possession — it launches the ball
 * and lets the football decide who gets it. That distinction is the whole reason
 * the ball is a first-class object rather than an implication of the last event.
 */

export type BallKind = 'pass' | 'through' | 'cross' | 'shot' | 'clear' | 'throw';

/** Put the ball at a player's feet, and give his side possession. */
export function giveBallTo(state: MatchEngineState, playerId: string): void {
  const player = state.players.find((entry) => entry.playerId === playerId);
  if (!player || player.sentOff) return;
  const ball = state.ball;
  ball.status = 'controlled';
  ball.ownerId = playerId;
  ball.targetId = playerId;
  ball.x = player.x;
  ball.y = player.y;
  ball.tx = player.x;
  ball.ty = player.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.height = 0;
  ball.vz = 0;
  ball.speed = 0;
  ball.kind = null;
  ball.attempted = [];
  ball.shotOutcome = null;
  ball.offsidePlayerId = null;
  ball.penaltyShot = false;
  ball.intendedSide = player.side;
  ball.lastTouchId = playerId;
  ball.touchedAt = state.clock;
  state.possession = player.side;
  for (const entry of state.players) entry.possession = entry.playerId === playerId;
}

/**
 * Release the ball from whoever held it, without giving it to anybody.
 *
 * Used when a ball is knocked loose, deflected, or won in a tackle and nobody
 * has it yet. `state.possession` becomes null: nobody is in possession until
 * somebody controls it.
 */
export function releaseBall(state: MatchEngineState, x: number, y: number, vx: number, vy: number, lastTouchId: string | null): void {
  const ball = state.ball;
  ball.status = 'loose';
  ball.ownerId = null;
  ball.targetId = null;
  ball.intendedSide = null;
  ball.kind = null;
  ball.attempted = [];
  ball.x = x;
  ball.y = y;
  ball.tx = x;
  ball.ty = y;
  ball.vx = vx;
  ball.vy = vy;
  ball.speed = Math.hypot(vx, vy);
  ball.shotOutcome = null;
  ball.offsidePlayerId = null;
  ball.penaltyShot = false;
  ball.lastTouchId = lastTouchId;
  ball.touchedAt = state.clock;
  state.possession = null;
  for (const entry of state.players) entry.possession = false;
}

/**
 * Strike the ball.
 *
 * The ball is sent toward a point at the speed its kind of delivery travels, and
 * from that moment it is nobody's. Whether it arrives, is intercepted, is met in
 * the air, or leaves the pitch is settled by the resolution rules as it moves.
 */
export function strikeBall(
  state: MatchEngineState,
  options: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    kind: BallKind;
    speed: number;
    targetId: string | null;
    intendedSide: Side;
    loft: boolean;
    /** Who struck it, for `lastTouchId`. */
    playerId: string | null;
    /** How the shot is meant to come out, when this strike is a shot. */
    shotOutcome?: ShotOutcome | null;
    /** Whether this strike is the kick from a penalty. */
    penaltyShot?: boolean;
    /**
     * An attacker left in an offside position by this pass, if any. The law is
     * judged at the moment the ball is played, which is this instant.
     */
    offsidePlayerId?: string | null;
  },
): void {
  const ball = state.ball;
  const dx = options.to.x - options.from.x;
  const dy = options.to.y - options.from.y;
  const length = Math.hypot(dx, dy) || 1e-6;
  ball.status = 'travelling';
  ball.ownerId = null;
  ball.targetId = options.targetId;
  ball.intendedSide = options.intendedSide;
  ball.kind = options.kind;
  ball.attempted = [];
  ball.x = options.from.x;
  ball.y = options.from.y;
  ball.tx = options.to.x;
  ball.ty = options.to.y;
  ball.vx = (dx / length) * options.speed;
  ball.vy = (dy / length) * options.speed;
  ball.speed = options.speed;
  ball.height = 0;
  ball.vz = options.loft ? 0.55 : 0;
  ball.shotOutcome = options.shotOutcome ?? null;
  ball.offsidePlayerId = options.offsidePlayerId ?? null;
  ball.penaltyShot = options.penaltyShot ?? false;
  ball.lastTouchId = options.playerId;
  ball.touchedAt = state.clock;
  state.possession = null;
  for (const entry of state.players) entry.possession = false;
}

/** A travelling ball's remaining distance to its aim point. */
export function toArrival(state: MatchEngineState): number {
  const ball = state.ball;
  return Math.hypot(ball.tx - ball.x, ball.ty - ball.y);
}
