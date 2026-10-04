import { advanceMovement } from '../state';
import { clamp, MAX_X, MAX_Y, MIN_X, MIN_Y } from './pitch';
import { playerOf } from './state';
import type { MatchEngineState } from './types';

/**
 * Moving the match forward one step.
 *
 * Nothing here decides anything. It takes the targets the decision layer has
 * already chosen and integrates them: players run with legs and momentum, the
 * ball travels at whatever speed it was struck and slowed by the ground. This is
 * the only place a position changes, which is what makes "nobody teleports" a
 * property of one file rather than a hope held across ten.
 *
 * It is also the only place `px/py` — the position the renderer interpolates
 * from — is advanced. Any phase that skips movement must therefore settle them
 * (`settleMovement`), or the picture keeps lerping across a step that never ran.
 */

/** Gravity for a lofted ball, in height-units per second squared. */
const GRAVITY = 1.4;
/** How quickly a loose ball on the deck is slowed by the grass. */
const GROUND_FRICTION = 1.9;
/** How far inside the flag the corner run ends, so a man stops on the grass. */
const CELEBRATION_CORNER_MARGIN = 0.05;
/** How far from the scorer his teammates gather, in pitch fractions. */
const CELEBRATION_HUDDLE_RADIUS = 0.05;

/**
 * Advance every player one step toward his target.
 *
 * A player's top speed is scaled by his remaining legs, so a tired man is
 * genuinely slower and a fresh one is not — and that scale is written onto the
 * node's `speed` only for the duration of this step, from the `baseSpeed` he
 * started with.
 */
export function stepPlayers(state: MatchEngineState, dt: number): void {
  for (const player of state.players) {
    if (player.sentOff) continue;
    const legs = 0.84 + 0.16 * clamp(player.stamina / 100, 0, 1);
    player.speed = player.baseSpeed * legs;
    player.px = player.x;
    player.py = player.y;
    // A man who has settled — standing on his mark, not moving — is a fixed
    // point of the movement rules: integrating him would recompute his velocity
    // as zero and leave his position untouched. Skipping that is the same result
    // for a fraction of the work, and it is the settled shape, late in a move,
    // where most of a side's players are.
    if (player.tx === player.x && player.ty === player.y && player.vx === 0 && player.vy === 0) continue;
    advanceMovement(player, dt, state.clock);
  }
}

/**
 * Advance the ball one step.
 *
 * A controlled ball is at its owner's feet; a travelling ball is on its way; a
 * loose ball rolls and slows. Arrival, control, interception and the ball
 * leaving play are all decided by the resolution rules — this only moves it.
 */
export function stepBall(state: MatchEngineState, dt: number): void {
  const ball = state.ball;
  ball.px = ball.x;
  ball.py = ball.y;

  if (ball.status === 'out-of-play') return;

  if (ball.status === 'controlled') {
    const owner = playerOf(state, ball.ownerId);
    if (owner) {
      ball.x = owner.x;
      ball.y = owner.y;
      ball.tx = owner.x;
      ball.ty = owner.y;
      ball.vx = 0;
      ball.vy = 0;
      ball.height = 0;
      ball.vz = 0;
    } else {
      ball.status = 'loose';
      ball.ownerId = null;
    }
    return;
  }

  ball.x = clamp(ball.x + ball.vx * dt, -0.04, 1.04);
  ball.y = clamp(ball.y + ball.vy * dt, -0.04, 1.04);

  if (ball.height > 0 || ball.vz > 0) {
    ball.height = Math.max(0, ball.height + ball.vz * dt);
    ball.vz -= GRAVITY * dt;
    if (ball.height <= 0) {
      ball.height = 0;
      ball.vz = 0;
    }
  }

  if (ball.status === 'travelling' && ball.height <= 0 && ball.vx * ball.vx + ball.vy * ball.vy < 0.02 * 0.02) {
    // A ball that has stopped on its own is simply loose.
    ball.status = 'loose';
    ball.targetId = null;
    ball.intendedSide = null;
  }

  // A ball does not sail through its own destination. Once it is past the point
  // it was aimed at — the dot product of the way it is going with the way its
  // target now lies is negative — it drops and becomes loose there. Without
  // this, a cross aimed at the six-yard line carried on into the net, and a
  // goal could be scored by a ball nobody had shot.
  if (ball.status === 'travelling') {
    const toAimX = ball.tx - ball.x;
    const toAimY = ball.ty - ball.y;
    if (toAimX * ball.vx + toAimY * ball.vy < 0) {
      // It keeps its pace — it is on the grass now, not in flight — so a ball
      // that would have rolled out still rolls out, and a cross that drops into
      // the area is a scramble rather than a gift.
      ball.status = 'loose';
      ball.vx *= 0.5;
      ball.vy *= 0.5;
      ball.targetId = null;
      ball.intendedSide = null;
    }
  }

  if (ball.status === 'loose') {
    const decay = Math.max(0, 1 - GROUND_FRICTION * dt);
    ball.vx *= decay;
    ball.vy *= decay;
    if (ball.vx * ball.vx + ball.vy * ball.vy < 1e-8) {
      ball.vx = 0;
      ball.vy = 0;
    }
  }

  // A travelling ball's speed reading, for consumers that want it.
  if (ball.status === 'travelling') ball.speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

  // Keep the reading honest: the pitch is not infinite.
  ball.x = clamp(ball.x, MIN_X - 0.04, MAX_X + 0.04);
  ball.y = clamp(ball.y, MIN_Y - 0.04, MAX_Y + 0.04);
}

/** Advance players and ball by one fixed step. */
export function stepMovement(state: MatchEngineState, dt: number): void {
  stepPlayers(state, dt);
  stepBall(state, dt);
}

/**
 * The celebration after a goal.
 *
 * The goal hold used to be a still picture: the football had stopped and so had
 * everybody in it, while the dots on the pitch pulsed. This is what makes the
 * seconds after a goal real movement instead — the scorer runs for the corner
 * nearest where the ball crossed the line, and his teammates set off after him.
 * The side that conceded simply stands, waiting to restart.
 *
 * It changes no football: the targets are pure geometry (no randomness), and
 * the kick-off that follows rearranges every man anyway. The ball is out of play
 * during the hold, so `stepBall` leaves it exactly where it crossed the line,
 * resting in the net.
 */
export function celebrateGoal(state: MatchEngineState, dt: number): void {
  const celebration = state.celebration;
  if (!celebration) {
    // No goal to stage — behave exactly as the other held phases do.
    settleMovement(state);
    return;
  }

  const ball = state.ball;
  const scorer = playerOf(state, celebration.scorerId);
  // Where the huddle forms: around the scorer, or around the ball if the goal
  // was an own goal and nobody on this side put it in.
  const focusX = scorer ? scorer.x : ball.x;
  const focusY = scorer ? scorer.y : ball.y;
  const cornerX = ball.x < 0.5 ? CELEBRATION_CORNER_MARGIN : 1 - CELEBRATION_CORNER_MARGIN;
  const cornerY = ball.y < 0.5 ? CELEBRATION_CORNER_MARGIN : 1 - CELEBRATION_CORNER_MARGIN;

  for (const player of state.players) {
    if (player.sentOff) continue;
    if (player.side !== celebration.side) {
      // The conceding side holds its ground for the restart.
      player.tx = player.x;
      player.ty = player.y;
      continue;
    }
    if (scorer && player === scorer) {
      player.tx = cornerX;
      player.ty = cornerY;
      continue;
    }
    // Everyone else races to mob the scorer, spread around him in a ring so
    // twenty-two men do not converge onto a single dot.
    const angle = (player.slotIndex / 11) * Math.PI * 2;
    player.tx = clamp(focusX + Math.cos(angle) * CELEBRATION_HUDDLE_RADIUS, MIN_X, MAX_X);
    player.ty = clamp(focusY + Math.sin(angle) * CELEBRATION_HUDDLE_RADIUS, MIN_Y, MAX_Y);
  }

  stepMovement(state, dt);
}

/**
 * Collapse the drawn positions onto the real ones while nothing is moving.
 *
 * A phase that does not step the movement — the last step of the goal hold as
 * the kick-off is arranged, the interval, the final whistle — would otherwise
 * leave every `px/py` frozen where the last movement step put it, while `x/y`
 * had moved on (the ball, in particular, is placed for the restart). A renderer interpolating between the two then slides
 * the ball and every player back and forth across that gap as its `alpha`
 * cycles each step — the ball bouncing between the goal line and the centre
 * spot, the players twitching, that people see after a goal. Saying plainly
 * that nothing moved this step is what removes it: there is nothing to
 * interpolate, so the picture is still.
 */
export function settleMovement(state: MatchEngineState): void {
  const ball = state.ball;
  ball.px = ball.x;
  ball.py = ball.y;
  for (const player of state.players) {
    player.px = player.x;
    player.py = player.y;
  }
}

/** Interpolate a player's drawn position between his previous and current spot. */
export function interpolate(px: number, py: number, x: number, y: number, alpha: number): { x: number; y: number } {
  const t = clamp(alpha, 0, 1);
  return { x: px + (x - px) * t, y: py + (y - py) * t };
}
