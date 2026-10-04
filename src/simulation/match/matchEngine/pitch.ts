import type { PlayerId } from '@/domain/ids';
import type { BallNode, MatchEngineState, PlayerMatchState, Side } from './types';

/**
 * The geometry of the pitch, in the engine's fixed frame.
 *
 * The simulation always has the **home side attacking toward x = 1** and the away
 * side attacking toward x = 0, for the whole match. The flip at half time is a
 * presentation concern; the football does not care.
 */

/** The playing surface a player may move within, as fractions of the pitch. */
export const MIN_X = 0.015;
export const MAX_X = 0.985;
export const MIN_Y = 0.02;
export const MAX_Y = 0.98;

/** The goal mouth, as a fraction of the pitch across, centred on y = 0.5. */
export const GOAL_HALF_WIDTH = 0.055;
export const GOAL_LINE_HOME = 1;
export const GOAL_LINE_AWAY = 0;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampPitch(x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, MIN_X, MAX_X), y: clamp(y, MIN_Y, MAX_Y) };
}

/**
 * The squared distance between two points.
 *
 * Distance is asked for far more often as a *comparison* — is he nearer than the
 * last man, is he within a tackle, is he inside a radius — than as a value, and
 * a comparison never needs the square root. `distanceSq` is the hot path's
 * distance: exact, allocation-free, and a great deal cheaper than `Math.hypot`,
 * which is written to survive values this simulation never produces.
 */
export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Which way a side is attacking: +1 for home, -1 for away. */
export function attackDirection(side: Side): 1 | -1 {
  return side === 'home' ? 1 : -1;
}

/** The goal line a side is defending. */
export function ownGoalLine(side: Side): number {
  return side === 'home' ? 0 : 1;
}

/** The goal line a side is attacking. */
export function goalLine(side: Side): number {
  return side === 'home' ? 1 : 0;
}

/** Where the goal a side attacks stands, in the fixed frame. */
export function goalCentre(side: Side): { x: number; y: number } {
  return { x: goalLine(side), y: 0.5 };
}

/** The two posts of the goal a side attacks. */
export function goalPosts(side: Side): { x: number; near: number; far: number } {
  return { x: goalLine(side), near: 0.5 - GOAL_HALF_WIDTH, far: 0.5 + GOAL_HALF_WIDTH };
}

/** Where a side's own goal stands. */
export function ownGoalCentre(side: Side): { x: number; y: number } {
  return { x: ownGoalLine(side), y: 0.5 };
}

/**
 * Whether a point is inside the penalty area a side defends.
 *
 * Boxes are 18 yards deep and roughly 44 wide on a pitch drawn 1.0 by 0.63, so
 * in this frame the depth is ~0.16 and the width ~0.55.
 */
export function inOwnBox(side: Side, x: number, y: number): boolean {
  const near = side === 'home' ? x <= 0.16 : x >= 0.84;
  return near && y >= 0.225 && y <= 0.775;
}

/** The six yard box, dead in front of goal. */
export function inSixYardBox(side: Side, x: number, y: number): boolean {
  const near = side === 'home' ? x <= 0.06 : x >= 0.94;
  return near && y >= 0.33 && y <= 0.67;
}

/** The centre of the penalty spot a side defends. */
export function penaltySpot(side: Side): { x: number; y: number } {
  return { x: side === 'home' ? 0.12 : 0.88, y: 0.5 };
}

/**
 * Whether a ball that has crossed `x` has actually entered the goal.
 *
 * The goal is the mouth between the posts, on the goal line. A ball that has gone
 * past the line outside the posts has gone out for a goal kick, not in.
 */
export function hasScored(side: Side, x: number, y: number): boolean {
  if (side === 'home') return x >= GOAL_LINE_HOME && y > 0.5 - GOAL_HALF_WIDTH && y < 0.5 + GOAL_HALF_WIDTH;
  return x <= GOAL_LINE_AWAY && y > 0.5 - GOAL_HALF_WIDTH && y < 0.5 + GOAL_HALF_WIDTH;
}

/** Whether a point has left the pitch across a goal line or touchline. */
export function outOfPlay(x: number, y: number): boolean {
  return x <= 0 || x >= 1 || y <= 0 || y >= 1;
}

/** Progress a point has made from a side's own goal, 0..1. */
export function progressOf(side: Side, x: number): number {
  return side === 'home' ? x : 1 - x;
}

/** Turn progress back into a fixed-frame x. */
export function xFromProgress(side: Side, progress: number): number {
  return side === 'home' ? progress : 1 - progress;
}

/** The nearest player to a point, optionally excluding some ids. */
export function nearest(
  state: MatchEngineState,
  x: number,
  y: number,
  filter: (player: PlayerMatchState) => boolean,
): PlayerMatchState | null {
  let best: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.sentOff || !filter(player)) continue;
    const d = distanceSq(x, y, player.x, player.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }
  return best;
}

/** The player nearest the ball, excluding the man on it. */
export function nearestToBall(state: MatchEngineState, filter: (player: PlayerMatchState) => boolean): PlayerMatchState | null {
  return nearest(state, state.ball.x, state.ball.y, filter);
}

/**
 * The nearest player of one side to a point.
 *
 * A specialised `nearest`, without the per-player filter callback: the off-ball
 * layer asks this of both sides on every decision it takes, and a closure per
 * call is a small tax paid tens of thousands of times a match.
 */
export function nearestOfSide(state: MatchEngineState, side: Side, x: number, y: number): PlayerMatchState | null {
  let best: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.sentOff || player.side !== side) continue;
    const d = distanceSq(x, y, player.x, player.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }
  return best;
}

/** The nearest player of the side *not* given, to a point. */
export function nearestOpponent(state: MatchEngineState, side: Side, x: number, y: number): PlayerMatchState | null {
  let best: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.sentOff || player.side === side) continue;
    const d = distanceSq(x, y, player.x, player.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }
  return best;
}

/** Opponents within a radius of a point, nearest first. */
export function opponentsWithin(
  state: MatchEngineState,
  side: Side,
  x: number,
  y: number,
  radius: number,
): PlayerMatchState[] {
  const limit = radius * radius;
  const list: Array<{ player: PlayerMatchState; d: number }> = [];
  for (const player of state.players) {
    if (player.side === side || player.sentOff) continue;
    const d = distanceSq(x, y, player.x, player.y);
    if (d <= limit) list.push({ player, d });
  }
  return list.sort((a, b) => a.d - b.d).map((entry) => entry.player);
}

/**
 * How hard a point is being closed down, 0..1.
 *
 * Reads the distance of the nearest opponent and how fast he is coming toward
 * the point. It is a *reading* of the state, so it can be asked of any point at
 * any time without changing anything.
 */
export function pressureAt(state: MatchEngineState, x: number, y: number, side: Side): number {
  // Only the nearest opponent matters, so the loop keeps his *squared* distance
  // and takes the root once, rather than a root for every man looked at.
  let best = Infinity;
  for (const player of state.players) {
    if (player.sentOff || player.side === side) continue;
    const d = distanceSq(x, y, player.x, player.y);
    if (d < best) best = d;
  }
  if (!Number.isFinite(best)) return 0;
  // Under 0.04 of a pitch is right on top of him; beyond 0.22 is no pressure.
  const proximity = clamp((0.22 - Math.sqrt(best)) / 0.18, 0, 1);
  return proximity;
}

/** A player's top speed in pitch-lengths per simulation second. */
export function playerSpeed(player: PlayerMatchState, stamina: number): number {
  // Pace is carried on the node as a derived value; stamina scales it down late on.
  const legs = 0.82 + 0.18 * clamp(stamina / 100, 0, 1);
  return player.speed * legs;
}

/** The ball's speed for a given kind of delivery. */
export function ballSpeedFor(kind: 'pass' | 'through' | 'cross' | 'shot' | 'clear' | 'throw'): number {
  switch (kind) {
    case 'pass':
      return 0.42;
    case 'through':
      return 0.5;
    case 'cross':
      return 0.34;
    case 'shot':
      return 0.85;
    case 'clear':
      return 0.52;
    case 'throw':
      return 0.3;
  }
}

/** Where a travelling ball currently is, as a point. */
export function ballPoint(ball: BallNode): { x: number; y: number } {
  return { x: ball.x, y: ball.y };
}

/** A stable key for a player id, for maps that must not collide with object keys. */
export function playerKey(id: PlayerId): string {
  return id;
}
