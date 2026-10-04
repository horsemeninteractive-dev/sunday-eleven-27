import type { LineHeights, Match, TeamShape } from '@/domain/match';
import type { Mentality } from '@/domain/tactics';
import type { Rng } from '../../rng';
import type { MatchContext, MatchEnvironment } from '../core';
import { otherSide, SIDES } from '../core';
import { linesFor, progressOf, shapeFor, urgencyFor, widthFor, xFromProgress, zoneOf } from '../field';
import { roleProfile } from '../roles';
import { playerEffectiveness } from '../teamStrength';
import { weighActions, type ActionContext, type ActionKind } from '../actions';
import { strikeBall } from './ball';
import { emitEvent } from './events';
import { clamp, clampPitch, distance, distanceSq, goalLine, goalPosts, GOAL_HALF_WIDTH, inOwnBox, MAX_X, MAX_Y, MIN_X, MIN_Y, nearestOpponent, ownGoalLine, ownGoalCentre, pressureAt } from './pitch';
import { inOffsidePosition } from './offside';
import { activePlayers, keeperOf, playerOf } from './state';
import type { MatchEngineState, PlayerMatchState, ShotOutcome, Side } from './types';

/**
 * The player decision model.
 *
 * Every player, every step, answers the same question a footballer answers: given
 * where the ball is, who is around me, what my side is trying to do and what I am
 * good at, what should I do now? The answer becomes a target and an intent, and
 * the movement rules carry it out.
 *
 * This is the layer that used to be missing. The old engine decided a whole
 * minute's football up front and handed the picture a script; here the decisions
 * are made from the live state, so a player can react to a deflection, a loose
 * ball or a man arriving — none of which could be known a minute in advance.
 *
 * Nothing in here reads the renderer, and nothing in the renderer decides
 * anything. This is the football.
 */

export interface DecisionWorld {
  match: Match;
  env: MatchEnvironment;
  /** Team strength and tactics, refreshed by the engine on a slow cadence. */
  context: MatchContext;
}

/** A side's mean stamina, for the shape and the press. */
function sideEnergy(state: MatchEngineState, side: Side): number {
  const players = activePlayers(state, side);
  if (players.length === 0) return 100;
  return players.reduce((sum, player) => sum + player.stamina, 0) / players.length;
}

const NOMINAL_WIDTH = 0.68;
const SHAPE_LEAN = 0.12;

/**
 * The deepest progress any outfield player is placed at by the shape, ever.
 *
 * A player's slot carries an offset from his line, and a deep formation slot
 * combined with a defensive role can pull a centre-back well behind the line he
 * belongs to — which, with a deep line, put him on his own goal line behind the
 * keeper. This is the floor that stops it: however the arithmetic comes out, an
 * outfield man stands in front of his keeper, in the six-yard box at worst.
 */
const SHAPE_MIN_PROGRESS = 0.07;

/**
 * How often, in football seconds, a player without the ball reconsiders.
 *
 * A footballer without the ball chooses a position or a run and then goes and
 * does it; he does not re-aim his body twenty or thirty times a second. The
 * engine's step is 1/30 s, but asking every man where he should stand on every
 * one of those steps is both unlike football and the single largest cost in a
 * match — the ball and the man on it need the fine step, the shape does not.
 * Re-deciding the off-ball men on this slower cadence, and letting them run out
 * the target they chose in between, leaves the football the same to watch while
 * removing most of the work. The cadence is a fixed number of football seconds,
 * not wall-clock time, so it does not touch the fixed-step guarantee.
 */
export const OFF_BALL_INTERVAL = 1 / 6;

/**
 * The questions every player asks of the same state, answered once a step.
 *
 * Twenty-two men each need to know who is nearest the ball, how hard their side
 * is still running, and what the block is doing — and the answers are the same
 * for every man on a side, because a decision only picks a target and never
 * moves anybody until the movement rules run. Asking each man separately turns
 * the off-ball layer into an O(n²) scan of the pitch every thirtieth of a
 * second; this answers each question the first time it is asked in a step and
 * lets the rest read the answer. The values are cached, not frozen: the ball's
 * position does not move during the decision pass, so nothing a player decides
 * can make another player's reading stale.
 */
/** The two readings a side's shape takes, in and out of possession. */
type PossessionKind = 'inPossession' | 'outOfPossession';

/** Everything a side's shape needs, worked out together the first time it is asked. */
interface ShapeReading {
  shape: TeamShape;
  lines: LineHeights;
  width: number;
}

interface StepVision {
  /** A side's mean stamina, for the shape and the press. */
  energy: Record<Side, number>;
  /** The player of a side nearest the ball, the keeper included. */
  nearestAny: Record<Side, PlayerMatchState | null>;
  /** The outfield player of a side nearest the ball. */
  nearestOutfield: Record<Side, PlayerMatchState | null>;
  /**
   * A side's shape, read on demand and remembered.
   *
   * Only one reading of a side is ever used in a step: a side is either in
   * possession or out of it, and every off-ball decision asks the same one. So
   * the two are not built up front — the reading the step actually needs is
   * built the first time it is asked for and the other is never built at all.
   * The common path reads the cached value directly; `fillReading` only runs on
   * the first ask of the step.
   */
  readings: Record<Side, Partial<Record<PossessionKind, ShapeReading>>>;
  fillReading: (side: Side, kind: PossessionKind) => ShapeReading;
}

/**
 * Build a step's shared vision.
 *
 * One object per decision pass. Nothing in it reads the renderer or draws a
 * random number, so what it answers can never diverge from the same question
 * asked directly — the same football, worked out once a step instead of once a
 * player. It is built eagerly for both sides because there are only two of them
 * and four readings, which is cheaper than the bookkeeping a cache would need.
 */
function createVision(state: MatchEngineState, world: DecisionWorld): StepVision {
  const energy = {} as Record<Side, number>;
  const nearestAny = {} as Record<Side, PlayerMatchState | null>;
  const nearestOutfield = {} as Record<Side, PlayerMatchState | null>;
  const readings: Record<Side, Partial<Record<PossessionKind, ShapeReading>>> = { home: {}, away: {} };

  const bx = state.ball.x;
  const by = state.ball.y;
  for (const side of SIDES) {
    energy[side] = sideEnergy(state, side);
    // Nearest-any and nearest-outfield in one pass, without a filter callback:
    // the two are the same walk over the side's men, and doing it twice with a
    // closure each time was measurable.
    let bestAny: PlayerMatchState | null = null;
    let bestAnyDistance = Infinity;
    let bestOutfield: PlayerMatchState | null = null;
    let bestOutfieldDistance = Infinity;
    for (const player of state.players) {
      if (player.sentOff || player.side !== side) continue;
      const d = distanceSq(bx, by, player.x, player.y);
      if (d < bestAnyDistance) {
        bestAnyDistance = d;
        bestAny = player;
      }
      if (player.position !== 'GK' && d < bestOutfieldDistance) {
        bestOutfieldDistance = d;
        bestOutfield = player;
      }
    }
    nearestAny[side] = bestAny;
    nearestOutfield[side] = bestOutfield;
  }

  const fillReading = (side: Side, kind: PossessionKind): ShapeReading => {
    const cached = readings[side][kind];
    if (cached) return cached;
    const inPossession = kind === 'inPossession';
    const urgency = urgencyFor(side, { minute: 0, goalDifference: 0 });
    const shape = shapeFor(world.context, side, { inPossession, energy: energy[side], urgency });
    const value: ShapeReading = {
      shape,
      lines: linesFor(shape, { inPossession, progress: progressOf(side, state.ball.x) }),
      width: widthFor(shape, inPossession),
    };
    readings[side][kind] = value;
    return value;
  };

  return { energy, nearestAny, nearestOutfield, readings, fillReading };
}

/**
 * Where a player's shape wants him, given where the ball is and who has it.
 *
 * The same maths the old presentation layer used, now feeding a decision rather
 * than a drawing: a formation slot, carried by the live line heights, spread by
 * how wide the side currently is, leaned toward the ball's flank, and nudged by
 * the player's role.
 */
export function shapeTargetFor(
  vision: StepVision,
  player: PlayerMatchState,
  ball: { x: number; y: number },
  inPossession: boolean,
): { x: number; y: number } {
  const side = player.side;
  const kind: PossessionKind = inPossession ? 'inPossession' : 'outOfPossession';
  const readings = vision.readings[side];
  const reading = readings[kind] ?? vision.fillReading(side, kind);
  // Everything that is fixed about the slot — the line it belongs to, the depth
  // and width his role gives it — was worked out when he took the field; only
  // the live parts are applied here.
  const shaped = reading.lines[player.slotLine] + player.slotDepthOffset;
  const x = xFromProgress(side, clamp(shaped, SHAPE_MIN_PROGRESS, 0.97));

  const spread = reading.width / NOMINAL_WIDTH;
  const lean = reading.shape.ballOrientation * (ball.y - 0.5) * SHAPE_LEAN;
  const y = 0.5 + player.slotLateral * spread + lean;
  return clampPitch(x, y);
}

/** Where the ball is going to be in a short while, for a presser's intercept. */
function ballLead(state: MatchEngineState, seconds: number): { x: number; y: number } {
  const ball = state.ball;
  return clampPitch(ball.x + ball.vx * seconds, ball.y + ball.vy * seconds);
}

/**
 * Decide, for every player, what he is trying to do this step.
 *
 * One player has the ball at his feet and is deciding what to do with it; the
 * other twenty-one are deciding where to be. Both are the same kind of decision —
 * a target and an intent — so the movement rules do not care which is which.
 */
export function updateDecisions(state: MatchEngineState, world: DecisionWorld, rng: Rng): void {
  const offBallDue = state.clock >= state.nextOffBallDecision;
  if (offBallDue) {
    // One vision for the whole pass: the twenty-two men share the answers to the
    // questions they ask of the same state.
    const vision = createVision(state, world);
    for (const player of state.players) {
      if (player.sentOff) continue;
      if (player.possession) decideOnBall(state, world, player, rng);
      else decideOffBall(state, player, rng, vision);
    }
    state.nextOffBallDecision = state.clock + OFF_BALL_INTERVAL;
    return;
  }
  // Between the off-ball decisions only the man on the ball has a new one to
  // make, and at most one man ever has the ball. Walking all twenty-two to find
  // him was most of this function; finding him directly is the same answer for a
  // fraction of the work, and the same single draw from the step's stream.
  for (const player of state.players) {
    if (player.possession && !player.sentOff) {
      decideOnBall(state, world, player, rng);
      return;
    }
  }
}

// --- Off the ball ----------------------------------------------------------

function decideOffBall(
  state: MatchEngineState,
  player: PlayerMatchState,
  rng: Rng,
  vision: StepVision,
): void {
  const side = player.side;
  const ball = state.ball;
  const possessing = state.possession;

  // A ball coming to him overrides everything: he goes to meet it. This is what
  // makes a pass look like a pass rather than a ball rolling to where a man was.
  if (ball.status === 'travelling' && ball.targetId === player.playerId) {
    player.tx = clamp(ball.tx, 0.02, 0.98);
    player.ty = clamp(ball.ty, 0.02, 0.98);
    player.intent = 'receive';
    player.action = 'supporting';
    return;
  }

  // A loose ball nobody owns is chased by whoever of his side is closest.
  if ((ball.status === 'loose' || ball.status === 'travelling') && !possessing) {
    const mine = vision.nearestAny[side];
    const theirs = vision.nearestAny[otherSide(side)];
    const myDistance = distanceSq(ball.x, ball.y, player.x, player.y);
    const closest = mine?.playerId === player.playerId;
    if (closest && (!theirs || myDistance <= distanceSq(ball.x, ball.y, theirs.x, theirs.y))) {
      const aim = ballLead(state, 0.35);
      player.tx = aim.x;
      player.ty = aim.y;
      player.intent = 'chase';
      player.action = 'chasing';
      return;
    }
  }

  // A goalkeeper does not play the same game as everybody else: he guards a
  // piece of grass, not a man. He stands between the ball and his goal, and he
  // comes for anything loose in his own box.
  if (player.position === 'GK') {
    decideKeeper(state, player);
    return;
  }

  if (possessing === side) {
    decideSupporting(state, player, rng, vision);
    return;
  }

  // Out of possession: one man closes the ball down, the rest hold the block.
  const closest = vision.nearestOutfield[side];
  const isCloser = closest?.playerId === player.playerId;
  // The man on the ball draws a challenge when somebody is near enough.
  const carrier = ball.ownerId ? playerOf(state, ball.ownerId) : undefined;
  // The point being pressed: the man on the ball, or where a loose ball is
  // heading. Kept as two numbers — a point object per defender per decision was
  // an allocation the hot loop did not need.
  const pressX = carrier ? carrier.x : clamp(ball.x + ball.vx * 0.2, MIN_X, MAX_X);
  const pressY = carrier ? carrier.y : clamp(ball.y + ball.vy * 0.2, MIN_Y, MAX_Y);
  const distanceToPress = distance(player.x, player.y, pressX, pressY);

  // Exactly one man closes the ball down: the outfield player nearest to it.
  // Football sends the closest man to the ball and the rest hold the block; the
  // side that sends three or four loses its shape and is played through. The
  // role only decides how far out that one man will go — a ball-winner hunts from
  // further away than a centre-back — never whether a *second* man joins in.
  const pressBehaviour = player.pressBehaviour;
  const pressRange = pressBehaviour === 'chase' ? 0.45 : pressBehaviour === 'press' ? 0.36 : 0.26;
  const wantsIt = isCloser && distanceToPress < pressRange;

  if (wantsIt) {
    // Approach from the side the carrier is facing away from: the ball's own goal.
    const towardOwnGoal = side === 'home' ? 1 : -1;
    player.tx = clamp(pressX + towardOwnGoal * 0.01, 0.02, 0.98);
    player.ty = pressY;
    player.intent = pressBehaviour === 'chase' ? 'chase' : 'press';
    player.action = 'chasing';
    return;
  }

  // The defending shape is the shape *without* the ball, and it drops with the
  // danger: this is the block that steps back toward its own goal.
  const target = shapeTargetFor(vision, player, ball, false);
  if (isCloser && distanceToPress < 0.6) {
    // The nearest man shades toward the ball even while holding his shape.
    player.tx = clamp(target.x + (ball.x - target.x) * 0.2, 0.02, 0.98);
    player.ty = clamp(target.y + (ball.y - target.y) * 0.2, 0.03, 0.97);
    player.intent = 'cover';
  } else {
    player.tx = target.x;
    player.ty = target.y;
    player.intent = 'hold';
  }
  player.action = 'shape';
}

/**
 * Where a goalkeeper stands.
 *
 * On the line between the ball and the middle of his goal, a little way off his
 * line — which is what a keeper actually does — and on the ball itself when it is
 * loose in the area. Without this he wandered with the shape like everybody else,
 * and a tame pass rolled into the net while he was forty yards away.
 */
function decideKeeper(state: MatchEngineState, player: PlayerMatchState): void {
  const goal = ownGoalCentre(player.side);
  const ball = state.ball;
  const awayFromGoal = distance(ball.x, ball.y, goal.x, goal.y);
  player.intent = 'cover';
  player.action = 'shape';

  if (ball.status === 'loose' && inOwnBox(player.side, ball.x, ball.y) && awayFromGoal < 0.14) {
    player.tx = ball.x;
    player.ty = ball.y;
    player.intent = 'chase';
    player.action = 'chasing';
    return;
  }

  const dx = ball.x - goal.x;
  const dy = ball.y - goal.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const stand = 0.045;
  player.tx = clamp(goal.x + (dx / length) * stand, 0.02, 0.98);
  player.ty = clamp(0.5 + (dy / length) * stand * 0.7, 0.38, 0.62);
}

/**
 * A teammate without the ball, when his side has it.
 *
 * He offers an option: he holds the shape unless he is close enough to the
 * carrier to be worth passing to, in which case he moves into space ahead of the
 * ball. A role that makes runs beyond the ball pushes further up the pitch.
 */
function decideSupporting(
  state: MatchEngineState,
  player: PlayerMatchState,
  rng: Rng,
  vision: StepVision,
): void {
  const side = player.side;
  const ball = state.ball;
  const base = shapeTargetFor(vision, player, ball, true);
  const facing = side === 'home' ? 1 : -1;

  // NOTE: a "nearest team-mate offers himself short" branch once stood here and
  // could never fire. It gathered every team-mate *except the current player*
  // and then asked whether the nearest of them was the current player, which is
  // false by construction — so the whole scan (a filter over the side and a
  // distance reduce for every supporting man, tens of millions of times a match)
  // was dead work. It is removed rather than repaired, to keep this pass
  // behaviour-preserving: making the short-support run actually happen is a
  // football change and belongs in its own change, not in a performance one.

  // A runner goes beyond the ball when his side is up the pitch.
  if (player.runsInBehind && progressOf(side, ball.x) > 0.45) {
    player.tx = clamp(base.x + facing * (0.05 + rng.float(0, 0.05)), 0.03, 0.97);
    player.ty = base.y;
    player.intent = 'run';
    player.action = 'supporting';
    return;
  }

  player.tx = base.x;
  player.ty = base.y;
  player.intent = 'support';
  player.action = 'supporting';
}

// --- On the ball -----------------------------------------------------------

/** Count the opponents sitting in the lane between two points. */
function laneCongestion(state: MatchEngineState, side: Side, from: { x: number; y: number }, to: { x: number; y: number }): number {
  // The segment and its length do not change as we walk the opponents, so they
  // are worked out once rather than once per man.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy || 1e-12;
  let count = 0;
  for (const opponent of state.players) {
    if (opponent.side === side || opponent.sentOff) continue;
    // Distance from the opponent to the segment from→to.
    const t = clamp(((opponent.x - from.x) * dx + (opponent.y - from.y) * dy) / lengthSq, 0, 1);
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    if (distanceSq(px, py, opponent.x, opponent.y) < 0.045 * 0.045) count += 1;
  }
  return count;
}

/** How open a teammate is: how far the nearest opponent is, and who is in the lane. */
function opennessOf(state: MatchEngineState, side: Side, mate: PlayerMatchState): number {
  const marker = nearestOpponent(state, side, mate.x, mate.y);
  const space = marker ? distance(marker.x, marker.y, mate.x, mate.y) : 0.4;
  return clamp(space / 0.16, 0, 1);
}

/** Turn a 0..20 attribute into a 0..1 reading. */
function attribute01(value: number): number {
  return clamp(value / 20, 0, 1);
}

/**
 * How willing a side is to play the risky, progressive pass, 0..1.
 *
 * This is the manager's instruction and the match context read as one number,
 * and it is the behavioural core of pass selection: a direct, high, attacking
 * side wants the ball forward, a short, deep side protecting a lead recycles it.
 * It is not a bonus added to an outcome — it changes *which teammate the passer
 * looks for*. Balanced, mixed, standard comes out at about 0.5, which leaves a
 * side with no strong instruction playing exactly as it always did.
 */
export function passRiskAppetite(world: DecisionWorld, side: Side, minute: number, goalDifference: number): number {
  const tactics = world.context[side].tactics;
  const byMentality: Record<Mentality, number> = {
    'very-defensive': 0.22,
    defensive: 0.36,
    balanced: 0.5,
    attacking: 0.66,
    'very-attacking': 0.8,
  };
  let risk = byMentality[tactics.mentality] ?? 0.5;
  if (tactics.passingStyle === 'direct') risk += 0.12;
  else if (tactics.passingStyle === 'short') risk -= 0.12;
  if (tactics.tempo === 'high') risk += 0.05;
  else if (tactics.tempo === 'slow') risk -= 0.04;
  // Chasing the game pushes the ball forward; protecting a lead keeps it.
  risk += urgencyFor(side, { minute, goalDifference }) * 0.4;
  if (goalDifference > 0 && minute > 70) risk -= 0.22;
  return clamp(risk, 0, 1);
}

/** One teammate the passer could pick out, with the score he gives him. */
export interface PassTargetScore {
  mate: PlayerMatchState;
  score: number;
}

/**
 * Score every teammate a pass could go to.
 *
 * The judgement is football's: forward is good, open is good, a clear lane is
 * good, and a pass across the whole pitch is a different thing from one five
 * yards square. What the *passer* and his *side* add is how that judgement comes
 * out — and they add it as behaviour rather than as a thumb on a die:
 *
 * - His **judgement** (passing, decisions, composure) decides how reliably he
 *   reads the options. A good judge picks the best man more consistently; a poor
 *   one is noisier and more likely to take the obvious ball.
 * - His **range** decides how much a long pass costs him: a passer who can see
 *   and play it is not put off by distance, a limited one is.
 * - His side's **risk appetite** (tactics, scoreline, clock) decides how much a
 *   forward ball is worth: the same pass is the right one for an attacking side
 *   chasing a game and the wrong one for a side protecting a lead.
 * - A hard-pressed passer values a **receiver who can keep it**.
 *
 * Each factor is centred on the ordinary — an average passer on a balanced side
 * scores a target exactly as the model always did — so the football only moves
 * where a man or a tactic is *not* ordinary. Pure and deterministic: the same
 * state and the same draws give the same ranking.
 */
export function evaluatePassTargets(
  state: MatchEngineState,
  world: DecisionWorld,
  player: PlayerMatchState,
  rng: Rng,
  mode: 'pass' | 'through' | 'switch',
): PassTargetScore[] {
  const side = player.side;
  const ball = state.ball;
  const ownProgress = progressOf(side, ball.x);
  const minute = Math.floor(state.clock / 60);
  const goalDifference = state.score[side] - state.score[otherSide(side)];
  const risk = passRiskAppetite(world, side, minute, goalDifference);
  const pressure = pressureAt(state, ball.x, ball.y, side);

  const passer = world.env.getPlayer(player.playerId);
  const attrs = passer?.attributes;
  const vision = attrs
    ? (attribute01(attrs.technical.passing) + attribute01(attrs.mental.decisions) + attribute01(attrs.mental.composure)) / 3
    : 0.5;
  // Centred on an ordinary passer: 0.12 of noise at 0.5 vision, as before.
  const noise = 0.12 + 0.14 * (0.5 - vision);
  // Range: a good passer is less put off by the length of the pass.
  const distanceWeight = 0.45 - 0.22 * (vision - 0.5);
  // A forward pass is worth more the more the side wants to go forward.
  const forwardWeight = 2.6 * (0.6 + 0.8 * risk);

  const scores: PassTargetScore[] = [];
  for (const mate of activePlayers(state, side)) {
    if (mate.playerId === player.playerId || mate.position === 'GK') continue;
    const d2 = distanceSq(ball.x, ball.y, mate.x, mate.y);
    if (d2 < 0.035 * 0.035 || d2 > 0.5 * 0.5) continue;
    const d = Math.sqrt(d2);
    const forward = progressOf(side, mate.x) - ownProgress;
    const openness = opennessOf(state, side, mate);
    const lane = clamp(1 - laneCongestion(state, side, { x: ball.x, y: ball.y }, { x: mate.x, y: mate.y }) * 0.42, 0, 1);
    let score = openness * 1.2 + lane * 1.1 - d * distanceWeight + rng.float(-noise, noise);

    if (mode === 'pass') {
      score += clamp(forward * forwardWeight, -1.2, 1.4);
      // A man already high up the pitch does not want the square or backward ball
      // as much as a man building from the back: turning back on the edge of the
      // box lets the defence set and is how a striker ends up passing to his
      // partner instead of having a go. It is still allowed — sometimes it is the
      // right ball — but it is no longer the easy first choice.
      if (ownProgress > 0.66 && forward < 0) score -= 0.55;
    }
    if (mode === 'through') score += forward * forwardWeight - 0.2;
    if (mode === 'switch') score += Math.abs(mate.y - ball.y) * 2.4 - 0.1;

    // Under pressure he looks for a man who can keep it: a good first touch is
    // worth more to a passer being closed down than to one with time.
    if (pressure > 0.4) {
      const receiver = world.env.getPlayer(mate.playerId);
      const control = receiver ? attribute01(receiver.attributes.technical.ballControl) : 0.5;
      score += control * 0.35;
    }
    scores.push({ mate, score });
  }
  return scores;
}

/**
 * Choose which teammate a pass goes to: the best-scoring option.
 *
 * A plain scan rather than a sort — the pick is the same, ties resolved in the
 * order the side was walked, which is what a stable sort gave before.
 */
function selectPassTarget(
  state: MatchEngineState,
  world: DecisionWorld,
  player: PlayerMatchState,
  rng: Rng,
  mode: 'pass' | 'through' | 'switch',
): PlayerMatchState | null {
  const scores = evaluatePassTargets(state, world, player, rng, mode);
  let best: PassTargetScore | null = null;
  for (const entry of scores) {
    if (!best || entry.score > best.score) best = entry;
  }
  return best?.mate ?? null;
}

/** Whether the forward pass is available, for a through ball. */
function runnerAheadOf(state: MatchEngineState, player: PlayerMatchState): PlayerMatchState | null {
  const side = player.side;
  const ownProgress = progressOf(side, state.ball.x);
  const runners = activePlayers(state, side)
    .filter(
      (mate) =>
        mate.playerId !== player.playerId &&
        mate.position !== 'GK' &&
        progressOf(side, mate.x) > ownProgress + 0.04 &&
        roleProfile(mate.role).runsInBehind,
    )
    .sort((a, b) => progressOf(side, b.x) - progressOf(side, a.x));
  return runners[0] ?? null;
}

function decideOnBall(state: MatchEngineState, world: DecisionWorld, player: PlayerMatchState, rng: Rng): void {
  // A carrier is committed to what he is doing for a beat; changing his mind
  // every thirtieth of a second is not a footballer, it is a jitter.
  if (state.clock < player.committedUntil) {
    player.action = player.intent === 'shield' ? 'carrying' : player.action;
    return;
  }

  const side = player.side;
  const ball = state.ball;
  const isKeeper = player.position === 'GK';
  const person = world.env.getPlayer(player.playerId);
  const effective = playerEffectiveness(person ?? placeholderPlayer(player), player.position, { energy: player.stamina });
  const progressValue = progressOf(side, ball.x);
  const zone = zoneOf(side, ball.x);
  const pressure = pressureAt(state, ball.x, ball.y, side);
  // One walk of the side counts every option the carrier weighs. Asking four
  // separate `filter`s allocated four arrays a step, thirty times a second, for
  // counts a single loop produces without allocating anything.
  let optionsTotal = 0;
  let optionsAhead = 0;
  let runnersAhead = 0;
  let optionsWide = 0;
  const optionRange = 0.42 * 0.42;
  for (const mate of activePlayers(state, side)) {
    if (mate.playerId === player.playerId || mate.position === 'GK') continue;
    if (distanceSq(ball.x, ball.y, mate.x, mate.y) < optionRange) optionsTotal += 1;
    if (progressOf(side, mate.x) > progressValue + 0.02) {
      optionsAhead += 1;
      if (mate.runsInBehind) runnersAhead += 1;
    }
    if (Math.abs(mate.y - 0.5) > 0.24) optionsWide += 1;
  }

  const minute = Math.floor(state.clock / 60);
  const goalDifference = state.score[side] - state.score[otherSide(side)];

  const ctx: ActionContext = {
    position: player.position,
    role: roleProfile(player.role),
    isKeeper,
    progress: progressValue,
    y: ball.y,
    zone,
    pressure,
    optionsTotal,
    optionsAhead,
    runnersAhead,
    optionsWide,
    effective: effective.effective,
    energy: player.stamina,
    profile: world.context[side].profile,
    tactics: world.context[side].tactics,
    urgency: urgencyFor(side, { minute, goalDifference }),
    retaining: goalDifference > 0 && minute > 70,
    counter: false,
  };

  // The base model is the football judgement; these multipliers are the engine's
  // own opinion about the *rate* of it. A Sunday side does not shoot every time
  // it enters the box; it passes, crosses and loses the ball, and takes the
  // occasional chance when one genuinely opens. Left alone the base weights made
  // a shot the most likely action in the area, which produced three hundred of
  // them a match.
  const weighed = weighActions(ctx).map((option) => ({ ...option }));
  for (const option of weighed) {
    // The engine's own opinion about the *rate* of the action, on top of the
    // football judgement. A shot is damped everywhere, but far less inside the
    // area: a striker with the ball in the box is far more likely to have a go
    // than to square it, which is what makes him a striker. The old flat 0.1
    // damped the box and the halfway line alike, so a poacher on the penalty
    // spot was as reluctant as a centre-back — the complaint that strikers
    // passed instead of shooting.
    if (option.kind === 'shoot') {
      option.weight *= zone === 'box' ? 0.16 : zone === 'final-third' ? 0.11 : 0.1;
    }
    if (option.kind === 'carry') option.weight *= 0.7;
    if (option.kind === 'hold') option.weight *= 0.85;
  }
  const choice: { kind: ActionKind; options: typeof weighed } =
    weighed.length === 0
      ? { kind: 'pass', options: weighed }
      : { kind: rng.weighted(weighed.map((option) => ({ value: option.kind, weight: option.weight }))), options: weighed };
  // A shot has to be genuinely on: inside the area, or from the edge of it with
  // the space to get one away. Anywhere else it is a pass.
  const shotOn = zone === 'box' || (zone === 'final-third' && progressValue > 0.78 && pressure < 0.45);
  const kind: ActionKind = choice.kind === 'shoot' && !shotOn ? 'pass' : choice.kind;
  const accuracy = clamp(0.9 - pressure * 0.35 + (effective.effective.passing / 20) * 0.06, 0.35, 0.98);

  const aimWithError = (to: { x: number; y: number }, strength: number): { x: number; y: number } => {
    const spread = (1 - clamp(strength, 0, 1)) * Math.max(0.03, distance(ball.x, ball.y, to.x, to.y)) * 1.1;
    // No clamp to the pitch: a pass that is misplaced badly enough goes out of
    // play, which is what a throw-in is. It is kept out of his own net, though:
    // an own goal has to be earned, not produced by the pass model.
    return guardOwnGoal(side, { x: ball.x, y: ball.y }, {
      x: to.x + rng.float(-spread, spread),
      y: to.y + rng.float(-spread, spread),
    });
  };

  const commit = (seconds: number, intent: PlayerMatchState['intent']): void => {
    player.committedUntil = state.clock + seconds;
    player.intent = intent;
    player.action = 'carrying';
  };

  switch (kind) {
    case 'shoot': {
      const posts = goalPosts(side);
      const shooting = effective.effective.shooting / 20;
      const composure = effective.effective.composure / 20;
      const toGoal = distance(ball.x, ball.y, goalLine(side), 0.5);
      const angle = 1 - clamp(Math.abs(ball.y - 0.5) / 0.45, 0, 1);
      const keeper = keeperOf(state, otherSide(side));
      const keeperPerson = keeper ? world.env.getPlayer(keeper.playerId) : undefined;
      const keeperAbility = keeperPerson ? keeperPerson.attributes.technical.goalkeeping / 20 : 0.45;

      // Whether the shot is on target at all is a fact of the shot, not a wish
      // for variety: the strike, the composure, how tight the angle is, how far
      // out he is, the pressure on him and the keeper waiting for it all move
      // it. A shot from a good position still misses sometimes; a hopeful one
      // from thirty yards misses often.
      const onTargetChance =
        clamp(
          0.30 +
            shooting * 0.32 +
            composure * 0.12 -
            pressure * 0.3 -
            clamp((toGoal - 0.1) / 0.4, 0, 1) * 0.18 -
            keeperAbility * 0.06,
          0.1,
          0.8,
        ) *
        (0.74 + angle * 0.26);

      let outcome: ShotOutcome;
      if (!rng.chance(onTargetChance)) {
        // Off target. Over the bar becomes more likely the further out he is and
        // the less clean the strike; wide, the tighter the angle.
        const overChance = clamp(0.34 + (toGoal - 0.12) * 1.1 + (1 - angle) * 0.25 - shooting * 0.2, 0.2, 0.72);
        outcome = rng.chance(overChance) ? 'over' : 'wide';
      } else if (rng.chance(0.07)) {
        // On target but off the frame: a chance from nothing.
        outcome = 'woodwork';
      } else {
        // On target, and the keeper has his say. Whether it is kept out is the
        // finish — the strike, the composure, the angle, the range, the pressure
        // — against the keeper's ability.
        const finish = clamp(
          0.16 +
            shooting * 0.5 +
            composure * 0.3 +
            angle * 0.22 -
            clamp((toGoal - 0.1) / 0.4, 0, 1) * 0.35 -
            pressure * 0.2,
          0.05,
          0.95,
        );
        const pGoal = clamp(finish - keeperAbility * 0.35, 0.05, 0.62);
        outcome = rng.chance(pGoal) ? 'goal' : 'saved';
      }

      let aimY: number;
      if (outcome === 'wide') {
        const sideOfPitch = ball.y < 0.5 ? -1 : 1;
        aimY = 0.5 + sideOfPitch * (GOAL_HALF_WIDTH + rng.float(0.01, 0.05));
      } else if (outcome === 'over') {
        aimY = 0.5 + rng.float(-0.03, 0.03);
      } else if (outcome === 'woodwork') {
        aimY = rng.chance(0.5) ? posts.near : posts.far;
      } else {
        // A goal may be placed into a corner; a shot the keeper is going to keep
        // out is struck where a keeper can reach it, which is where he stands.
        const placement = clamp(0.4 + composure * 0.35 + shooting * 0.2, 0, 0.92);
        const corner = outcome === 'goal' && rng.chance(placement);
        aimY = corner ? (rng.chance(0.5) ? posts.near + 0.012 : posts.far - 0.012) : 0.5 + rng.float(-0.03, 0.03);
      }

      strikeBall(state, {
        from: { x: ball.x, y: ball.y },
        to: { x: goalLine(side), y: aimY },
        kind: 'shot',
        speed: 0.62 + shooting * 0.22,
        targetId: null,
        intendedSide: side,
        loft: outcome === 'over' || rng.chance(0.15),
        playerId: player.playerId,
        shotOutcome: outcome,
      });
      commit(1.5, 'carry');
      recordShot(state, world, player, side);
      return;
    }
    case 'cross': {
      const mate = selectPassTarget(state, world, player, rng, 'pass');
      const x = xFromProgress(side, 0.92);
      const y = 0.5 + (rng.chance(0.5) ? -1 : 1) * rng.float(0.07, 0.16);
      const aim = aimWithError({ x, y }, accuracy * 0.9);
      strikeBall(state, {
        from: { x: ball.x, y: ball.y },
        to: aim,
        kind: 'cross',
        speed: 0.24,
        targetId: null,
        intendedSide: side,
        loft: true,
        playerId: player.playerId,
      });
      commit(1.2, 'carry');
      recordPass(state, world, player, side, mate);
      return;
    }
    case 'through': {
      const runner = runnerAheadOf(state, player);
      if (runner) {
        const facing = side === 'home' ? 1 : -1;
        const aim = aimWithError({ x: clamp(runner.x + facing * 0.1, 0.04, 0.96), y: runner.y }, accuracy);
        strikeBall(state, {
          from: { x: ball.x, y: ball.y },
          to: aim,
          kind: 'through',
          speed: 0.24,
          targetId: runner.playerId,
          intendedSide: side,
          loft: false,
          playerId: player.playerId,
          offsidePlayerId: inOffsidePosition(state, side, runner) ? runner.playerId : null,
        });
        commit(1.2, 'carry');
        recordPass(state, world, player, side, runner);
        return;
      }
      break;
    }
    case 'switch': {
      const mate = selectPassTarget(state, world, player, rng, 'switch');
      if (mate) {
        const aim = aimWithError({ x: mate.x, y: mate.y }, accuracy);
        strikeBall(state, {
          from: { x: ball.x, y: ball.y },
          to: aim,
          kind: 'pass',
          speed: 0.22,
          targetId: mate.playerId,
          intendedSide: side,
          loft: false,
          playerId: player.playerId,
          offsidePlayerId: inOffsidePosition(state, side, mate) ? mate.playerId : null,
        });
        commit(1.2, 'carry');
        recordPass(state, world, player, side, mate);
        return;
      }
      break;
    }
    case 'clear': {
      // A clearance from inside your own box sometimes goes behind for a corner —
      // the shank, the slice, the hoof that ends up out of play over your own
      // line. It is a real and frequent part of the game, and without it corners
      // barely existed at all. Every so often it goes somewhere worse: a slice
      // back over his own line and between his own posts, which is an own goal.
      const ownBox = inOwnBox(side, ball.x, ball.y);
      const desperate = ownBox && rng.chance(0.03);
      const ownGoal = ownBox && !desperate && rng.chance(0.0006);
      const targetX =
        ownGoal || desperate ? ownGoalLine(side) : clamp(xFromProgress(side, rng.float(0.5, 0.82)), 0.08, 0.92);
      const targetY = ownGoal
        ? 0.5 + rng.float(-0.03, 0.03)
        : desperate
          ? rng.chance(0.5)
            ? 0.16
            : 0.84
          : clamp(ball.y + rng.float(-0.25, 0.25), 0.06, 0.94);
      strikeBall(state, {
        from: { x: ball.x, y: ball.y },
        to: { x: targetX, y: targetY },
        kind: 'clear',
        speed: 0.38,
        targetId: null,
        intendedSide: side,
        loft: true,
        playerId: player.playerId,
      });
      commit(1.1, 'clear');
      return;
    }
    case 'dribble': {
      const opponent = nearestOpponent(state, side, ball.x, ball.y);
      const facing = side === 'home' ? 1 : -1;
      const sideStep = opponent ? Math.sign(mateSide(player.y, opponent.y) || rng.float(-1, 1)) : 1;
      player.tx = clamp(ball.x + facing * 0.12, 0.03, 0.97);
      player.ty = clamp(ball.y + sideStep * 0.05, 0.04, 0.96);
      recordCarry(state, world, player, side, opponent);
      commit(1.5, 'carry');
      return;
    }
    case 'carry':
    default: {
      const facing = side === 'home' ? 1 : -1;
      const drift = inOwnBox(side, ball.x, ball.y) ? 0.06 : 0.12;
      player.tx = clamp(ball.x + facing * drift, 0.03, 0.97);
      player.ty = clamp(ball.y + rng.float(-0.05, 0.05), 0.04, 0.96);
      recordCarry(state, world, player, side);
      commit(2.4, 'carry');
      return;
    }
    case 'hold': {
      player.tx = player.x;
      player.ty = player.y;
      commit(1.5, 'shield');
      return;
    }
    case 'pass': {
      const mate = selectPassTarget(state, world, player, rng, 'pass');
      if (mate) {
        const aim = aimWithError({ x: mate.x, y: mate.y }, accuracy);
        strikeBall(state, {
          from: { x: ball.x, y: ball.y },
          to: aim,
          kind: 'pass',
          speed: 0.2,
          targetId: mate.playerId,
          intendedSide: side,
          loft: false,
          playerId: player.playerId,
          offsidePlayerId: inOffsidePosition(state, side, mate) ? mate.playerId : null,
        });
        commit(1.2, 'carry');
        recordPass(state, world, player, side, mate);
        return;
      }
      break;
    }
  }

  // No option at all: carry it, and think again in half a second.
  const facing = side === 'home' ? 1 : -1;
  player.tx = clamp(ball.x + facing * 0.1, 0.03, 0.97);
  player.ty = ball.y;
  recordCarry(state, world, player, side);
  commit(1.6, 'carry');
}

/**
 * Keep a pass out of the passer's own net.
 *
 * A misplaced backward pass or a loose square ball near his own goal could cross
 * his own line between the posts, which is an own goal — a real but rare thing
 * the football should earn, not something a pass-selection should produce several
 * times an afternoon. If the aim point would carry the ball through the mouth of
 * his own goal, it is pushed wide of the post.
 */
function guardOwnGoal(side: Side, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const line = ownGoalLine(side);
  const towardOwn = side === 'home' ? to.x < from.x : to.x > from.x;
  if (!towardOwn) return to;
  const crosses = side === 'home' ? from.x > line && to.x <= line : from.x < line && to.x >= line;
  if (!crosses) return to;
  const t = (line - from.x) / (to.x - from.x);
  const yAt = from.y + (to.y - from.y) * t;
  if (yAt <= 0.5 - GOAL_HALF_WIDTH + 0.012 || yAt >= 0.5 + GOAL_HALF_WIDTH - 0.012) return to;
  const margin = GOAL_HALF_WIDTH + 0.035;
  return { x: to.x, y: yAt < 0.5 ? 0.5 - margin : 0.5 + margin };
}

/** Which side of a man a point is, or 0 when it is level with him. */
function mateSide(ay: number, by: number): number {
  if (Math.abs(ay - by) < 1e-4) return 0;
  return ay > by ? 1 : -1;
}

/**
 * A stand-in player for an id the environment cannot resolve.
 *
 * Never reached with a real environment — a lineup names players that exist — but
 * a test may build a match without a full world, and a decision model that throws
 * on a missing player would be a poor thing to hand one.
 */
function placeholderPlayer(player: PlayerMatchState) {
  const flat = { passing: 10, shooting: 10, tackling: 10, ballControl: 10, crossing: 10, heading: 10, goalkeeping: 1 } as const;
  return {
    id: player.playerId,
    kind: 'player',
    attributes: {
      technical: flat,
      physical: { pace: 10, stamina: 10, strength: 10, agility: 10 },
      mental: { positioning: 10, decisions: 10, composure: 10, workRate: 10, determination: 10 },
      behavioural: { commitment: 10, discipline: 10, ambition: 10, loyalty: 10, reliability: 10 },
      hidden: {
        consistency: 10,
        adaptability: 10,
        pressureResponse: 10,
        tacticalIntelligence: 10,
        injurySusceptibility: 10,
        temperament: 10,
      },
    },
    form: 50,
    fitness: 100,
    positionalFamiliarity: {},
    preferredPosition: player.position,
  } as unknown as Parameters<typeof playerEffectiveness>[0];
}

/** A player's name, as a report writes it — enough to tell two men apart. */
function shortName(world: DecisionWorld, playerId: string | null): string {
  if (!playerId) return 'a teammate';
  const player = world.env.getPlayer(playerId);
  return player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'a teammate';
}

/**
 * Record a pass on the man and his side, and write it down.
 *
 * The event is the ordinary texture of the match — the thing the passage is made
 * of — so it is the lowest importance and no incident. It names the target when
 * there is one, which is what lets the commentary and a passage read as a move
 * rather than a series of anonymous kicks.
 */
function recordPass(
  state: MatchEngineState,
  world: DecisionWorld,
  player: PlayerMatchState,
  side: Side,
  target?: PlayerMatchState | null,
): void {
  const performance = world.match.performances[player.playerId];
  if (performance) performance.passes += 1;
  (side === 'home' ? state.stats.home : state.stats.away).passes += 1;
  emitEvent(state, world.match, {
    type: 'pass',
    side,
    playerId: player.playerId,
    secondaryPlayerId: target?.playerId ?? null,
    text: target
      ? `${shortName(world, player.playerId)} to ${shortName(world, target.playerId)}.`
      : `${shortName(world, player.playerId)} plays it forward.`,
    x: state.ball.x,
    y: state.ball.y,
    importance: 1,
  });
}

/** Write down a carry — a man driving the ball himself. */
function recordCarry(
  state: MatchEngineState,
  world: DecisionWorld,
  player: PlayerMatchState,
  side: Side,
  beaten?: PlayerMatchState | null,
): void {
  emitEvent(state, world.match, {
    type: 'carry',
    side,
    playerId: player.playerId,
    // The man beaten, when there was one, so the commentary can name him the
    // same way a pass names its target.
    secondaryPlayerId: beaten?.playerId ?? null,
    text: beaten
      ? `${shortName(world, player.playerId)} beats ${shortName(world, beaten.playerId)}.`
      : `${shortName(world, player.playerId)} carries.`,
    x: state.ball.x,
    y: state.ball.y,
    importance: 1,
  });
}

/** Record a shot on the man and his side. */
function recordShot(state: MatchEngineState, world: DecisionWorld, player: PlayerMatchState, side: Side): void {
  const performance = world.match.performances[player.playerId];
  if (performance) performance.shots += 1;
  (side === 'home' ? state.stats.home : state.stats.away).shots += 1;
}
