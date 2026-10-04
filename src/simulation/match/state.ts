import type { PlayerId } from '@/domain/ids';
import type {
  ActionOutcome,
  MatchAction,
  MatchActionKind,
  MatchState,
  PlayerState,
} from '@/domain/matchState';

/**
 * The rules that advance the authoritative continuous match state.
 *
 * Two things live here, and both are deliberately pure and deterministic:
 *
 * 1. **Simulation time.** The match advances in fixed steps of
 *    {@link SIMULATION_STEP_SECONDS} of football, whatever the frame rate and
 *    whatever the presentation speed. Real time is converted into whole steps
 *    and a carried remainder; the remainder never affects an outcome, it only
 *    lets a renderer interpolate between the step a thing was at and the step it
 *    is at. This is the separation the architecture needs — simulation time,
 *    rendering frequency and match presentation speed are three different
 *    clocks, and only the first one plays football.
 *
 * 2. **Timed actions.** An action begins at a simulation time, is given a
 *    duration, and resolves when it has done what it set out to do. `active` is
 *    the only state the continuous field carries; resolution is reported through
 *    the action's own `status`/`outcome` before it leaves the list.
 *
 * Nothing here reads a random stream, a player attribute or a tactic, so nothing
 * here can change what happens on the pitch. It moves the clock and it files the
 * paperwork.
 */

/** The fixed slice of football one simulation step is worth. */
export const SIMULATION_STEP_SECONDS = 1 / 30;

export interface SimulationStepPlan {
  /** How many whole steps of football to take. */
  steps: number;
  /** How much simulation time those steps are worth. */
  spent: number;
}

export interface SimulationStepOptions {
  /**
   * The most real time a single call may spend. A tab returning from the
   * background can hand over a huge delta; a match resumes where it was rather
   * than replaying minutes nobody watched.
   */
  maxCatchUpSeconds?: number;
  /** A hard ceiling on steps per call, so a pathological delta cannot hang. */
  maxSteps?: number;
}

/**
 * Convert real time into whole steps of football.
 *
 * The state's carriage is spent a fixed step at a time, so the same span of
 * football takes the same number of steps whether it arrived as one frame or a
 * hundred. That is the determinism guarantee: outcomes depend on the sequence of
 * steps, never on how often the browser happened to draw.
 *
 * This plans the steps and spends the carriage; it does not take them, because a
 * step also moves players and the ball, and that is `stepSpatial`'s job. Keeping
 * the arithmetic here means it can be tested without a football pitch.
 */
export function advanceSimulationSteps(
  state: Pick<MatchState, 'stepSeconds' | 'residual'>,
  deltaSeconds: number,
  options: SimulationStepOptions = {},
): SimulationStepPlan {
  if (!(deltaSeconds > 0)) return { steps: 0, spent: 0 };

  const step = state.stepSeconds > 0 ? state.stepSeconds : SIMULATION_STEP_SECONDS;
  const ceiling = options.maxCatchUpSeconds ?? deltaSeconds;
  const maxSteps = options.maxSteps ?? Math.ceil(Math.min(deltaSeconds, ceiling) / step) + 1;

  state.residual += Math.min(deltaSeconds, ceiling);

  let steps = 0;
  while (state.residual >= step && steps < maxSteps) {
    state.residual -= step;
    steps += 1;
  }

  return { steps, spent: steps * step };
}

/**
 * How far into the next step the simulation has got, 0..1.
 *
 * A renderer draws between `px/py` and `x/y` by this fraction, so movement is
 * smooth without the simulation having to run per frame.
 */
export function simulationAlpha(state: Pick<MatchState, 'stepSeconds' | 'residual'>): number {
  const step = state.stepSeconds > 0 ? state.stepSeconds : SIMULATION_STEP_SECONDS;
  return Math.max(0, Math.min(1, state.residual / step));
}

/** The player state for an id, if he is on the pitch. */
export function playerStateOf(state: MatchState, playerId: PlayerId | null | undefined): PlayerState | undefined {
  if (!playerId) return undefined;
  return state.players.find((player) => player.playerId === playerId);
}

/** The active action a player is playing out, if any. */
export function activeActionOf(state: MatchState, playerId: PlayerId): MatchAction | undefined {
  return state.actions.find((action) => action.playerId === playerId);
}

/** A stable, collision-free id, derived from the action rather than a counter. */
function actionIdFor(state: MatchState, kind: MatchActionKind, playerId: PlayerId | null, startedAt: number): string {
  const base = `${kind}:${playerId ?? 'ball'}:${startedAt.toFixed(3)}`;
  let id = base;
  let suffix = 1;
  while (state.actions.some((action) => action.id === id)) {
    id = `${base}#${suffix}`;
    suffix += 1;
  }
  return id;
}

/**
 * Start an action at the current simulation time.
 *
 * The only kind of action the present simulation produces is one the passage
 * already planned — carry, pass or shot — but the contract accepts any of the
 * action vocabulary, so the rest can be added without a new representation.
 */
export function beginAction(
  state: MatchState,
  spec: {
    kind: MatchActionKind;
    playerId?: PlayerId | null;
    targetPlayerId?: PlayerId | null;
    duration: number;
  },
): MatchAction {
  const startedAt = state.clock;
  const playerId = spec.playerId ?? null;
  const action: MatchAction = {
    id: actionIdFor(state, spec.kind, playerId, startedAt),
    kind: spec.kind,
    playerId,
    targetPlayerId: spec.targetPlayerId ?? null,
    startedAt,
    duration: Math.max(0, spec.duration),
    status: 'active',
    outcome: null,
  };
  state.actions.push(action);
  syncPlayerActions(state);
  return action;
}

/** How far an action has run, 0..1, at a given simulation time. */
export function actionProgress(action: MatchAction, clock: number): number {
  if (action.duration <= 0) return 1;
  return Math.max(0, Math.min(1, (clock - action.startedAt) / action.duration));
}

/** Whether an action's time is up. */
export function actionIsDue(action: MatchAction, clock: number): boolean {
  return clock >= action.startedAt + action.duration;
}

/**
 * End an action, recording what it came to.
 *
 * Resolution is reported first — so a caller can read the outcome — and the
 * action then leaves the active list, because `actions` describes what is
 * happening now.
 */
export function resolveAction(state: MatchState, action: MatchAction, outcome: ActionOutcome | null = null): MatchAction {
  action.status = 'resolved';
  action.outcome = outcome;
  const index = state.actions.indexOf(action);
  if (index >= 0) state.actions.splice(index, 1);
  syncPlayerActions(state);
  return action;
}

/** Resolve every active action whose time is up. Returns them in order. */
export function resolveDueActions(
  state: MatchState,
  outcomeOf: (action: MatchAction) => ActionOutcome | null = () => null,
): MatchAction[] {
  const due = state.actions.filter((action) => actionIsDue(action, state.clock));
  for (const action of due) resolveAction(state, action, outcomeOf(action));
  return due;
}

/** Cancel every active action without an outcome — a new minute, a goal, a substitution. */
export function clearActions(state: MatchState): void {
  for (const action of state.actions) {
    action.status = 'cancelled';
  }
  state.actions.length = 0;
  syncPlayerActions(state);
}

/**
 * A mover's kinematic state: where he is, where he is going, and how fast.
 *
 * This is the shape `PlayerState` already has, so a player can be handed to
 * {@link advanceMovement} directly, but it is written as a small interface so
 * the movement maths can be tested without a football match around it.
 */
export interface MovementState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  vx: number;
  vy: number;
  /**
   * The match clock until which he is deliberately standing still, or 0.
   *
   * A player at rest is not a player with no target. He has a target, it is
   * simply not being applied until this runs out — which is the difference
   * between a man who has decided to stand still and a man who happens to have
   * arrived somewhere and is being asked a question every thirtieth of a second.
   * The second one vibrates; the first one does not.
   */
  restUntil?: number;
}

/** How quickly a player gets up to speed, as a multiple of his top speed per second. */
const ACCELERATION_FACTOR = 4;
/** And how quickly he stops when there is nowhere to go. */
const DECELERATION_FACTOR = 6;
/**
 * How close counts as arrived, as a fraction of the pitch.
 *
 * The arrival ramp below scales his speed with the distance still to cover, so
 * a player eases into his destination rather than stopping dead. On its own that
 * is asymptotical: he closes the last inch of grass at a speed too small to
 * see, for several seconds, and never quite reaches the point. A man in that
 * state is the standing definition of jitter — the target moves a hair as the
 * ball does, his velocity answers by changing sign, and the renderer draws his
 * facing arrow swinging back and forth while he appears not to move at all.
 *
 * So arriving is made a thing that happens, and it is made to happen by how
 * fast he is allowed to travel as he closes on his mark — see the stopping
 * profile in `advanceMovement`. He reaches his destination and comes to rest on
 * it, at a speed that is never too small to read as movement.
 */
export const ARRIVAL_RADIUS = 0.05;
/**
 * How far his mark has to move before a settled player sets off again.
 *
 * Eight inches of a pitch. It is not a place he has to reach and not a place he
 * is allowed to be — he stops wherever he has got to, and this only decides
 * whether the small movement of the ball around him is worth getting up for.
 */
const TARGET_DEADBAND = 0.008;
/** Below this a player is standing still rather than creeping. */
export const RESTING_SPEED = 1e-9;
/**
 * How far off his mark the target has to get before a settled player moves again.
 *
 * Larger than the distance he settles at on purpose. A player who stops at one
 * radius and restarts at the same one is standing on a knife edge: the ball
 * breathes a few inches, he crosses back and forth across the line, and he is
 * stopped and started every step or two — which is not a player standing still,
 * it is a player vibrating, and it is worse than never having stopped him.
 *
 * With a gap between the two, arriving is an event rather than a negotiation.
 * He comes to rest, and nothing short of his mark actually moving a real
 * distance brings him off it. Between those two moments he is completely, and
 * visibly, still.
 */
/** The pitch a player may move within, as fractions. */
const MIN_X = 0.02;
const MAX_X = 0.98;
const MIN_Y = 0.03;
const MAX_Y = 0.97;

function approach(value: number, target: number, maxDelta: number): number {
  const diff = target - value;
  if (Math.abs(diff) <= maxDelta) return target;
  return value + Math.sign(diff) * maxDelta;
}

/**
 * Move a player one step, with legs rather than a teleport.
 *
 * He carries a velocity and accelerates toward the speed his target asks for,
 * so he starts from a standstill, gets up to pace, slows as he arrives and has
 * to turn rather than change direction on the spot. Nothing here decides where
 * he is going — that was chosen elsewhere — and nothing here may exceed his top
 * speed, which is what keeps the picture honest on a poor pitch and a tired
 * afternoon.
 *
 * Deterministic: given the same mover, target and `dt`, it always produces the
 * same result, and it is integrated in fixed steps by the caller.
 */
export function advanceMovement(mover: MovementState, dt: number, clock = 0): void {
  if (!(dt > 0)) return;

  // At rest, nothing is applied to him at all. Not his position, not his
  // velocity beyond letting it die — he simply stands there, which is what a
  // standing player looks like and what no amount of target-jitter can fake.
  //
  // The rest is bounded by `restUntil`, so it is a pause with an end rather than
  // a player who has stopped consulting his own legs.
  if (mover.restUntil !== undefined && clock < mover.restUntil) {
    mover.vx = 0;
    mover.vy = 0;
    return;
  }

  const maxSpeed = Math.max(0, mover.speed);
  const accel = maxSpeed * ACCELERATION_FACTOR;
  const decel = maxSpeed * DECELERATION_FACTOR;
  const dx = mover.tx - mover.x;
  const dy = mover.ty - mover.y;
  // `Math.sqrt` of the sum of squares rather than `Math.hypot`: this is the
  // hottest arithmetic in the whole simulation, and `hypot` pays for overflow
  // guards against magnitudes a pitch measured in fractions never reaches.
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 1e-4) {
    // Nowhere to go: he stops rather than jitters on the spot.
    mover.vx = approach(mover.vx, 0, decel * dt);
    mover.vy = approach(mover.vy, 0, decel * dt);
    return;
  }

  // He slows into his destination instead of overshooting it.
  const pace = Math.min(1, distance / ARRIVAL_RADIUS);
  const desiredX = (dx / distance) * maxSpeed * pace;
  const desiredY = (dy / distance) * maxSpeed * pace;
  mover.vx = approach(mover.vx, desiredX, accel * dt);
  mover.vy = approach(mover.vy, desiredY, accel * dt);

  // Turning costs ground: a velocity above his top speed is trimmed back. The
  // comparison is made squared and the root is taken only when there is
  // something to trim, which is the uncommon case.
  const speedSq = mover.vx * mover.vx + mover.vy * mover.vy;
  if (speedSq > maxSpeed * maxSpeed) {
    const speed = Math.sqrt(speedSq);
    mover.vx = (mover.vx / speed) * maxSpeed;
    mover.vy = (mover.vy / speed) * maxSpeed;
  }

  // A settled player does not set off again because his mark breathed.
  //
  // Once a man has arrived, the mark he is aiming at is not a fixed point but a
  // function of where the ball is, so it drifts by a fraction every step as
  // possession and the players around it shift. Chasing that drift is what the
  // picture was doing at the minute mark: a player standing still with the ball
  // at his feet, reversing direction every step or two, going nowhere, drawn as
  // a vibrating arrow over a man who has not moved an inch.
  //
  // So a man who is standing still stays standing still until his mark has
  // actually gone somewhere. Nothing here moves him: his position is not
  // touched at all, so this cannot be a teleport and cannot put him a step out
  // of place — it only declines to start him walking.
  if (mover.vx * mover.vx + mover.vy * mover.vy <= RESTING_SPEED * RESTING_SPEED && distance < TARGET_DEADBAND) {
    mover.vx = 0;
    mover.vy = 0;
    return;
  }

  // Take the last of the stride, and stand on the mark.
  //
  // The ramp above eases him in without ever quite arriving: at an inch out he
  // is told to move at a two-hundredth of his top speed, so he closes the final
  // few inches over several seconds without reaching them. A player who is
  // *sliding* towards a mark is a player whose velocity answers every wobble in
  // that mark by changing sign, and the renderer draws that as a facing arrow
  // swinging back and forth over somebody who appears not to be moving at all.
  //
  // So when his mark is within a single stride he is simply put on it. This is
  // checked instead of taking a step, so the ground covered this step is still
  // at most one step's worth and nothing ever teleports: he arrives, and once
  // arrived a settled player is a fixed point of the system, which is what makes
  // him impossible to make vibrate.
  if (distance <= maxSpeed * dt) {
    mover.x = mover.tx;
    mover.y = mover.ty;
    return;
  }

  mover.x = Math.max(MIN_X, Math.min(MAX_X, mover.x + mover.vx * dt));
  mover.y = Math.max(MIN_Y, Math.min(MAX_Y, mover.y + mover.vy * dt));
}

/**
 * Keep each player's own action fields in step with the authoritative list.
 *
 * This is the one place a player's `actionKind`/timing is written, so the
 * denormalised view on `PlayerState` cannot drift from `MatchState.actions`.
 */
export function syncPlayerActions(state: MatchState): void {
  for (const player of state.players) {
    const action = state.actions.find((entry) => entry.playerId === player.playerId);
    player.actionKind = action?.kind ?? null;
    player.actionStartedAt = action?.startedAt ?? null;
    player.actionEndsAt = action ? action.startedAt + action.duration : null;
  }
}
