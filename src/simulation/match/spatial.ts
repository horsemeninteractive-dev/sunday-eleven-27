import type {
  BallSpatial,
  Celebration,
  CommentaryEvent,
  Match,
  MatchAction,
  MatchEvent,
  MatchSpatial,
  Passage,
  PassageOutcome,
  PassageStep,
  PlayerSpatial,
  PossessionPlan,
  PossessionStep,
  TeamShape,
} from '@/domain/match';
import type { Player } from '@/domain/person';
import { getFormation, type PositionCode } from '@/domain/positions';
import type { PlayerId } from '@/domain/ids';
import type { RestartState } from '@/domain/matchState';
import type { Rng } from '../rng';
import type { MatchEnvironment } from './engine';
import {
  SIMULATION_STEP_SECONDS,
  ARRIVAL_RADIUS,
  RESTING_SPEED,
  advanceMovement,
  actionIsDue,
  advanceSimulationSteps,
  beginAction,
  clearActions,
  resolveAction,
  simulationAlpha,
  syncPlayerActions,
} from './state';
import { isDelivery, isOnBall, type TimelineAction } from './actionTimeline';
import {
  CARRY_SECONDS,
  PASS_SPEED,
  SHOT_SECONDS,
  SHOT_SPEED,
  buildPossessionPlan,
  currentStep,
} from './continuousPossession';
import { recordKeyframe } from './recording';
import { setupExpired, setupPhase, restartPositionFor, type RestartGeometry } from './restarts';
import type { PossessionChain } from './possession';
import { defaultRoleFor, roleProfile, type Role, type RoleProfile } from './roles';
import { lineSlotFor, linesFor, progressOf, widthFor, xFromProgress } from './field';

/**
 * The match as it happens in space.
 *
 * The engine above this decides the football — who shoots, who is booked, what
 * the score is — one minute at a time, exactly as it always has. This layer is
 * the execution of those decisions: twenty-two players who own a position each
 * and walk toward the one the simulation has picked for them, and a ball that
 * is either at somebody's feet, travelling, or loose on the grass. Nothing here
 * can change an outcome. A goal was already a goal before the ball started
 * moving toward the net.
 *
 * Positions are fractions of the pitch, 0..1 along each side, with the home side
 * always attacking toward x = 1 and the away side toward x = 0 — the same frame
 * the pitch is drawn in, so a renderer only has to place what it is given.
 *
 * ## One path: the possession plan
 *
 * There is exactly one way the pitch is told what to play. The engine's
 * decisions arrive as a queue of possession plans and are executed continuously:
 * the carrier moves, the ball is played to a receiver, the ball travels, the
 * receiver gathers it, and the next chain begins from wherever it ended up.
 * Everything the picture does comes from the authoritative player, ball and
 * action state this layer advances.
 *
 * There used to be a second path — a passage replayed out of the minute's
 * decisions (`applyMinuteSpatial`, `advancePassage`). It is gone: the converted
 * path covers every watched minute, and the passage survives only as the
 * narrator's *description* of the same chains, built by {@link planMinutePassage}
 * and never executed here. A phrase in this file that still says "passage" is
 * about the words, not the football.
 */

/**
 * Seconds of match time one match minute is played out over.
 *
 * Sixty, because the pitch clock *is* the match clock: one spatial second is one
 * second of football, the same second the decisions were made in. It used to be
 * six — a ten-to-one compression that let a whole match be watched in nine
 * minutes, but meant the picture could only ever show a fraction of the football
 * that had been decided, and had to throw the rest away. Watching a match faster
 * is the speed controls' job now; the clock stays honest.
 */
export const SPATIAL_SECONDS_PER_MINUTE = 60;
/**
 * The fixed step the simulation is advanced in, so outcomes cannot depend on
 * frame rate. The canonical constant is the contract's
 * {@link SIMULATION_STEP_SECONDS}; this name is kept for the renderers and tests
 * that were written against it.
 */
export const SPATIAL_STEP_SECONDS = SIMULATION_STEP_SECONDS;
/**
 * The most movement one call may spend.
 *
 * Enough to catch up a minute and a half of football, so the fastest speed on a
 * slow screen still shows the move the clock is on; small enough that a tab
 * returning from the background does not replay the match in a single jolt.
 */
const SPATIAL_MAX_CATCH_UP_SECONDS = SPATIAL_SECONDS_PER_MINUTE * 1.5;
const SPATIAL_MAX_STEPS = Math.ceil(SPATIAL_MAX_CATCH_UP_SECONDS / SPATIAL_STEP_SECONDS) + 1;

/** A loose ball slows to a stop over this per second. */
const LOOSE_FRICTION = 0.5;
/**
 * How near the carrier a man has to be before he offers beyond his place.
 *
 * Beyond this he simply holds his position, and the offer fades to nothing
 * exactly at the edge rather than stopping dead — see the closing-down notes in
 * `playerTarget` for why the shape and the support are one movement and not two.
 */
const SUPPORT_RANGE = 0.26;
/** How far beyond his place, at his most eager, a man pushes to offer. */
const SUPPORT_FORWARD = 0.055;

/**
 * How far the ball must move before a support offer is reconsidered, and how
 * much of the cached offer is applied to the finished target.
 *
 * The first number is what stops the offer being re-decided on every wobble of a
 * ball that is being carried — a ball moves continuously, so "has it moved" has
 * to mean "has it moved a real distance" or the caching buys nothing. The second
 * is deliberately not 1: the offer is one input among several to the finished
 * target rather than the whole of it, so a cached offer cannot hold a man in a
 * position the rest of the model has moved on from.
 */
const OFFER_RECOMPUTE = 0.03;

const OFFER_APPLY = 1;

/**
 * How close the ball has to be for it to be *his* problem rather than the
 * problem of whoever is nearer.
 *
 * Wider than the distance a man is considered to be offering support from,
 * deliberately. Offering support is a choice about where to stand; being within
 * reach of the ball is not a choice at all, and a player who has chosen to stand
 * still is still obliged to go for a ball rolling past him. Using the support
 * distance here left resting men asleep within a yard of the ball.
 */
const BALL_REACH = SUPPORT_RANGE * 1.5;

/**
 * How close a travelling ball has to be to its target before it simply arrives.
 *
 * A fraction of an inch, and it exists so that "distance <= one step of travel"
 * can never be the only test. A ball struck over a long enough duration flies
 * slowly enough that the last inch of its journey takes longer than the match,
 * which is how a shot ends up frozen in mid-air.
 */
const BALL_ARRIVAL_EPSILON = 0.01;

/** And how far to the outside he moves to make the room. */
const SUPPORT_SIDEWAYS = 0.05;
/**
 * How eagerly a side steps up as the ball moves into the half it is attacking.
 *
 * Saturates well before the far end of the pitch, so the shape responds to
 * where the ball is without the whole side drifting upfield behind a long pass.
 */
const SHAPE_ADVANCE = 0.25;

/** How far a role's depthBias can move a man off his slot's base line. */
const ROLE_DEPTH_SCALE = 0.6;

/**
 * How far a role's widthBias can move a man across the pitch.
 *
 * Sized against the widthBias scale rather than picked for feel: the widest gap
 * in the table is a winger (0.9) against an inverted winger (0.3), and at 0.06
 * that difference came out at 0.038 of a pitch — too small to read on a
 * broadcast and, worse, too small for a test to insist on. At 0.14 the same pair
 * differ by about 0.09, which is roughly the difference between a winger holding
 * the touchline and one cutting inside onto the same grass as everybody else.
 */
const ROLE_WIDTH_SCALE = 0.14;

/**
 * The width a side is drawn at nominally, and the one `shape.width` is measured
 * against. A side at 1.0 uses the full pitch; below that it narrows, above it
 * stretches. Without a nominal to divide by, `width` would be an absolute
 * distance from the centre rather than a scale, and a narrow side would still
 * leave its full-back on the touchline.
 */
const NOMINAL_WIDTH = 0.68;

/** How far the whole block leans across the pitch toward the ball, at full orientation. */
const SHAPE_LEAN = 0.12;

/**
 * How fast a block travels toward the shape it is supposed to be holding, in
 * fractions of the pitch per second, and how close counts as arrived.
 *
 * This is the difference between a shape and a jump cut. A side that has just
 * lost the ball really does want to be a long way from where it was, and the
 * model is right to say so — but a block that reaches its new shape in one frame
 * is not defending, it is being redrawn. At this rate a side crosses about a
 * fifth of the pitch in a second, which is faster than a back line actually moves
 * and far slower than a teleport.
 */
const SHAPE_EASE_RATE = 0.22;

/** Within this distance of the shape's answer, stop easing and simply stand there. */
const SHAPE_EASE_SNAP = 0.004;
/**
 * How long the pitch spends on a goal.
 *
 * Long enough to see the scorer get away and be caught, short enough that it
 * does not swallow the rest of the match: the clock is honest now, so this is
 * four seconds of the match rather than a fraction of the minute it used to be
 * played inside.
 */
const CELEBRATION_SECONDS = 4;

/**
 * The frame a goal is: the band of the goal line a keeper guards.
 *
 * Anywhere in here is on target and is a goal if it is not met; outside it the
 * ball is wide. Kept as a pair of constants so the shot, the keeper's dive and
 * the "off target" aim all agree on where the goal actually is.
 */
const GOAL_MOUTH_MIN = 0.3;
const GOAL_MOUTH_MAX = 0.7;

/**
 * How close a man has to be to have a shot come to him rather than past him.
 *
 * This is a claim radius, not a physics engine: a keeper inside it has the ball
 * in his hands, a defender inside it has got a foot to it. It is small enough
 * that the ball's arrival and the man's own movement are never far apart, so the
 * change of possession is a gather rather than a jump across the goalmouth.
 */
const SHOT_CLAIM_RADIUS = 0.02;

/**
 * The least time a step may be given, however thin the chain's budget has got.
 *
 * A step must be long enough for its action to be opened and closed at the
 * fixed step the simulation runs on, so a budget spent down to nothing still
 * lets the last move be played rather than skipping it.
 */
const MIN_STEP_SECONDS = 0.2;

const SIDES: readonly ('home' | 'away')[] = ['home', 'away'];

const SHOT_TYPES = new Set(['goal', 'penalty-scored', 'penalty-missed', 'shot-saved', 'shot-blocked', 'shot-off-target']);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The home side attacks toward x = 1 for the whole match, so the picture never flips. */
function orient(side: 'home' | 'away', x: number, y: number): { x: number; y: number } {
  return side === 'home' ? { x, y } : { x: 1 - x, y: 1 - y };
}

function attackDirection(side: 'home' | 'away'): number {
  return side === 'home' ? 1 : -1;
}

function clubIdOf(match: Match, side: 'home' | 'away'): string {
  return side === 'home' ? match.homeClubId : match.awayClubId;
}

/** Where a role likes to be on the ball: the middle and the front get it most. */
function roleWeight(position: PositionCode): number {
  switch (position) {
    case 'CM':
    case 'AM':
      return 3;
    case 'DM':
      return 2.2;
    case 'RM':
    case 'LM':
    case 'RW':
    case 'LW':
      return 2.4;
    case 'ST':
      return 2;
    default:
      return 1;
  }
}

/**
 * How fast a player moves, from the legs he has and what is left in them.
 *
 * A pitch-length per simulation second would be sprinting; these numbers are
 * deliberately small because a minute of football is played out over a handful
 * of simulation seconds, and players should drift and close down rather than
 * teleport across the park.
 */
function playerSpeed(player: Player | undefined, energy: number): number {
  const pace = player?.attributes.physical.pace ?? 10;
  const freshness = clamp(energy / 100, 0.5, 1);
  return (0.018 + pace * 0.0018) * (0.68 + 0.32 * freshness);
}

function ballSpatial(x: number, y: number): BallSpatial {
  return {
    x,
    y,
    px: x,
    py: y,
    tx: x,
    ty: y,
    status: 'loose',
    ownerId: null,
    targetId: null,
    speed: 0,
    height: 0,
    touchedAt: 0,
    lastTouchId: null,
  };
}

function playerOf(spatial: MatchSpatial, id: PlayerId | null | undefined): PlayerSpatial | undefined {
  if (!id) return undefined;
  return spatial.players.find((node) => node.playerId === id);
}

/** A player's place on the pitch, from the slot he was picked in. */
function placePlayer(
  match: Match,
  env: MatchEnvironment,
  side: 'home' | 'away',
  playerId: PlayerId,
  position: PositionCode,
  index: number,
  role?: Role,
): PlayerSpatial {
  const formation = getFormation(match.lineups[side].tactics.formation);
  const slot = formation.slots[index] ?? formation.slots[0]!;
  const base = orient(side, slot.x, slot.y);
  const player = env.getPlayer(playerId);
  const energy = match.performances[playerId]?.energy ?? player?.fitness ?? 100;
  return {
    playerId,
    side,
    position,
    role: role ?? defaultRoleFor(position),
    baseX: base.x,
    baseY: base.y,
    x: base.x,
    y: base.y,
    px: base.x,
    py: base.y,
    tx: base.x,
    ty: base.y,
    speed: playerSpeed(player, energy),
    vx: 0,
    vy: 0,
    action: 'shape',
    actionKind: null,
    actionStartedAt: null,
    actionEndsAt: null,
    possession: false,
  };
}

/**
 * Build the spatial state from the teams on the pitch, if it is not there yet.
 *
 * This is also how an old save grows the pitch underneath it: the lineups and
 * the formations are already stored, so the players can be placed from them
 * whenever the state is first asked for.
 */
/**
 * Grow the contract's fields onto a spatial state that predates them.
 *
 * A save written before the continuous contract existed still holds a spatial
 * state, with players and a ball but no action list or context. It is not
 * versioned: the missing fields are added here, in place, the first time the
 * state is asked for — which is also what keeps a v9 save loading unchanged.
 */
function normaliseSpatial(match: Match, spatial: MatchSpatial): MatchSpatial {
  if (typeof spatial.stepSeconds !== 'number') spatial.stepSeconds = SIMULATION_STEP_SECONDS;
  if (!Array.isArray(spatial.actions)) spatial.actions = [];
  if (!Array.isArray(spatial.pending)) spatial.pending = [];
  if (typeof spatial.residual !== 'number') spatial.residual = 0;
  if (typeof spatial.clock !== 'number') spatial.clock = 0;
  if (!spatial.context) {
    const owner = spatial.players.find((node) => node.playerId === spatial.ball.ownerId);
    spatial.context = {
      possession: owner?.side ?? null,
      phase: match.field?.phase ?? 'kickoff',
      eventCount: match.events.length,
    };
  }
  for (const node of spatial.players) {
    if (typeof node.possession !== 'boolean') node.possession = spatial.ball.ownerId === node.playerId;
    if (typeof node.vx !== 'number') node.vx = 0;
    if (typeof node.vy !== 'number') node.vy = 0;
    if (node.actionKind === undefined) {
      node.actionKind = null;
      node.actionStartedAt = null;
      node.actionEndsAt = null;
    }
  }
  if (typeof spatial.ball.touchedAt !== 'number') {
    spatial.ball.touchedAt = 0;
    spatial.ball.lastTouchId = null;
  }
  if (!spatial.pressing) spatial.pressing = { home: null, away: null };
  return spatial;
}

/** Every outfield player's role, by id, from the two line-ups. */
function rolesOnPitch(match: Match): Partial<Record<PlayerId, Role>> {
  const roles: Partial<Record<PlayerId, Role>> = {};
  for (const side of SIDES) {
    for (const slot of match.lineups[side].starting) roles[slot.playerId] = slot.role;
  }
  return roles;
}

/** How much further than he is this man's role makes him count, when picking a presser. */
function pressDemotion(spatial: MatchSpatial, node: PlayerSpatial): number {
  return roleFor(spatial, node).pressBehaviour === 'hold' ? HOLD_PRESS_DEMOTION : 0;
}

/** What a player on the pitch is for, or his position's default if unknown. */
function roleFor(spatial: MatchSpatial, node: PlayerSpatial): RoleProfile {
  const role = spatial.roles?.[node.playerId];
  return roleProfile(role ?? defaultRoleFor(node.position));
}

/**
 * The role a node is playing, without needing the spatial state.
 *
 * `shapePositionFor` is deliberately pure so it can be called with a node and a
 * shape and nothing else, which means it cannot reach back through the spatial
 * state for the role. The role is carried on the node's lineup slot instead, and
 * this falls back to the position's default when it is missing.
 */
function roleForNode(node: PlayerSpatial): RoleProfile {
  return roleProfile(node.role ?? defaultRoleFor(node.position));
}

/**
 * The shape this player's own side is holding right now.
 *
 * Read off the spatial state rather than recomputed, because the decision layer
 * is the only thing that knows who has the ball and how late it is, and the two
 * must not disagree: a picture that showed the old arrangement because nobody
 * updated it would be exactly the "diagram" this model exists to stop being.
 */
function shapeForNode(spatial: MatchSpatial, node: PlayerSpatial): TeamShape | null {
  return spatial.shapes?.[node.side] ?? null;
}

/**
 * Where a man stands, given his slot, his role and the shape his side is in.
 *
 * Pure, and that is the point of it. Everything that decides *where a player
 * should be* is here and nowhere else, which is what makes it testable: the
 * claim that a winger stays wide, or that a back four steps up together, is a
 * claim about this function and can be checked by calling it, rather than a
 * claim about a rendered picture.
 *
 * The three inputs compose in a fixed order, and the order matters:
 *
 *  - **The shape sets the line.** The player's slot is measured against the
 *    reference lines to find which one he belongs to and how far off it he sits,
 *    and the live line height is then substituted underneath him. This is what
 *    moves a back four as a back four: they are all measured from the same
 *    reference, so when the lines step up they step up together.
 *  - **The role shifts him along and across.** A poacher is higher than the
 *    front line he belongs to; a false nine is lower. A winger is further from
 *    the centre than the slot is; an inverted winger is not. This is applied
 *    after the line, because a role is a preference *about a position within the
 *    shape* and applying it first would have it dragged back toward the shape it
 *    was meant to be adjusting.
 *  - **The block leans.** `ballOrientation` slides the whole block toward the
 *    ball's flank and `width` stretches or narrows it. Applied last and to
 *    everybody alike, so the block moves as a block — which is the whole
 *    difference between a team shifting across the pitch and eleven men
 *    independently deciding to.
 */
/**
 * Where the shape wants this player, reached rather than arrived at.
 *
 * The shape's answer can move a long way in a single frame, most sharply when
 * possession changes hands — the two sets of heights genuinely differ, by design,
 * so the model is right and the picture would still jump. This is where that is
 * resolved: each player keeps a position of his own and walks it toward the
 * shape's answer at a bounded rate, so a turnover is a side stepping up or
 * dropping rather than twenty-two men teleporting on the same frame.
 *
 * The rate is a fraction of the pitch per second, and it is deliberately slow
 * enough that a block cannot cross more than a third of the pitch in the second
 * a possession turns over — a side that has just lost the ball does not appear
 * to teleport across halfway.
 */
function easedShapePosition(
  spatial: MatchSpatial,
  node: PlayerSpatial,
  shape: TeamShape | null,
  ball: { x: number; y: number },
  inPossession: boolean,
): { x: number; y: number } {
  const wanted = shapePositionFor(node, shape, ball, inPossession);
  // No shape yet: the slot is the honest answer, and there is nothing to ease.
  if (!shape) return wanted;

  const current = { x: node.shapeX ?? wanted.x, y: node.shapeY ?? wanted.y };
  const step = SHAPE_EASE_RATE * Math.max(spatial.stepSeconds, SIMULATION_STEP_SECONDS);
  const dx = wanted.x - current.x;
  const dy = wanted.y - current.y;
  const gap = Math.hypot(dx, dy);
  // Close enough to stop chasing, or the block jitters forever around the target.
  if (gap <= SHAPE_EASE_SNAP) {
    node.shapeX = wanted.x;
    node.shapeY = wanted.y;
    return wanted;
  }
  const travel = Math.min(gap, step);
  const eased = { x: current.x + (dx / gap) * travel, y: current.y + (dy / gap) * travel };
  node.shapeX = eased.x;
  node.shapeY = eased.y;
  return eased;
}

export function shapePositionFor(
  node: PlayerSpatial,
  shape: TeamShape | null,
  ball: { x: number; y: number },
  inPossession: boolean,
): { x: number; y: number } {
  // No shape yet — the decision layer has not run. The slot is the honest answer.
  if (!shape) return { x: node.baseX, y: node.baseY };

  const role = roleForNode(node);
  const progress = progressOf(node.side, node.baseX);
  const { line, offset } = lineSlotFor(progress);
  const lines = linesFor(shape, { inPossession, progress: progressOf(node.side, ball.x) });

  // Depth: the live line, plus where this slot sits within it, plus the role.
  const facing = attackDirection(node.side);
  const shapedProgress =
    lines[line] + offset + facing * role.depthBias * ROLE_DEPTH_SCALE;
  const x = xFromProgress(node.side, clamp(shapedProgress, 0.02, 0.98));

  // Width: the slot's distance from the centre circle, stretched by how wide the
  // side currently is, then pushed by the role's own opinion about it.
  //
  // The stretch is relative to a nominal 0.68 rather than absolute, so `width` of
  // 1.0 is a side using the full pitch and anything below narrows it — otherwise
  // a narrow side would still stand on the touchline, which is the exact failure
  // this whole change exists to fix.
  const spread = widthFor(shape, inPossession) / NOMINAL_WIDTH;
  const slotOffset = node.baseY - 0.5;
  const roleSpread = slotOffset + facing * role.widthBias * ROLE_WIDTH_SCALE;

  // The block leans toward the ball's flank, and leans further the harder it is
  // told to orient. Every man in the block gets the same lean, so the side moves
  // across the pitch together rather than compressing onto the ball.
  const lean = shape.ballOrientation * (ball.y - 0.5) * SHAPE_LEAN;

  const y = 0.5 + roleSpread * spread + lean;
  return { x, y: clamp(y, 0.03, 0.97) };
}

export function ensureSpatial(match: Match, env: MatchEnvironment): MatchSpatial {
  if (match.spatial) return normaliseSpatial(match, match.spatial);

  const players: PlayerSpatial[] = [];
  for (const side of SIDES) {
    match.lineups[side].starting.forEach((slot, index) => {
      players.push(placePlayer(match, env, side, slot.playerId, slot.position, index, slot.role));
    });
  }

  match.spatial = {
    players,
    roles: rolesOnPitch(match),
    shapes: match.field ? { home: match.field.homeShape, away: match.field.awayShape } : {},
    ball: ballSpatial(0.5, 0.5),
    clock: 0,
    stepSeconds: SIMULATION_STEP_SECONDS,
    residual: 0,
    actions: [],
    context: { possession: null, phase: match.field?.phase ?? 'kickoff', eventCount: match.events.length },
    plan: null,
    pending: [],
    celebration: null,
    pressing: { home: null, away: null },
  };
  return match.spatial;
}

/**
 * Follow the teams on the pitch.
 *
 * Substitutions and red cards change who is out there, and the spatial layer
 * has to change with them or it would keep drawing a man who has already gone
 * to the changing room. A substitute comes on where his slot stands; a man who
 * has left takes nothing with him.
 */
export function syncSpatial(match: Match, env: MatchEnvironment): void {
  const spatial = match.spatial;
  if (!spatial) return;

  // The shape is copied in from the decision layer, which is the only thing that
  // knows who has the ball and how late it is. Copied rather than recomputed so
  // the picture can never disagree with the decisions about what the side is
  // doing — and refreshed every sync, because a shape that was right a minute ago
  // is not a shape.
  if (match.field) {
    const shapes = (spatial.shapes ??= {});
    shapes.home = match.field.homeShape;
    shapes.away = match.field.awayShape;
  }

  for (const side of SIDES) {
    const starting = match.lineups[side].starting;
    const onPitch = new Set(starting.map((slot) => slot.playerId));
    for (let index = spatial.players.length - 1; index >= 0; index -= 1) {
      const node = spatial.players[index]!;
      if (node.side === side && !onPitch.has(node.playerId)) spatial.players.splice(index, 1);
    }
    starting.forEach((slot, index) => {
      if (spatial.players.some((node) => node.playerId === slot.playerId)) return;
      const placed = placePlayer(match, env, side, slot.playerId, slot.position, index, slot.role);
      // He comes on where the shape says, not from the centre circle.
      placed.x = placed.baseX;
      placed.y = placed.baseY;
      placed.px = placed.x;
      placed.py = placed.y;
      spatial.players.push(placed);
    });
  }

  // If the ball belonged to somebody who has just left the pitch, it is loose.
  const stillOn = (id: PlayerId | null): boolean => Boolean(id) && spatial.players.some((node) => node.playerId === id);
  if (spatial.ball.ownerId && !stillOn(spatial.ball.ownerId)) {
    spatial.ball.ownerId = null;
    spatial.ball.status = 'loose';
    spatial.ball.speed = 0;
  }
  if (spatial.ball.targetId && !stillOn(spatial.ball.targetId)) {
    spatial.ball.targetId = null;
  }

  // A possession chain that names a man who has just left is over with him: the
  // ball he was going to receive is not going to reach him, and a substitute is
  // not part-way through somebody else's move.
  const namesDeparted = (entry: PossessionPlan): boolean =>
    entry.steps.some((step) => !stillOn(step.playerId) || (step.targetPlayerId && !stillOn(step.targetPlayerId)));
  // The chains still waiting their turn lose the same men, before anything is
  // allowed to start the next one.
  if (spatial.pending) spatial.pending = spatial.pending.filter((entry) => !namesDeparted(entry));
  const plan = spatial.plan;
  if (plan && namesDeparted(plan)) {
    spatial.plan = null;
    clearActions(spatial);
    // The rest of the minute's football is still to be played, so the next chain
    // takes the pitch rather than the minute ending on a substitution.
    dropPlan(match);
  }

  // A celebration led by a man who has just been taken off is over with him.
  if (spatial.celebration && !stillOn(spatial.celebration.scorerId)) spatial.celebration = null;
}

/**
 * Advance the match by the real time that has passed, in fixed steps.
 *
 * Time arrives from the browser in however large or small a slice it feels
 * like, and this spends it a step at a time, carrying what is left over. That
 * is what keeps a match played on a slow machine identical in outcome to one
 * played on a fast one: the number of steps a given span of football takes is
 * fixed, not a consequence of how often the browser happened to draw.
 */
export function advanceSpatial(match: Match, env: MatchEnvironment, deltaSeconds: number): void {
  const spatial = match.spatial;
  if (!spatial || deltaSeconds <= 0) return;
  // A tab left in the background can hand over a huge delta; a match should
  // resume where it was, not sprint to catch up on minutes nobody watched. The
  // ceiling is generous, though, because at the fastest speed a single frame is
  // worth well over a second of movement — the picture must be able to keep up
  // with the clock rather than drifting behind it.
  //
  // How many steps that is, and how much is carried, is the contract's
  // arithmetic; taking them is this layer's. Render frequency and presentation
  // speed never appear here — they are the caller's, and they only decide how
  // often this is called and with what multiplier.
  const plan = advanceSimulationSteps(spatial, deltaSeconds, {
    maxCatchUpSeconds: SPATIAL_MAX_CATCH_UP_SECONDS,
    maxSteps: SPATIAL_MAX_STEPS,
  });
  for (let step = 0; step < plan.steps; step += 1) {
    stepSpatial(match, env, spatial.stepSeconds);
  }
}

/**
 * How far into the next step the simulation has got, 0..1.
 *
 * The renderer uses this to draw between where a player was and where he is,
 * so movement is smooth without the simulation having to run per frame.
 */
export function spatialAlpha(spatial: MatchSpatial | undefined): number {
  if (!spatial) return 0;
  return simulationAlpha(spatial);
}

/**
 * How much nearer a challenger must be before he takes the closing-down job.
 *
 * Six inches of a pitch. It is only there to stop the handover, not to decide
 * it: a man who is genuinely nearer the ball takes over immediately, and a tie
 * that is this small keeps whoever already has it.
 */
const PRESSING_HANDOFF_MARGIN = 0.06;

/**
 * How much further a holding role must be from the ball before he will take
 * the pressing job on. A striker who is meant to stay on the shoulder should
 * not be dragged thirty yards out of shape because he happened to be the
 * nearest body when the ball turned over; he presses anyway if nobody who
 * wants the job is anywhere near it.
 */
const HOLD_PRESS_DEMOTION = 0.09;

/**
 * Decide who is closing the ball down for each side, and keep it decided.
 *
 * Re-deciding this every step is what made the picture buzz. Two defenders
 * jostle for the same job; the nearer one changes by a hair from step to step;
 * and the frame after each handover the loser is told to hold shape instead,
 * so he is sent to the far side of the pitch and back again — dozens of times a
 * minute, and faster than the eye can follow as anything but a vibration.
 *
 * So the job is held. The incumbent keeps it until a teammate is clearly
 * nearer, and it is released outright when the ball changes side, when the
 * incumbent is no longer out there, or when nobody has the ball to press.
 */
function assignPressers(spatial: MatchSpatial, possessing: 'home' | 'away' | null): void {
  const pressing = (spatial.pressing ??= {});
  const ball = spatial.ball;

  if (!possessing) {
    // A ball nobody owns is not being pressed by anybody in particular.
    pressing.home = null;
    pressing.away = null;
    return;
  }

  for (const side of SIDES) {
    // The side with the ball does not press itself.
    if (side === possessing) {
      pressing[side] = null;
      continue;
    }

    const incumbentId = pressing[side] ?? null;
    const incumbent = incumbentId ? playerOf(spatial, incumbentId) : null;
    const incumbentDistance = incumbent ? Math.hypot(ball.x - incumbent.x, ball.y - incumbent.y) : Infinity;

    // A role that is meant to hold its place counts as further from the ball
    // than it is when *contesting* for the job, so a man who will actually go
    // and win it is preferred. It is a distance penalty rather than a filter,
    // so a holding striker still presses when nobody who wants the job is out
    // there.
    //
    // It is deliberately applied to the challengers only and not to the
    // incumbent. Applying it to both hands the job over far more readily, and
    // a turnover that reshuffles who is pressing is a turnover the whole side
    // visibly reacts to — which is the lurch this whole mechanism exists to
    // avoid. The incumbent keeps his job until someone is clearly nearer; what
    // the demotion changes is only who gets it in the first place.
    let challenger: PlayerSpatial | null = null;
    let challengerDistance = Infinity;
    for (const node of spatial.players) {
      if (node.side !== side || node.position === 'GK' || node.playerId === incumbentId) continue;
      const distance = Math.hypot(ball.x - node.x, ball.y - node.y) + pressDemotion(spatial, node);
      if (distance < challengerDistance) {
        challengerDistance = distance;
        challenger = node;
      }
    }
    // Compare like with like: the incumbent's raw distance is what the handoff
    // margin was tuned against, so the challenger's is grossed back up by
    // whatever his role cost him.
    const challengerRealDistance = challenger ? challengerDistance - pressDemotion(spatial, challenger) : Infinity;

    // Nobody new wants it, or the incumbent is still the right man: hold.
    if (!challenger) {
      pressing[side] = incumbent?.playerId ?? null;
      continue;
    }
    // A genuine change of man, or the incumbent has gone: hand it straight over.
    if (!incumbent || challengerRealDistance + PRESSING_HANDOFF_MARGIN < incumbentDistance) {
      pressing[side] = challenger.playerId;
      continue;
    }
    pressing[side] = incumbent.playerId;
  }
}

/**
 * The nearest player of the other side to a point.
 *
 * This is the man who reads a loose ball, meets an under-hit pass, or steps out
 * to block a shot. The simulation has already decided that the ball did not
 * reach its man; this only decides who the picture hands it to.
 */
function nearestOpponent(
  spatial: MatchSpatial,
  attackingSide: 'home' | 'away',
  x: number,
  y: number,
): PlayerSpatial | null {
  let best: PlayerSpatial | null = null;
  let bestDistance = Infinity;
  for (const node of spatial.players) {
    if (node.side === attackingSide) continue;
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

/** The keeper a side is shooting at. */
function defendingKeeper(spatial: MatchSpatial, attackingSide: 'home' | 'away'): PlayerSpatial | undefined {
  return spatial.players.find((node) => node.side !== attackingSide && node.position === 'GK');
}

/** How far a point is from a line segment, which is how far off the shot line a man is. */
function distanceToSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const along = closestPointOnSegment(point, from, to, 0, 1);
  return Math.hypot(point.x - along.x, point.y - along.y);
}

/** The point of a segment nearest a point, kept between two ends of it. */
function closestPointOnSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
  least: number,
  most: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const raw = lengthSquared > 0 ? ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared : 0;
  const t = clamp(raw, least, most);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/**
 * The defender who gets a foot to the shot.
 *
 * Not simply the nearest defender — that would be whoever happens to be standing
 * closest to the shooter, which is rarely the man in the way. It is the man
 * nearest the *line the ball will take*, which is the man who can actually block
 * it. The keeper is left out of it: a keeper is a save, not a block.
 */
function shotBlocker(
  spatial: MatchSpatial,
  attackingSide: 'home' | 'away',
  from: { x: number; y: number },
  goal: { x: number; y: number },
): PlayerSpatial | null {
  let best: PlayerSpatial | null = null;
  let bestDistance = Infinity;
  for (const node of spatial.players) {
    if (node.side === attackingSide || node.position === 'GK') continue;
    const distance = distanceToSegment(node, from, goal);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best;
}

/**
 * Where the keeper actually gets to the shot.
 *
 * The shot is struck at the goal, and the save is the keeper meeting it — so
 * where he meets it comes out of where he is standing and how fast he can get
 * across, over the time the ball is in the air. A shot he can reach is met at the
 * goal itself; one struck away from him is met on the way, as far across as his
 * legs allow. That is what makes a save a place rather than a sentence: he gets a
 * hand to it here, because he could, not because he was standing here when it
 * was hit.
 */
function savePoint(
  from: { x: number; y: number },
  keeper: PlayerSpatial,
  goal: { x: number; y: number },
): { x: number; y: number } {
  const flight = Math.hypot(goal.x - from.x, goal.y - from.y) / SHOT_SPEED;
  const reach = keeper.speed * flight + SHOT_CLAIM_RADIUS;
  const gap = Math.hypot(goal.x - keeper.x, goal.y - keeper.y);
  if (gap <= reach) return goal;
  // Short of it: he gets as far across as he can, and the ball is met there.
  const t = reach / gap;
  return { x: keeper.x + (goal.x - keeper.x) * t, y: keeper.y + (goal.y - keeper.y) * t };
}

/**
 * The pitch as the restart placement needs to see it.
 *
 * `restarts.ts` is deliberately free of this layer — it takes a handful of plain
 * objects and answers "where does this man stand for this restart", so it can be
 * tested without twenty-two men on a pitch. This is the adapter that answers its
 * whole-*team* questions (who is marked, who is at the near post, where the wall
 * spreads) from the live spatial state.
 *
 * Built once per step rather than per player: these answers are properties of the
 * side, and recomputing them for each of the eleven would be eleven chances to
 * disagree with itself.
 */
function restartGeometry(spatial: MatchSpatial, restart: RestartState): RestartGeometry {
  const attacking = restart.side;
  const outfield = (side: 'home' | 'away') =>
    spatial.players.filter((node) => node.side === side && node.position !== 'GK');

  // Left-to-right order, decided once, so "spread along the wall" is stable
  // rather than a function of the order the loop happens to walk the men in.
  const rankCache = new Map<PlayerId, number>();
  for (const side of ['home', 'away'] as const) {
    const ordered = outfield(side).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    ordered.forEach((node, index) => rankCache.set(node.playerId, index));
  }

  // The two men who matter to a corner: one at the near post, one at the far.
  // Chosen from the attacking side's actual positions rather than from position
  // codes, because a centre-half is as likely as a winger to be the man a routine
  // sends to the far post, and a code is not evidence.
  const byDistanceFromBall = (a: PlayerSpatial, b: PlayerSpatial) =>
    Math.hypot(a.x - restart.ballX, a.y - restart.ballY) - Math.hypot(b.x - restart.ballX, b.y - restart.ballY);
  const cornerAttackers = outfield(attacking).slice().sort(byDistanceFromBall);
  const nearPostId = cornerAttackers[0]?.playerId ?? null;

  // The pair a throw is going to: the taker and the nearest team-mate who can
  // actually receive it.
  const receiverId =
    restart.takerId === null
      ? null
      : (outfield(attacking).filter((node) => node.playerId !== restart.takerId).sort(byDistanceFromBall)[0]
          ?.playerId ?? null);

  // Marking pairs: each defender picks the attacking man nearest to him. Held
  // between them so the same man is not marked by two defenders while another
  // goes unmarked — a corner where everybody guards one man looks wrong precisely
  // because it *is* wrong.
  const markedCache = new Map<PlayerId, { x: number; y: number }>();
  const takenByMarker = new Set<PlayerId>();
  for (const node of outfield(attacking === 'home' ? 'away' : 'home').slice().sort((a, b) => b.y - a.y)) {
    const mate = outfield(attacking)
      .filter((candidate) => !takenByMarker.has(candidate.playerId))
      .sort((a, b) => Math.hypot(a.x - node.x, a.y - node.y) - Math.hypot(b.x - node.x, b.y - node.y))[0];
    if (mate) {
      takenByMarker.add(mate.playerId);
      markedCache.set(node.playerId, { x: mate.x, y: mate.y });
    }
  }

  return {
    rankOf: (player) => rankCache.get(player.playerId) ?? 0,
    markedMan: (player) => markedCache.get(player.playerId) ?? null,
    isNearPost: (player) => player.playerId === nearPostId,
    isReceiver: (player) => player.playerId === receiverId,
    // A wall is five men wide and spreads across the line to the goal. The
    // offset is signed so the two ends of it are genuinely at opposite ends
    // rather than both crowded onto the ball.
    wallOffset: (player) => ((rankCache.get(player.playerId) ?? 0) - 4.5) * 0.022,
  };
}

/**
 * Where a player wants to be.
 *
 * Shape comes first: he holds the position his formation gave him. The ball
 * then pulls him toward it by however much the situation justifies — the man
 * closing down is sent to the carrier, the side with the ball spreads out to
 * give the carrier options, and everyone leans up or drops off with possession.
 * It is a handful of rules rather than a model of understanding, which is the
 * point: the decisions that matter were already made above.
 */
function playerTarget(
  spatial: MatchSpatial,
  node: PlayerSpatial,
  possessing: 'home' | 'away' | null,
): { x: number; y: number } {
  const ball = spatial.ball;

  // A restart overrides everything else, because during one there is no football
  // to play. The man walking to the corner flag and the man forming the wall are
  // not supporting anybody or closing anybody down — they are going to where a
  // dead-ball routine says they go, and that is a more specific instruction than
  // any shape or support rule could give them.
  const restart = spatial.restart;
  if (restart && setupPhase(restart)) {
    const place = restartPositionFor(node, restart, restartGeometry(spatial, restart));
    if (place) return place;
    // No restart position means this man is not part of it, and his shape
    // position is already the right answer — which is the honest one, rather
    // than an invented spot.
  }

  // A ball coming to him is the one thing that overrides shape: he goes to meet
  // it, which is what makes a pass look like a pass.
  if (ball.status === 'travelling' && ball.targetId === node.playerId) {
    return { x: ball.tx, y: ball.ty };
  }

  // A shot that names him — the keeper who saves it, the man in the way who
  // blocks it — he goes to meet it too. The ball is met at the point those men
  // can actually reach, so if they did not move it would stop in front of them
  // and then jump into their feet; moving there is what makes it a gather.
  if (ball.status === 'travelling' && ball.targetId === null) {
    const meeting = spatial.actions.find(
      (entry) => entry.kind === 'shot' && entry.targetPlayerId === node.playerId,
    );
    if (meeting) return { x: ball.tx, y: ball.ty };
  }

  // The man playing out his own step goes where the step is pointed. On the
  // converted path that is the plan's own destination, so the carry goes where
  // the possession model decided it went rather than at the goal by default;
// the the ball goes with him because it is at his feet, and that is what carries
  // a move on between one minute and the next.
  //
  // The one exception is the moment before he has the ball. A carry begins with
  // the ball travelling to him, and until it arrives he is not carrying anything
  // — he is waiting for a pass. Aiming him at the step's destination during that
  // window makes him run away from the ball he is about to collect, and the
  // gather re-issues itself against his new position every step: the ball chases
  // a man who keeps moving, and the pair orbit each other instead of meeting. So
  // while the ball is on its way he goes to where it is arriving, and only once
  // it is at his feet does he take up the step's destination.
  const planStep = currentStep(spatial.plan);
  if (planStep?.playerId === node.playerId && planStep.kind === 'carry') {
    const gathering = ball.status === 'travelling' && ball.targetId === node.playerId;
    if (gathering) return { x: clamp(ball.tx, 0.02, 0.98), y: clamp(ball.ty, 0.03, 0.97) };
    return { x: clamp(planStep.toX, 0.02, 0.98), y: clamp(planStep.toY, 0.03, 0.97) };
  }

  // A man shielding the ball has no target to be given. He is where he chose to
  // stand, and the rest of the pitch going about its business around him is not
  // a reason to move him. Falling through to the shape instead meant his target
  // was rewritten every step as the ball and the men around it drifted — a third
  // of a target-a-second twitch on the one player the eye is already following.
  if (planStep?.playerId === node.playerId && planStep.kind === 'hold') {
    return { x: node.x, y: node.y };
  }

  // A man with the ball at his feet and nothing decided about him yet keeps the
  // target he already has. This is the gap between one chain ending and the next
  // being installed — a hold hands the ball back to the same player, and until
  // the next decision arrives he is holding it.
  //
  // The important word is *keeps*. Falling through to the shape sent him walking
  // off to his slot with the ball, which read as a man who had dropped it and was
  // drifting away from it. Snapping him to where he happens to be standing is no
  // better: that is a target written out of nothing, and it jumps as far as he has
  // travelled in the last step, which is exactly the twitch being measured. The
  // run he was on is over when the step says it is, not the moment the ball is
  // handed on, so he finishes walking to where he was already going.
  if (ball.status === 'controlled' && ball.ownerId === node.playerId && !planStep) {
    return { x: node.tx, y: node.ty };
  }

  // A keeper stays on his line and shuffles across with play — until the ball
  // is on its way at his goal, when he goes for it.
  if (node.position === 'GK') {
    const ownGoalX = node.side === 'home' ? 0 : 1;
    if (ball.status === 'travelling' && Math.abs(ball.tx - ownGoalX) < 0.12) {
      // A dive is bounded: he can get across his goal, not into the stands.
      const lowX = node.side === 'home' ? 0.01 : 0.94;
      const highX = node.side === 'home' ? 0.06 : 0.99;
      return { x: clamp(ball.tx, lowX, highX), y: clamp(ball.ty, 0.3, 0.7) };
    }
    const line = node.side === 'home' ? 0.05 : 0.95;
    return { x: line, y: clamp(0.5 + (ball.y - 0.5) * 0.3, 0.34, 0.66) };
  }

  // Where his role says he stands, not merely where his slot is. A poacher sits
  // on the shoulder, a false nine drops off to link, a target man holds his
  // ground, and none of them is found by looking at the position alone.
  //
  // The role is applied *inside* the shape rather than as an offset on top of
  // the finished target, because a role is a preference about where in the shape
  // a man stands: a poacher's depth has to move him relative to the back line
  // he is on, not relative to a number that does not know the back line moved.
  const shape = shapeForNode(spatial, node);
  const from = easedShapePosition(spatial, node, shape, ball, possessing === node.side);
  const distance = Math.hypot(ball.x - from.x, ball.y - from.y);

  // Closing down. Without this the picture is two teams holding shape while the
  // ball rolls past them, which is what made it read like a diagram. The job is
  // held between steps (see `assignPressers`) rather than re-decided here, so
  // one defender stays on the ball instead of two swapping places every frame.
  if (possessing !== null && possessing !== node.side && spatial.pressing?.[node.side] === node.playerId) {
    const ballOrCarrier = playerOf(spatial, ball.ownerId) ?? { x: ball.x, y: ball.y };
    return { x: clamp(ballOrCarrier.x, 0.03, 0.97), y: clamp(ballOrCarrier.y, 0.04, 0.96) };
  }

  // Support and shape are one movement, not a choice between two.
  //
  // The side with the ball gives the carrier somewhere to go — men near him push
  // beyond and to the outside instead of crowding the same blade of grass — and
  // everybody else holds his place with a light pull toward the ball. These used
  // to be two separate branches with a hard boundary between them, and that
  // boundary was a live wire: a man sitting near it was sent to one spot, then
  // the other, then the first again, as the ball drifted a few inches across the
  // line between them. That is a visible twitch every time it happened, and with
  // eleven men on a pitch it was happening constantly.
  //
  // So there is no boundary. How far beyond his place a man offers is weighted
  // by how near the carrier he is, and fades continuously from nothing at the
  // edge of the pitch to a full push alongside him. One movement, no seam to
  // cross, and so nothing to flip between.
  //
  // Which side he offers on is fixed by his base position, so it is a choice he
  // makes once rather than a coin toss re-flipped every step.
  const carrier = playerOf(spatial, ball.ownerId);
  const supporting = carrier !== undefined && possessing === node.side && ball.ownerId !== node.playerId;
  const { x: offerX, y: offerY } = supportOffer(node, ball, from, supporting);
  const offerSide = from.y >= 0.5 ? 1 : -1;

  const attraction = clamp(0.4 - distance * 0.9, 0.03, 0.32);
  // The shape leans with the ball rather than with who is holding it.
  //
  // Reading the lean off possession made the entire pitch lurch the instant the
  // ball changed hands: every man's mark jumped by the same 0.14 of a pitch on
  // the same frame, all twenty-two at once, which reads as the whole side
  // twitching in unison rather than as football. The ball's own position gives
  // the same idea — a side steps up while the ball is in the opposition's half
  // and drops while it is in their own — and it moves continuously, so a
  // turnover becomes a shift instead of a jump cut.
  const advance = attackDirection(node.side) * (ball.x - from.x) * SHAPE_ADVANCE;
  const x = from.x + clamp(advance, -0.05, 0.09) + (offerX - from.x) * OFFER_APPLY;
  const y = from.y + offerSide * (offerY - from.y) * OFFER_APPLY;
  return {
    x: clamp(x * (1 - attraction) + ball.x * attraction, 0.02, 0.98),
    y: clamp(y * (1 - attraction) + ball.y * attraction, 0.03, 0.97),
  };
}

/**
 * Where a player goes while a goal is being celebrated.
 *
 * The scorer breaks away with the ball in the net behind him; his own team
 * chase him down and ring him one by one; the side that conceded is left to
 * walk back for the kick-off. The keeper stays where he is, because a keeper
 * sprinting the length of the pitch is the one thing that would read as wrong.
 *
 * Nothing here touches the football: the score was decided the moment the ball
 * crossed the line, and this is only what the pitch does about it.
 */
function celebrationTarget(
  spatial: MatchSpatial,
  node: PlayerSpatial,
  celebration: Celebration,
): { x: number; y: number } {
  if (node.playerId === celebration.scorerId) {
    // Off to the corner of the goal he has just scored in, arms wide.
    return node.side === 'home' ? { x: 0.95, y: 0.08 } : { x: 0.05, y: 0.08 };
  }
  if (node.side !== celebration.side || node.position === 'GK') return { x: node.baseX, y: node.baseY };

  const scorer = playerOf(spatial, celebration.scorerId);
  if (!scorer) return { x: node.baseX, y: node.baseY };

  // Ringed, rather than piled on the same blade of grass: each man gets his own
  // place on the circle, ordered so the picture is the same every time.
  const mates = spatial.players.filter(
    (entry) => entry.side === celebration.side && entry.playerId !== celebration.scorerId && entry.position !== 'GK',
  );
  const order = Math.max(0, mates.findIndex((entry) => entry.playerId === node.playerId));
  const angle = (order / Math.max(1, mates.length)) * Math.PI * 2;
  return {
    x: clamp(scorer.x + Math.cos(angle) * 0.06, 0.03, 0.97),
    y: clamp(scorer.y + Math.sin(angle) * 0.075, 0.05, 0.95),
  };
}

/**
 * Move the celebration along, and end it when it has run its course.
 *
 * Returns the celebration the picture should still show, or null once it is
 * over — at which point the ball is sent back to the centre spot for the
 * restart, travelling rather than jumping, so nothing ever crosses the park
 * between one step and the next.
 */
function advanceCelebration(spatial: MatchSpatial, dt: number): Celebration | null {
  const celebration = spatial.celebration;
  if (!celebration) return null;
  celebration.elapsed += dt;
  if (celebration.elapsed < CELEBRATION_SECONDS) return celebration;

  spatial.celebration = null;
  const ball = spatial.ball;
  travelTo(spatial, { x: ball.x, y: ball.y }, { x: 0.5, y: 0.5 }, null, PASS_SPEED);
  return null;
}

/** Football stops, and the pitch has a goal to enjoy. */
function startCelebration(spatial: MatchSpatial, side: 'home' | 'away', scorerId: PlayerId): void {
  // The move that scored is over, and so is anything else already decided for
  // this chain. The queue is *not* touched: a goal is always the last chain of
  // its minute, so whatever is waiting is the football that comes after it —
  // throwing it away left the pitch with nothing to play for the rest of the
  // minute after every goal.
  spatial.plan = null;
  clearActions(spatial);
  spatial.celebration = { side, scorerId, elapsed: 0 };
}

/**
 * Move a player, with legs rather than a teleport.
 *
 * The maths lives in the deterministic state module ({@link advanceMovement}),
 * so it can be tested without a football match around it; all this layer decides
 * is that everyone moves once per fixed step.
 */
function moveToward(node: PlayerSpatial, dt: number, clock: number): void {
  advanceMovement(node, dt, clock);
}

/**
 * How long a man who has arrived stays put, in seconds.
 *
 * Drawn once from his role and his legs, not fixed, because a side that never
 * stood still and a side that stood too long are both wrong. A tired man settles
 * for longer — he is less able to start again — and a fresh one for less. The
 * range is deliberately under a second and a half: long enough to read as a man
 * standing, short enough that the ball is never genuinely out of play.
 */
function restSecondsFor(node: PlayerSpatial, energy: number): number {
  const role = roleForNode(node);
  // Holding and anchoring roles are the ones that are *supposed* to stand still.
  const settled = role.pressBehaviour === 'hold' ? 0.25 : 0;
  const tiredness = (1 - clamp(energy / 100, 0, 1)) * 0.35;
  const base = 0.4 + settled + tiredness;
  return clamp(base, 0.4, 1.4);
}

/**
 * Whether a resting player has been given a reason to move again.
 *
 * The four conditions, and only these four: the ball has come within reach of
 * him, his side has just won or lost it, a plan step has named him, or his rest
 * has run out. A resting player is not frozen — he is a player who has decided
 * there is nothing to do yet, and this is the list of things that change that.
 */
function restPulled(spatial: MatchSpatial, node: PlayerSpatial, ball: MatchSpatial['ball'], possessing: 'home' | 'away' | null): boolean {
  if (spatial.clock >= (node.restUntil ?? 0)) return true;
  // The ball is on top of him, whatever it is doing. A loose ball or one in
  // flight is the case that matters: a man standing still two feet from a loose
  // ball is not resting, he is the one thing standing between it and a goal, and
  // checking only `ownerId` left exactly that man asleep.
  const reach = Math.hypot(ball.x - node.x, ball.y - node.y);
  if (reach <= BALL_REACH) return true;
  // A side that has just won or lost the ball has to reorganise, and a man at
  // rest cannot reorganise.
  if (spatial.context.possession !== possessing) return true;
  // Somebody has told him to do something — anywhere in the chain, not just the
  // step currently under way.
  if (spatial.plan?.steps.some((entry) => entry.playerId === node.playerId)) return true;
  if (spatial.actions.some((action) => action.playerId === node.playerId)) return true;
  // The ball is his, and the ball being his is itself a reason to move: a man
  // with the ball and nothing decided for him cannot stand still, or the ball
  // stands still with him.
  if (ball.ownerId === node.playerId) return true;
  return false;
}

/**
 * Decide, each step, whether this player is standing still or working.
 *
 * Rest is entered when he has arrived and has nothing to do, and left the moment
 * any of {@link restPulled}'s four conditions says otherwise. The duration is
 * drawn once when he settles rather than every step, so a man does not re-roll his
 * own patience thirty times a second and thereby never actually finish settling.
 */
function updateRest(
  spatial: MatchSpatial,
  node: PlayerSpatial,
  ball: MatchSpatial['ball'],
  possessing: 'home' | 'away' | null,
  energy: number,
): void {
  const arrived = Math.hypot(node.tx - node.x, node.ty - node.y) <= ARRIVAL_RADIUS;
  const stopped = Math.hypot(node.vx, node.vy) <= RESTING_SPEED;

  // Already resting: only a real reason gets him moving again.
  if (node.restUntil !== undefined && spatial.clock < node.restUntil) {
    if (restPulled(spatial, node, ball, possessing)) node.restUntil = undefined;
    return;
  }
  node.restUntil = undefined;

  // Not resting yet. He settles only if he has arrived, stopped, and has no
  // business anywhere — carrying, chasing, being pressed at, or playing a step.
  //
  // The step check has to include *any* step this man is named in, not merely
  // the one the chain has reached. Checking only the current step let a carrier
  // be put at rest while a later step in the same chain was still his to play: he
  // stood at the end of his carry for the whole of the next action, because the
  // step he was resting through was the very one he had already finished.
  if (!arrived || !stopped) return;
  if (spatial.plan?.steps.some((entry) => entry.playerId === node.playerId)) return;
  if (ball.ownerId === node.playerId) return;
  if (ball.targetId === node.playerId) return;
  if (spatial.pressing?.[node.side] === node.playerId) return;
  const step = currentStep(spatial.plan);
  if (step?.playerId === node.playerId) return;
  // Nor if the ball is on top of him. Checked here as well as on the way *out*
  // of rest, because a loose ball rolling across a settled defender can arrive
  // from behind: he is already resting when it gets to him, so a check that only
  // runs while he is resting would catch it a frame late — and a frame late is
  // long enough for the ball to be past him.
  if (Math.hypot(ball.x - node.x, ball.y - node.y) <= BALL_REACH) return;

  node.restUntil = spatial.clock + restSecondsFor(node, energy);
}

/**
 * Where this man has offered to support from, decided once and then kept.
 *
 * The offer is a *decision*, and a decision taken thirty times a second is not a
 * decision. Recomputing it every step meant a man who had already moved up beside
 * his carrier kept being told to move up a little further, because his distance
 * to the ball was recomputed from a ball that was itself being carried — so he
 * crept forward for the whole carry, arriving somewhere nobody decided he should
 * be.
 *
 * So the offer is cached on the node together with the ball position and carrier
 * it was made against, and revisited only when one of those has genuinely
 * changed: the ball has moved a real distance, or somebody else now has it.
 * Everything else — the shape moving under him, a step being read — leaves the
 * offer alone, which is what makes a supporting player look like he decided
 * something once and then went and did it.
 */
function supportOffer(
  node: PlayerSpatial,
  ball: MatchSpatial['ball'],
  from: { x: number; y: number },
  supporting: boolean,
): { x: number; y: number } {
  if (!supporting) {
    // Not supporting: any stale offer is dropped rather than left to be applied.
    node.offerX = undefined;
    node.offerY = undefined;
    node.offerBallX = undefined;
    node.offerBallY = undefined;
    node.offerCarrierId = undefined;
    return from;
  }

  const stale =
    node.offerX === undefined ||
    node.offerY === undefined ||
    node.offerCarrierId !== ball.ownerId ||
    Math.hypot(ball.x - (node.offerBallX ?? NaN), ball.y - (node.offerBallY ?? NaN)) > OFFER_RECOMPUTE;

  if (stale) {
    const support = clamp((SUPPORT_RANGE - Math.hypot(ball.x - node.x, ball.y - node.y)) / SUPPORT_RANGE, 0, 1);
    const side = from.y >= 0.5 ? 1 : -1;
    node.offerX = from.x + support * SUPPORT_FORWARD;
    node.offerY = from.y + side * support * SUPPORT_SIDEWAYS;
    node.offerBallX = ball.x;
    node.offerBallY = ball.y;
    node.offerCarrierId = ball.ownerId ?? undefined;
  }

  return { x: node.offerX!, y: node.offerY! };
}

/** Put the ball at a player's feet. */
/**
 * Put the ball down for a restart.
 *
 * The ball goes to the spot, out of play, with nobody touching it — which is the
 * difference between a corner being *given* and a corner being *resolved*. It is
 * separate from {@link giveBallTo} because that hands the ball to a player's
 * feet, and during a setup the ball has to be at nobody's feet while the taker is
 * still walking toward it.
 *
 * The taker is placed at the ball when he can be, rather than left to walk to it:
 * a man who has to cross thirty yards in four seconds cannot, so he is put at the
 * flag and given a real setup for the rest of the side to walk into. The ball is
 * still dead, which is the thing a viewer is actually looking for.
 */
export function installRestart(match: Match, state: RestartState): void {
  const spatial = match.spatial;
  if (!spatial) return;
  // The debug switch: with it off the pitch plays the same football and shows
  // none of the set pieces, which is exactly the state this work started from.
  // That comparison is the only way to *prove* the restarts are presentation and
  // not a second football.
  if (spatial.restartsEnabled === false) return;
  // The setup clock starts now, not when the restart was created. A corner
  // decided eight seconds ago and delivered now gets its full eight seconds of
  // walking; counting from its creation would hand the pitch a corner that was
  // already over before the taker picked the ball up.
  state.placed = true;
  state.played = false;
  state.elapsed = 0;
  spatial.restart = state;

  const taker = state.takerId ? playerOf(spatial, state.takerId) : undefined;
  if (taker) {
    // He is *placed* at the ball, and this is the one place the pitch moves a
    // player rather than asking him to walk.
    //
    // It is the same operation that places the ball, and it has to be: a corner
    // is a ball and a taker put on the flag together, and no amount of setup time
    // produces a taker at the flag, because a corner is awarded with the
    // attacking side nowhere near the corner — measured at half a pitch away, and
    // four metres a second does not close that in six seconds. A taker who
    // "walks" to a corner flag crosses thirty yards in front of everybody.
    //
    // So it is a deliberate exception rather than a hole in the movement rules:
    // `spatial.test.ts` exempts exactly this frame and no other, and every other
    // step of every match still has to obey the legs. During the *setup* that
    // follows he walks like anybody else — he simply starts from the flag.
    taker.x = state.ballX;
    taker.y = state.ballY;
    taker.px = taker.x;
    taker.py = taker.y;
    taker.tx = taker.x;
    taker.ty = taker.y;
    taker.vx = 0;
    taker.vy = 0;
    taker.restUntil = undefined;
  }

  const ball = spatial.ball;
  ball.ownerId = null;
  ball.targetId = null;
  ball.status = 'out-of-play';
  ball.speed = 0;
  ball.x = state.ballX;
  ball.y = state.ballY;
  ball.px = ball.x;
  ball.py = ball.y;
  ball.tx = ball.x;
  ball.ty = ball.y;
  ball.lastTouchId = null;
}

export function giveBallTo(spatial: MatchSpatial, playerId: PlayerId): void {
  const node = playerOf(spatial, playerId);
  if (!node) return;
  const ball = spatial.ball;
  ball.ownerId = playerId;
  ball.targetId = null;
  ball.status = 'controlled';
  ball.speed = 0;
  ball.x = node.x;
  ball.y = node.y;
  ball.px = ball.x;
  ball.py = ball.y;
  ball.tx = ball.x;
  ball.ty = ball.y;
  // The state records when the ball last changed hands and who took it, so a
  // consumer never has to infer a touch from the sequence of events.
  ball.touchedAt = spatial.clock;
  ball.lastTouchId = playerId;
}

/**
 * Start the ball travelling.
 *
 * A pass is aimed at where the receiver is; he then moves onto it, because
 * `playerTarget` sends the named player to meet a ball on its way to him. A
 * shot is aimed at the goal and belongs to nobody, so it arrives loose.
 */
export function travelTo(
  spatial: MatchSpatial,
  from: { x: number; y: number },
  to: { x: number; y: number },
  targetId: PlayerId | null,
  speed: number,
): void {
  const ball = spatial.ball;
  ball.x = from.x;
  ball.y = from.y;
  ball.px = from.x;
  ball.py = from.y;
  ball.tx = to.x;
  ball.ty = to.y;
  ball.targetId = targetId;
  ball.ownerId = null;
  ball.status = 'travelling';
  ball.speed = speed;
}

// --- The passage -----------------------------------------------------------

function outcomeOf(type: MatchEvent['type']): PassageOutcome | null {
  switch (type) {
    case 'goal':
      return 'goal';
    case 'penalty-scored':
      return 'penalty-scored';
    case 'penalty-missed':
      return 'penalty-missed';
    case 'shot-saved':
      return 'saved';
    case 'shot-blocked':
      return 'blocked';
    case 'shot-off-target':
      return 'off-target';
    default:
      return null;
  }
}

function carryStep(playerId: PlayerId, duration: number): PassageStep {
  return { kind: 'carry', playerId, targetId: null, outcome: null, text: null, duration };
}

function passStep(fromId: PlayerId, toId: PlayerId, duration: number): PassageStep {
  return { kind: 'pass', playerId: fromId, targetId: toId, outcome: null, text: null, duration };
}

/**
 * A pass across the park takes longer than one into feet.
 *
 * The upper bound is what keeps a passage inside the minute it belongs to: a
 * move that outlived its minute would be cut off by the next one, and the ball
 * would jump.
 */
function passSeconds(spatial: MatchSpatial | null, fromId: PlayerId, toId: PlayerId): number {
  if (!spatial) return 1.2;
  const a = playerOf(spatial, fromId);
  const b = playerOf(spatial, toId);
  if (!a || !b) return 1.2;
  return clamp(Math.hypot(a.x - b.x, a.y - b.y) / PASS_SPEED, 0.6, 1.4);
}

/**
 * Who starts the move.
 *
 * Whoever already has the ball keeps it when his side still has it — that is
 * what makes a passage continuous rather than a fresh cast every minute. When
 * possession has changed the ball is won by somebody near it, because a player
 * who is nowhere near the ball collecting it reads as a jump.
 */
function chooseCreator(
  match: Match,
  spatial: MatchSpatial | null,
  side: 'home' | 'away',
  rng: Rng,
  avoid?: PlayerId | null,
): PlayerId | null {
  if (spatial) {
    // A ball already in flight is about to be somebody's, so he is the man to
    // start the next move — that is what stops a pass looking cut in half.
    const arriving = playerOf(spatial, spatial.ball.status === 'travelling' ? spatial.ball.targetId : null);
    if (arriving && arriving.side === side && arriving.playerId !== avoid) return arriving.playerId;
    const owner = playerOf(spatial, spatial.ball.ownerId);
    if (owner && owner.side === side && owner.playerId !== avoid && rng.chance(0.6)) return owner.playerId;
    const options = spatial.players.filter(
      (node) => node.side === side && node.position !== 'GK' && node.playerId !== avoid,
    );
    if (options.length === 0) return null;
    const ball = spatial.ball;
    return rng.weighted(
      options.map((node) => {
        const distance = Math.hypot(ball.x - node.x, ball.y - node.y);
        return { value: node.playerId, weight: roleWeight(node.position) / (0.1 + distance) };
      }),
    );
  }

  const slots = match.lineups[side].starting.filter((slot) => slot.position !== 'GK' && slot.playerId !== avoid);
  if (slots.length === 0) return null;
  return rng.weighted(slots.map((slot) => ({ value: slot.playerId, weight: roleWeight(slot.position) })));
}

/** Somebody to be on the end of it when the engine named nobody in particular. */
function chooseAttacker(
  match: Match,
  spatial: MatchSpatial | null,
  side: 'home' | 'away',
  rng: Rng,
  avoid?: PlayerId | null,
): PlayerId | null {
  if (spatial) {
    const options = spatial.players.filter(
      (node) => node.side === side && node.position !== 'GK' && node.playerId !== avoid,
    );
    if (options.length === 0) return null;
    return rng.weighted(
      options.map((node) => {
        const forward = node.position === 'ST' || node.position === 'AM' ? 3 : node.position === 'CB' ? 0.3 : 1;
        return { value: node.playerId, weight: forward };
      }),
    );
  }
  const slots = match.lineups[side].starting.filter((slot) => slot.position !== 'GK' && slot.playerId !== avoid);
  if (slots.length === 0) return null;
  return rng.weighted(
    slots.map((slot) => ({ value: slot.playerId, weight: slot.position === 'ST' || slot.position === 'AM' ? 3 : 1 })),
  );
}

/**
 * Plan the move the engine's minute becomes on the pitch.
 *
 * This is the one place the two layers meet, and it is written from the names
 * the engine already used: the shooter and the assister come straight out of the
 * event, and the man who starts the move is either still on the ball or picked
 * from the eleven out there. The commentary reads this same plan, which is why a
 * line can no longer describe a pass nobody made.
 *
 * Randomness comes from a stream named for this minute, so planning a passage
 * can never move a shot: the authoritative streams are untouched.
 */
/** How the simulation's outcome reads as a shot's passage outcome. */
function passageOutcomeFor(outcome: TimelineAction['outcome']): PassageOutcome | null {
  switch (outcome) {
    case 'goal':
      return 'goal';
    case 'saved':
      return 'saved';
    case 'blocked':
      return 'blocked';
    case 'off-target':
      return 'off-target';
    default:
      return null;
  }
}

/**
 * Project the simulation's own decisions into the steps the pitch plays.
 *
 * This is the inversion: the passage is no longer reconstructed from the
 * minute's events, it is the possession model's own action timeline — the same
 * men, in the same order, with the outcomes the model already settled. The
 * durations stay the presentation's (geometry-based) ones so the move is sized
 * to the six seconds a minute is given, while the *truth* of what happened
 * stays in the authoritative timeline.
 */
function passageStepsFromTimeline(
  spatial: MatchSpatial | null,
  actions: readonly TimelineAction[],
  onSide: (id: PlayerId | null | undefined) => boolean,
): PassageStep[] {
  // A move must fit inside the minute it belongs to, so only the last few
  // decisions are played out — the finish, and the build-up that led to it.
  const MAX_PROJECTED_STEPS = 4;
  const steps: PassageStep[] = [];
  for (const action of actions) {
    if (!action.playerId || !onSide(action.playerId)) continue;
    if (action.kind === 'shot') {
      steps.push({
        kind: 'shot',
        playerId: action.playerId,
        side: action.side,
        targetId: null,
        outcome: passageOutcomeFor(action.outcome),
        result: action.outcome,
        text: null,
        duration: SHOT_SECONDS,
      });
      continue;
    }
    // A clearance that finds the man who cleared it is not a pass to himself:
    // played as a carry, so the words and the picture never say one.
    if (
      isDelivery(action.kind) &&
      action.targetPlayerId &&
      action.targetPlayerId !== action.playerId &&
      onSide(action.targetPlayerId)
    ) {
      steps.push(passStep(action.playerId, action.targetPlayerId, passSeconds(spatial, action.playerId, action.targetPlayerId)));
      steps[steps.length - 1]!.result = action.outcome;
      steps[steps.length - 1]!.side = action.side;
      continue;
    }
    if (isOnBall(action.kind) || action.kind === 'cross' || action.kind === 'clear') {
      steps.push(carryStep(action.playerId, CARRY_SECONDS));
      steps[steps.length - 1]!.result = action.outcome;
      steps[steps.length - 1]!.side = action.side;
    }
  }
  return steps.slice(-MAX_PROJECTED_STEPS);
}

/**
 * The whole minute's football, as one passage.
 *
 * A minute is a run of possessions, and the narrator reads them in order: each
 * chain is projected into the steps the pitch will play, and the chains are laid
 * end to end. Every step carries the side it belongs to, because the passage is
 * no longer one side's move — a minute in which the ball changed hands is a
 * minute about both teams, and the words have to say so.
 *
 * Nothing here decides anything: it is the possession model's own decisions,
 * chain by chain, in the order it made them. When a minute produced no decisions
 * at all, the old event-derived passage still gives the narrator a move to hang
 * the minute on.
 */
export function planMinutePassage(
  match: Match,
  env: MatchEnvironment,
  chains: readonly PossessionChain[],
  events: readonly MatchEvent[],
  rng: Rng,
): Passage {
  const minute = match.minute;
  const spatial = match.spatial ?? null;
  if (spatial) syncSpatial(match, env);

  const steps: PassageStep[] = [];
  for (const chain of chains) {
    const onSide = (id: PlayerId | null | undefined): boolean => {
      if (!id) return false;
      if (spatial) return spatial.players.some((node) => node.playerId === id && node.side === chain.side);
      return match.lineups[chain.side].starting.some((slot) => slot.playerId === id);
    };
    steps.push(...passageStepsFromTimeline(spatial, chain.actions, onSide));
  }

  const side = chains.length > 0 ? chains[chains.length - 1]!.side : 'home';
  if (steps.length > 0) return { side, minute, steps };
  return planPassage(match, env, side, [], events, rng);
}

export function planPassage(
  match: Match,
  env: MatchEnvironment,
  side: 'home' | 'away',
  receivers: readonly PlayerId[],
  events: readonly MatchEvent[],
  rng: Rng,
  actions: readonly TimelineAction[] = [],
): Passage {
  const minute = match.minute;
  const spatial = match.spatial ?? null;
  if (spatial) syncSpatial(match, env);

  const clubId = clubIdOf(match, side);
  const shot = events.find((event) => event.clubId === clubId && SHOT_TYPES.has(event.type)) ?? null;

  // A shot's second player is sometimes the keeper who saved it or the defender
  // who blocked it — men from the other side. The move is built only from the
  // attacking side's own players, or the picture would show the opposition
  // keeper carrying the ball up the pitch.
  const onSide = (id: PlayerId | null | undefined): boolean => {
    if (!id) return false;
    if (spatial) return spatial.players.some((node) => node.playerId === id && node.side === side);
    return match.lineups[side].starting.some((slot) => slot.playerId === id);
  };

  // The simulation's own decisions, projected. When the possession model hands
  // over the actions it actually took, the passage *is* those actions — the same
  // passers, the same receivers, the same finish — rather than a move invented
  // from the minute's events. The old reconstruction remains as the fallback for
  // callers with no timeline: a test, or a match decided before this existed.
  if (actions.length > 0) {
    const projected = passageStepsFromTimeline(spatial, actions, onSide);
    if (projected.length > 0) return { side, minute, steps: projected };
  }

  if (shot) {
    const shooterId = onSide(shot.playerId) ? shot.playerId : chooseAttacker(match, spatial, side, rng);
    if (shooterId) {
      const assisterId =
        shot.secondaryPlayerId && shot.secondaryPlayerId !== shooterId && onSide(shot.secondaryPlayerId)
          ? shot.secondaryPlayerId
          : null;
      const creatorId = assisterId ?? chooseCreator(match, spatial, side, rng, shooterId);
      const steps: PassageStep[] = [];
      if (creatorId && creatorId !== shooterId) {
        steps.push(carryStep(creatorId, CARRY_SECONDS));
        steps.push(passStep(creatorId, shooterId, passSeconds(spatial, creatorId, shooterId)));
      } else {
        steps.push(carryStep(shooterId, CARRY_SECONDS));
      }
      steps.push({
        kind: 'shot',
        playerId: shooterId,
        targetId: null,
        outcome: outcomeOf(shot.type),
        text: shot.text,
        duration: SHOT_SECONDS,
      });
      return { side, minute, steps };
    }
  }

  // The minute's passes, in the order the engine credited them. Playing the
  // whole chain rather than only the last man is what makes the ball move like
  // a team moving it — and every pass shown is one the record already counts.
  const chain: PlayerId[] = [];
  for (const id of receivers) {
    // Only this side's own players can be in its move. A chain carrying a man
    // from the other team would have the narrator describing a pass the
    // opponent made, which is exactly the kind of thing this layer exists to
    // make impossible.
    if (chain.includes(id) || chain.length >= 3 || !onSide(id)) continue;
    chain.push(id);
  }

  // The credited passers are the men who move the ball on, so the chain runs
  // through them: each pass shown is a pass the record already counts. The man
  // who starts it is whoever already has the ball.
  const creatorId = chooseCreator(match, spatial, side, rng);
  if (!creatorId) return { side, minute, steps: [] };

  const steps: PassageStep[] = [carryStep(creatorId, CARRY_SECONDS)];
  let from = creatorId;
  for (const to of chain) {
    if (to === from) continue;
    steps.push(passStep(from, to, passSeconds(spatial, from, to)));
    from = to;
  }
  if (steps.length === 1) steps[0]!.duration = CARRY_SECONDS * 1.6;
  return { side, minute, steps };
}

// ---------------------------------------------------------------------------
// The continuous possession (the converted path)
//
// This is the migration seam, and the boundary the module doc describes. The
// possession model above still *decides* a minute; what has changed is that the
// pitch no longer replays those decisions out of a passage. It executes them,
// one fixed simulation step at a time, from the authoritative player, ball and
// action state — and the plan is only the list of what is still to come.
//
// Everything here is a reader and a mover. It never rolls a die, never changes
// an outcome, and never reads a renderer.
// ---------------------------------------------------------------------------

/** The active action a plan step is being played out as, if it has begun. */
/**
 * How fast the ball is struck, so that it takes the step's own time to get
 * there.
 *
 * The possession model gives an action several seconds; a ball flown at the
 * fixed pace covers the same ground in a fraction of one and then waits at the
 * far end for the rest, which is a picture of a ball stuck to a man's boots. So
 * the strike is given the distance and the time together: it arrives when the
 * action is due, the receiver runs onto it for the whole of it, and the step
 * hands straight on to the next one.
 */
function flightSpeed(fromX: number, fromY: number, toX: number, toY: number, duration: number): number {
  const distance = Math.hypot(toX - fromX, toY - fromY);
  if (distance < 1e-6 || duration <= 0) return PASS_SPEED;
  return distance / Math.max(duration, MIN_STEP_SECONDS);
}

function actionForPlanStep(spatial: MatchSpatial, step: PossessionStep): MatchAction | undefined {
  return spatial.actions.find((action) => action.playerId === step.playerId && action.kind === step.kind);
}

/**
 * The chain is over. Take the next one, or leave the pitch with nothing to play.
 *
 * A minute is a run of possessions, and finishing one is not the end of the
 * minute — the model decided what came next, and it is waiting. So the next chain
 * starts from exactly where the ball is, which is what keeps a minute's football
 * from being only the move it happened to finish on.
 */
function dropPlan(match: Match): void {
  const spatial = match.spatial;
  if (!spatial) return;

  // A chain that still owes a dead ball does not get dropped, whatever ended it.
  //
  // Every way a chain can end is also a way of throwing away a corner: the step
  // before the delivery is usually the one that lost the ball, so it resolves as
  // a turnover or a blocked shot and drops the plan — taking the corner with it,
  // because the corner was attached to the chain rather than played by it. The
  // ball stayed on the flag and the cross was never struck.
  //
  // So the chain is advanced to its restart instead, and the ball goes down.
  // The steps being skipped are the ones that can no longer be played: the chain
  // has already ended, so the football between here and the delivery is gone
  // whatever the plan still lists. Only the dead ball it is owed survives.
  //
  // This is the renderer moving its own cursor, which is legitimate. The plan is
  // built by `buildPossessionPlan` from the recorded timeline, so it is this
  // layer execution state rather than the model record of the match. The model
  // decided all of it already; the plan only tracks how much of that the pitch has
  // got through, and the pitch may say "the rest of this chain will not be played,
  // but the corner still is".
  const current = spatial.plan;
  if (
    spatial.restartsEnabled !== false &&
    current?.restart &&
    !current.restart.placed &&
    current.index < (current.restartIndex ?? 0)
  ) {
    current.index = current.restartIndex ?? 0;
    return;
  }

  flushPlanCommentary(match, spatial.plan);
  const next = spatial.pending?.shift();
  if (next) {
    spatial.plan = next;
    // The next chain may begin with a dead ball, and that ball has to go down
    // *before* its first step is begun rather than after. Beginning the step
    // first is what made a corner arrive from the halfway line: the cross was
    // struck by whoever happened to hold the ball, and the ball was never seen
    // out of play at all.
    if (next.restart && (next.restartIndex ?? 0) === 0 && spatial.restartsEnabled !== false) {
      installRestart(match, next.restart);
      return;
    }
    beginPossessionStep(spatial, next, next.steps[0]!, match);
    return;
  }
  spatial.plan = null;
  clearActions(spatial);
}

/**
 * Say what this chain is about, now that the chain has taken the pitch.
 *
 * This is the whole point of queuing the words: a line is told at the moment the
 * move it describes starts being played, so the bar and the pitch are never a
 * minute apart. The lines come off the front of the queue in the order the
 * chains own them, which is the order the chains were installed.
 */
function tellChainCommentary(match: Match, plan: PossessionPlan, count: number): void {
  const spatial = match.spatial;
  if (!spatial || count <= 0 || !spatial.untold || spatial.untold.length === 0) return;
  const taking = stampIds(match, spatial.untold.slice(0, count));
  spatial.untold = spatial.untold.slice(count);
  match.commentary = [...(match.commentary ?? []), ...taking];
  plan.toldCount = (plan.toldCount ?? 0) + taking.length;
}

/**
 * Say one line for the step that has just begun.
 *
 * This is what keeps the bar and the pitch together. It used to be told the
 * moment a chain took the pitch, all of it at once — so a five-step chain said
 * "finds", "carries", "plays it", "takes it on", "shoots" in a single tick and
 * then sat silent for the two or three seconds the pitch spent actually playing
 * those five steps. The words ran *ahead* of the football rather than with it,
 * and because the bar can only show one line, the manager was reading about a
 * pass that had not happened yet.
 *
 * Now a chain's words come out one per step, as the step takes the pitch. A step
 * is begun more than once when a carry waits for a loose ball to arrive, so
 * `narratedStep` is what makes it once and once only.
 */
function tellStepCommentary(match: Match, plan: PossessionPlan): void {
  const left = (plan.commentaryCount ?? 0) - (plan.toldCount ?? 0);
  if (left <= 0 || plan.narratedStep === plan.index) return;
  plan.narratedStep = plan.index;
  tellChainCommentary(match, plan, 1);
}

/**
 * A chain has given up the pitch. Say whatever it had left.
 *
 * A chain's lines are told one per step, and a chain can end with steps left to
 * play — a shot that missed ends the move there — so its remaining words would
 * otherwise never be said. They are said now, at the end of the move they belong
 * to, which is the only moment left that is still true.
 */
function flushPlanCommentary(match: Match, plan: PossessionPlan | null | undefined): void {
  if (!plan) return;
  const left = (plan.commentaryCount ?? 0) - (plan.toldCount ?? 0);
  if (left <= 0) return;
  tellChainCommentary(match, plan, left);
}

/**
 * Give a line the identity it will be known by.
 *
 * A line used to be numbered the moment it was written, from a running count of
 * the match's commentary. Told as the football happens, that count is no longer
 * the line's position — a minute's worth of words is all written before any of
 * it is told — so numbering has moved to the moment the line is actually said,
 * which is the only moment its position in the record exists.
 */
function stampIds(match: Match, lines: readonly CommentaryEvent[]): CommentaryEvent[] {
  const base = match.commentary?.length ?? 0;
  return lines.map((line, index) => ({ ...line, id: `${match.id}_c${base + index + 1}` }));
}

/**
 * Say whatever is still untold, for a match that has run out of pitch to play it
 * on — a whistle at the final minute mark, or a picture that was never put in
 * place. Nothing that was decided may be lost just because it was never shown.
 */
export function flushUntoldCommentary(match: Match): void {
  const spatial = match.spatial;
  if (!spatial?.untold || spatial.untold.length === 0) return;
  match.commentary = [...(match.commentary ?? []), ...stampIds(match, spatial.untold)];
  spatial.untold = [];
}

/**
 * Start the current step of the plan.
 *
 * A carry waits until the ball is actually at the player's feet — it is gathered,
 * not handed over — and only then opens a timed action. A pass or a shot opens
 * its action and puts the ball in flight at once. Nothing is decided here: the
 * duration and the outcome of every step were settled before the plan was built.
 */
/**
 * How long this step is given.
 *
 * The plan carries the budget the possession model set aside for the whole
 * chain, and the step takes its share of what is left of it — so the picture
 * takes as long to play a chain as the model took to decide it, whatever the
 * earlier steps happened to eat. A gather that took a second comes out of the
 * time still to come rather than being added to the chain, and the last step
 * finishes the budget exactly.
 *
 * A plan with no budget (one built for its own sake, or a test) simply gets the
 * duration it was built with.
 */
/**
 * How long this step is given: exactly the time it was built with.
 *
 * This used to be re-derived here, as the step's share of what was left of the
 * chain's budget, worked out against `spatial.clock`. That is the pitch *re-timing
 * the model's decisions* — the step's length was a function of a clock the
 * renderer advances, so the same chain played against a differently-driven pitch
 * could hand its steps different amounts of time. It is exactly the two-clocks
 * problem, and it is why there was a 1.4s ceiling that a twelve-second chain
 * could not spend.
 *
 * Now the plan is timed once, when it is installed, from the model's own budget:
 * the steps keep the durations they were built with, and whatever the budget has
 * over that is spent as settling at the end of the chain (see
 * `PossessionPlan.settleSeconds`). Nothing about a step's length is decided at
 * play time and nothing reads a clock to find it. A plan with no budget — one
 * built for its own sake, or by a test — simply gets its built durations, which
 * is what it always effectively got.
 */
function stepDuration(step: PossessionStep): number {
  return step.duration;
}

function beginPossessionStep(spatial: MatchSpatial, plan: PossessionPlan, step: PossessionStep, match?: Match): void {
  const ball = spatial.ball;
  // The chain's own clock starts the moment it takes the pitch, and the step's
  // share of the budget is worked out here — before any gathering, so time
  // spent reaching for a loose ball comes out of what is still to come rather
  // than being added to the chain.
  plan.startedAt ??= spatial.clock;
  const duration = stepDuration(step);

  if (step.kind === 'carry') {
    const node = playerOf(spatial, step.playerId);
    if (!node) {
      if (match) dropPlan(match);
      return;
    }
    if (!(ball.status === 'controlled' && ball.ownerId === step.playerId)) {
      // Gathered, not teleported: if it is not already at his feet the ball
      // travels to him while he goes to meet it.
      //
      // The gather is aimed once and then left alone. It used to be re-issued
      // against wherever the carrier had got to, on every step, which meant the
      // ball was always chasing a man who was already walking toward the step's
      // destination — a chase that never quite closed and a carrier whose target
      // was rewritten thirty times a second. Aiming at a fixed point and letting
      // him walk to it makes the gather one movement like any other.
      if (ball.status === 'travelling' && ball.targetId === step.playerId) return;
      if (Math.hypot(ball.x - node.x, ball.y - node.y) > 0.02) {
        travelTo(spatial, { x: ball.x, y: ball.y }, { x: node.x, y: node.y }, step.playerId, PASS_SPEED);
        return;
      }
      giveBallTo(spatial, step.playerId);
    }
    beginAction(spatial, { kind: 'carry', playerId: step.playerId, duration });
    // The step is genuinely under way, so its line is said now.
    if (match) tellStepCommentary(match, plan);
    return;
  }

  if (step.kind === 'hold') {
    // Shielding the ball. The carrier keeps it and stands still — genuinely
    // still, not slowly — and the chain waits him out. He is put at rest rather
    // than merely given a target he happens to be standing on, so the difference
    // between a man shielding the ball and a man idling is the difference between
    // an action and the absence of one.
    const node = playerOf(spatial, step.playerId);
    if (!node) {
      if (match) dropPlan(match);
      return;
    }
    if (!(ball.status === 'controlled' && ball.ownerId === step.playerId)) {
      if (ball.status !== 'travelling' || ball.targetId !== step.playerId) {
        if (Math.hypot(ball.x - node.x, ball.y - node.y) > 0.02) {
          travelTo(spatial, { x: ball.x, y: ball.y }, { x: node.x, y: node.y }, step.playerId, PASS_SPEED);
          return;
        }
        giveBallTo(spatial, step.playerId);
      }
      return;
    }
    beginAction(spatial, { kind: 'hold', playerId: step.playerId, duration });
    // The rest is the action: it outlasts the step, so a chain that ends while he
    // is still shielded does not have him springing back to life mid-pass.
    node.restUntil = spatial.clock + duration;
    node.tx = node.x;
    node.ty = node.y;
    if (match) tellStepCommentary(match, plan);
    return;
  }

  if (step.kind === 'pass') {
    // A delivery with no named man is a ball into space — a cross into a box, or
    // a clearance. It is aimed at the *place* and finds whoever is standing
    // there, which is what being contested in the air means.
    //
    // This used to drop the chain. A cross is aimed at a place precisely because
    // nobody is picked to receive it, so requiring a named receiver deleted
    // every cross the engine decided to play: the corner was given, the flag was
    // shown, the setup ran, and then the ball was picked up at the flag and the
    // chain ended without the cross ever being struck.
    const target = playerOf(spatial, step.targetPlayerId);
    if (!target && step.targetPlayerId === null) {
      beginAction(spatial, {
        kind: 'pass',
        playerId: step.playerId,
        targetPlayerId: null,
        duration,
      });
      travelTo(
        spatial,
        { x: ball.x, y: ball.y },
        { x: step.toX, y: step.toY },
        // Nobody owns it: it arrives where it was aimed and is taken by whoever
        // is nearest, which is the whole nature of a contested ball.
        null,
        flightSpeed(ball.x, ball.y, step.toX, step.toY, duration),
      );
      if (match) tellStepCommentary(match, plan);
      return;
    }
    if (!target) {
      if (match) dropPlan(match);
      return;
    }
    // An incomplete pass still travels — it simply does not reach its man. It
    // dies at the feet of whoever read it, or short of where it was aimed.
    //
    // *Who* read it is the simulation's answer, carried on the step, and the
    // pitch is not allowed to second-guess it. It used to reach for
    // `nearestOpponent`, which is the renderer picking a player from where the
    // men are standing — the shape of decision that had to be reverted twice,
    // and one that could credit a different defender from the one the stats
    // panel had already given the interception to.
    //
    // When the model named nobody — most misplaced balls are simply lost — the
    // ball dies short of where it was aimed, halfway to its man. That is the
    // honest picture of a ball nobody read.
    let toX = target.x;
    let toY = target.y;
    let receiverId: PlayerId | null = target.playerId;
    if (step.outcome !== 'completed') {
      const reader = playerOf(spatial, step.opponentId ?? null);
      toX = reader ? reader.x : (ball.x + target.x) / 2;
      toY = reader ? reader.y : (ball.y + target.y) / 2;
      receiverId = null;
    }
    beginAction(spatial, {
      kind: 'pass',
      playerId: step.playerId,
      targetPlayerId: step.targetPlayerId,
      duration,
    });
    travelTo(spatial, { x: ball.x, y: ball.y }, { x: toX, y: toY }, receiverId, flightSpeed(ball.x, ball.y, toX, toY, duration));
    if (match) tellStepCommentary(match, plan);
    return;
  }

  // A shot. Struck from wherever the ball actually is — normally the shooter's
  // feet, because the pass into him has just finished, but never assumed. The
  // ball's own position is the truth: when he has it, it is already at his feet,
  // and when a chain begins on a loose ball it is struck from where that ball
  // lies rather than snapped across the park to the named man.
  //
  // The named shooter is deliberately *not* moved to meet it first. Snapping him
  // onto the ball does make the spatial record agree with the decision — but it
  // does it by teleporting a man up to three-quarters of the pitch in a single
  // frame, which breaks the one invariant the whole pitch depends on: nobody
  // moves faster than his legs. The disagreement this leaves behind is a real
  // bug, but it is a bug about the two coordinate systems, and it has to be
  // fixed where they disagree rather than papered over by moving a man.
  const from = { x: ball.x, y: ball.y };
  const goal = { x: step.toX, y: clamp(step.toY, GOAL_MOUTH_MIN, GOAL_MOUTH_MAX) };

  // The engine has already decided how the shot comes out, *and who met it*.
  // What is worked out here is only *where* the meeting happens, which is
  // geometry: the keeper gets across as far as his legs allow, the blocker meets
  // it where he stands.
  //
  // The man himself comes off the step. This used to be `defendingKeeper` and
  // `shotBlocker` — the renderer picking whoever happened to be nearest the goal
  // or the shot line — which could credit a different keeper from the one the
  // shot model had already given the save to, so the panel and the pitch named
  // two different men for one save. `opponentId` is the simulation's answer and
  // is used whenever it is there. The lookups remain only as the fallback for a
  // plan built without one, which is a test constructing steps by hand rather
  // than a match being watched.
  let toX = goal.x;
  let toY = goal.y;
  let receiverId: PlayerId | null = null;

  if (step.outcome === 'saved') {
    const keeper = playerOf(spatial, step.opponentId ?? null) ?? defendingKeeper(spatial, plan.side);
    if (keeper) {
      const save = savePoint(from, keeper, goal);
      toX = save.x;
      toY = save.y;
      receiverId = keeper.playerId;
    }
  } else if (step.outcome === 'blocked') {
    const named = playerOf(spatial, step.opponentId ?? null);
    // A named blocker is met where he stands — he is the man the model credited,
    // and he does not have to be on the shot line to have got a foot to it. The
    // unnamed fallback still picks the man on the line, because with nobody
    // named the line is the only reason to choose anybody.
    const blocker = named ?? shotBlocker(spatial, plan.side, from, goal);
    if (blocker) {
      toX = blocker.x;
      toY = blocker.y;
      receiverId = blocker.playerId;
    }
  } else if (step.outcome === 'off-target') {
    // Wide, and clearly so: outside the frame, where the keeper does not go.
    toY = from.y <= 0.5 ? GOAL_MOUTH_MIN - 0.16 : GOAL_MOUTH_MAX + 0.16;
  }

  // The man who meets it is named on the action, not on the ball: `ball.targetId`
  // means a pass to a man, and a shot is not a pass. The ball is aimed where he
  // will be and travels there on its own.
  beginAction(spatial, {
    kind: 'shot',
    playerId: step.playerId,
    targetPlayerId: receiverId,
    duration,
  });
  travelTo(spatial, from, { x: toX, y: toY }, null, flightSpeed(from.x, from.y, toX, toY, duration));
  if (match) tellStepCommentary(match, plan);
}

/**
 * Has this step done what it set out to do?
 *
 * A pass or a shot is over when the ball stops being in flight — it is received,
 * it is gathered by a defender, it goes loose — or when it somehow never
 * arrives and the clock runs out on it. The ball is given the step's own time to
 * make the trip in (see {@link beginPossessionStep}), so arriving and running out
 * of time are the same moment and there is never a pause with the ball sitting
 * still waiting for permission to move on.
 */
function possessionStepDone(spatial: MatchSpatial, action: MatchAction): boolean {
  // A carry ends when the carrier gets there, not when its timer runs out.
  //
  // It used to wait for the timer, which meant a man who had already arrived at
  // the end of his carry stood there holding the ball for however many seconds
  // the step had been allotted — up to eleven of them, and the step after it
  // could be a shot, so the ball sat at his feet in front of goal doing nothing
  // while the chain waited. A carry is a movement: it is over at its destination,
  // and the clock is a backstop for a carrier who somehow never arrives, not the
  // definition of when the move is finished.
  if (action.kind === 'carry') {
    if (actionIsDue(action, spatial.clock)) return true;
    const node = playerOf(spatial, action.playerId);
    if (!node) return true;
    const step = currentStep(spatial.plan);
    if (step?.playerId !== action.playerId) return false;
    return Math.hypot(node.x - step.toX, node.y - step.toY) <= ARRIVAL_RADIUS;
  }
  // A shield is done when its time is up. It deliberately does *not* consult the
  // ball, the way a pass or a shot does: a man shielding the ball is holding it
  // at his feet, so the ball being "not travelling" is true from the first frame
  // and would end the step instantly.
  if (action.kind === 'hold') return actionIsDue(action, spatial.clock);
  if (spatial.ball.status !== 'travelling') return true;
  return spatial.clock - action.startedAt > action.duration * 3;
}

/**
 * Close the current step and move the chain on.
 *
 * The action's own record is closed first, so what happened is authoritative
 * before anything else is allowed to move. Then the state is updated — a goal
 * stops the match, a turnover hands the ball on, otherwise the next step is
 * begun out of the updated state.
 */
function resolvePossessionStep(
  match: Match,
  plan: PossessionPlan,
  step: PossessionStep,
  action: MatchAction,
): void {
  const spatial = match.spatial;
  if (!spatial) return;
  resolveAction(spatial, action, step.outcome);

  // A goal is the one step nothing follows: the celebration takes the pitch.
  if (step.kind === 'shot' && step.outcome === 'goal') {
    startCelebration(spatial, plan.side, step.playerId);
    return;
  }

  // A shot that stayed out ends the move where it ended. If the engine said it
  // was saved or blocked, the man it named on the action has met it — the ball
  // has just finished travelling to the place worked out from where he actually
  // was — and it is now at his feet. A shot that missed is dead behind the goal
  // line, with no restart to play until the next minute takes the pitch.
  if (step.kind === 'shot') {
    if (step.outcome === 'saved' || step.outcome === 'blocked') {
      const winner = playerOf(spatial, action.targetPlayerId);
      if (winner) giveBallTo(spatial, winner.playerId);
    } else if (step.outcome === 'off-target' || step.outcome === 'out') {
      const ball = spatial.ball;
      ball.status = 'out-of-play';
      ball.ownerId = null;
      ball.targetId = null;
      ball.speed = 0;
    }
    dropPlan(match);
    return;
  }

  // A carrier who was dispossessed loses the ball where he stands: the nearest
  // defender takes it, and the chain is over.
  if (step.outcome === 'turnover') {
    const winner = nearestOpponent(spatial, plan.side, spatial.ball.x, spatial.ball.y);
    if (winner) {
      travelTo(spatial, { x: spatial.ball.x, y: spatial.ball.y }, { x: winner.x, y: winner.y }, null, PASS_SPEED);
    }
    dropPlan(match);
    return;
  }

  plan.index += 1;
  if (plan.index >= plan.steps.length) {
    // The chain's steps are done, but the chain may not be.
    //
    // The ball is left exactly where it is — with the receiver, or on the grass
    // — which is what makes the last pass a real reception rather than a plan
    // expiring. What is *not* done is the chain itself: the model took longer
    // over it than its steps account for, and that remainder is settled here so
    // the picture spends the time the football was decided over. Dropping the
    // plan on the last step is what made a twelve-second chain play in 2.8s and
    // left the pitch standing still until the next minute was decided. See
    // `PossessionPlan.settleSeconds`.
    plan.settledAt ??= spatial.clock;
    return;
  }

  // A dead ball goes down *before* the step that delivers it is begun.
  //
  // This is the ordering the whole restart layer rests on, and it used to be
  // wrong in the one direction that matters. `advancePossession` also checks for
  // the restart, but it only runs on a later tick: by then this function had
  // already advanced the index and called `beginPossessionStep` on the delivery,
  // which opened the action and put the ball in flight. `installRestart` then
  // arrived a tick later and pinned that travelling ball back to `out-of-play`,
  // leaving an action open on a dead ball that no longer had a step to resolve
  // it — the delivery was begun, frozen, and never struck.
  //
  // Fouls made that the common case rather than a corner: a free kick almost
  // always follows open play, so `restartIndex` is `openPlan.steps.length` and
  // this branch is the one taken. That is why free-kick setups were three times
  // any other dead ball and the ball sat on the spot instead of being delivered.
  //
  // Checking here as well as in `advancePossession` is belt and braces, and
  // costs nothing: `installRestart` sets `placed`, so whichever runs first wins
  // and the other becomes a no-op.
  if (restartDueHere(spatial, plan)) {
    installRestart(match, plan.restart!);
    return;
  }

  beginPossessionStep(spatial, plan, plan.steps[plan.index]!, match);
}

/**
 * Has this plan just reached the step its dead ball belongs to?
 *
 * The one question `advancePossession` and `resolvePossessionStep` both have to
 * ask before beginning a step, so it is asked once, here. It is deliberately
 * identical in both places — if the two ever disagree, the ball is frozen or the
 * setup is skipped, which is the bug this exists to end.
 */
/**
 * Is this chain's settling time still running?
 *
 * The chain's steps are played and the model's budget has not been spent, so the
 * pitch keeps the football — the players walking back into shape — until it has.
 * A chain with nothing left to settle (no budget, or steps that already outlast
 * it) is finished immediately, which is what every test constructing a plan by
 * hand gets.
 */
function chainStillSettling(spatial: MatchSpatial, plan: PossessionPlan): boolean {
  const settle = plan.settleSeconds ?? 0;
  if (settle <= 0) return false;
  const since = plan.settledAt ?? spatial.clock;
  return spatial.clock - since < settle;
}

function restartDueHere(spatial: MatchSpatial, plan: PossessionPlan): boolean {
  const restart = plan.restart;
  if (!restart) return false;
  if (spatial.restartsEnabled === false) return false;
  if (restart.placed) return false;
  return plan.index === (plan.restartIndex ?? 0);
}

/** One fixed step of the continuous possession. */
function advancePossession(match: Match): void {
  const spatial = match.spatial;
  if (!spatial) return;
  const plan = spatial.plan;
  if (!plan) return;
  const step = currentStep(plan);
  if (!step) {
    // The steps are played and the chain is settling.
    //
    // It holds the pitch for the rest of its decided time while the players walk
    // back into shape — a movement rather than a pause — and only then is the
    // next chain taken up. This is the whole of the "one clock": the picture
    // owes the model exactly the seconds the model spent, and it pays them here
    // rather than by stretching the steps it was given.
    if (chainStillSettling(spatial, plan)) return;
    dropPlan(match);
    return;
  }
  // This is the step the dead ball belongs to, and it has not been arranged yet.
  // The ball goes down now, and `advanceRestart` begins this very step once the
  // setup is over — so the delivery is played from a taker standing on the spot
  // the routine put him on, and every step before it was played as normal
  // football. `restartDueHere` is the same test `resolvePossessionStep` makes
  // when it advances onto this step; both must agree or the ball is frozen.
  if (restartDueHere(spatial, plan)) {
    installRestart(match, plan.restart!);
    return;
  }
  const action = actionForPlanStep(spatial, step);
  // The step has not begun yet — a carry may still be waiting for the ball to
  // reach the player. Starting it is all this step does.
  if (!action) {
    beginPossessionStep(spatial, plan, step, match);
    return;
  }
  if (!possessionStepDone(spatial, action)) return;
  resolvePossessionStep(match, plan, step, action);
}

/**
 * Is the ball dead, and does the delivery need playing?
 *
 * The restart state machine, run once per spatial step. It returns true for as
 * long as the ball is out of play, which is the signal the rest of `stepSpatial`
 * uses to stand the football down.
 *
 * Three things happen here and they have to happen in this order:
 *
 * 1. **The ball is pinned.** During a setup it does not move at all: not towards
 *    a taker, not rolling, not being carried. A dead ball that drifts is not a
 *    dead ball, and the whole visibility of a set piece depends on the ball being
 *    *seen* to sit on the spot while twenty-two men arrange themselves around it.
 * 2. **The setup is counted off.** Once it is over the restart stops being a
 *    pause and becomes a delivery.
 * 3. **The delivery is played** by handing the ball to the taker and taking up
 *    the chain that begins with the delivery. The ball goes to the taker's feet
 *    and the ordinary possession step then takes it from him — which means the
 *    cross is played by the same code that plays every other pass, rather than by
 *    a special case that would need its own arithmetic.
 *
 * The restart carries the outcome the possession model already decided. It is
 * put on the delivery step here so the picture shows *that* football rather than
 * rolling for it a second time; see `deliveryStepFor`.
 */
function advanceRestart(match: Match, dt: number): boolean {
  const spatial = match.spatial;
  if (!spatial) return false;
  const state = spatial.restart;
  if (!state) return false;

  const ball = spatial.ball;

  // A restart that has been decided but never delivered — because the taker could
  // not be found, or the chain it belonged to was dropped — is not held. A dead
  // ball with nothing going to bring it back is a frozen pitch, and this is the
  // one thing this module must never produce.
  if (!spatial.plan && (spatial.pending?.length ?? 0) === 0 && !spatial.celebration) {
    // Given up on. Slack is the full one rather than none, because giving up the
    // instant the chain went away cut the setup short while the taker was still
    // walking to the flag — measured at 0.098 of a pitch from it, which is a long
    // throw, not a corner.
    if (setupExpired(state, 0)) {
      spatial.restart = null;
      ball.status = 'loose';
    }
  }

  state.elapsed += dt;

  // Has the taker walked to the ball? The setup waits for him, within a bound.
  const takerNode = state.takerId ? playerOf(spatial, state.takerId) : undefined;
  if (takerNode) {
    state.takerArrived = Math.hypot(takerNode.x - state.ballX, takerNode.y - state.ballY) <= ARRIVAL_RADIUS * 2;
  }

  if (setupPhase(state)) {
    // The ball lies on the spot. `px`/`py` move with it so a renderer that
    // interpolates between steps does not draw a slide across the pitch between
    // the last live frame and the dead one.
    ball.px = ball.x;
    ball.py = ball.y;
    ball.x = state.ballX;
    ball.y = state.ballY;
    ball.tx = state.ballX;
    ball.ty = state.ballY;
    ball.status = 'out-of-play';
    ball.ownerId = null;
    ball.targetId = null;
    ball.speed = 0;
    // Nobody is at rest during a setup: they are walking to a place, and a man
    // who has arrived at the corner flag and then decided to stand there for
    // six seconds is not arranging himself, he is posing.
    for (const node of spatial.players) node.restUntil = undefined;
    return true;
  }

  // The setup is over. The delivery is played from here on, and the restart has
  // done its job: the ball is in play again and the chain takes over.
  const taker = state.takerId ? playerOf(spatial, state.takerId) : undefined;
  if (!taker) {
    // No taker to give it to. Clearing the restart rather than holding the ball
    // dead is the only honest option — see above.
    spatial.restart = null;
    ball.status = 'loose';
    return false;
  }

  spatial.restart = null;
  state.played = true;
  giveBallTo(spatial, taker.playerId);
  ball.x = taker.x;
  ball.y = taker.y;
  // The step this restart delivers was deliberately not begun while the ball was
  // dead, so it is begun now. That is the whole of the delivery: the same code
  // that plays every other pass plays this one, from a taker standing on the spot
  // the routine put him on.
  const plan = spatial.plan;
  if (plan) {
    const step = currentStep(plan);
    if (step && !actionForPlanStep(spatial, step)) beginPossessionStep(spatial, plan, step, match);
  }
  return false;
}

/**
 * Install the possession chain the pitch executes continuously.
 *
 * This is the engine's door into the converted path: it takes the minute's own
 * decisions and hands them to the continuous state as a plan. It returns the
 * plan on success, or null when there is nothing to play (no timeline, nobody on
 * the pitch, or a celebration already under way) — and there is then simply no
 * move to play this minute.
 *
 * Installing a plan replaces whatever was being played: one chain at a time, and
 * never two moves driving the same player or the same ball.
 */
export function installPossessionPlan(
  match: Match,
  env: MatchEnvironment,
  side: 'home' | 'away',
  actions: readonly TimelineAction[],
): PossessionPlan | null {
  const spatial = match.spatial;
  if (!spatial) return null;
  syncSpatial(match, env);
  if (spatial.celebration) return null;

  const plan = buildPossessionPlan(side, actions, {
    pointOf: (id) => playerOf(spatial, id),
    targetOf: (id) => {
      const node = playerOf(spatial, id);
      return node ? { x: node.tx, y: node.ty } : undefined;
    },
    onPitch: (id) => Boolean(id) && spatial.players.some((node) => node.playerId === id),
  });
  if (!plan) return null;

  clearActions(spatial);
  spatial.plan = plan;
  spatial.pending = [];
  beginPossessionStep(spatial, plan, plan.steps[0]!);
  return plan;
}

/**
 * Install the whole minute: every possession, in turn.
 *
 * This is the engine's door into the converted path, and the same one
 * {@link installPossessionPlan} uses — except that a minute is a run of
 * possessions and each of them is a move in its own right. Every chain becomes a
 * plan; the first takes the pitch and the rest wait their turn in
 * {@link MatchSpatial.pending}, so the minute is played out in the order the
 * model actually played it rather than collapsing into its last move.
 *
 * Returns the chain now being played, or null when there is nothing to play at
 * all (no chain named anybody on the pitch, or a goal is still being
 * celebrated) — and there is then simply no move to play this minute. Installing
 * replaces whatever was being played, and any leftover chains with it: one chain
 * at a time, and never two moves driving the same player or the same ball.
 */
export function installPossessionChains(
  match: Match,
  env: MatchEnvironment,
  chains: readonly PossessionChain[],
  lines?: readonly (readonly CommentaryEvent[])[],
): PossessionPlan | null {
  const spatial = match.spatial;
  if (!spatial) return null;
  syncSpatial(match, env);

  const plans: PossessionPlan[] = [];
  for (const [index, chain] of chains.entries()) {
    const geometry = {
      pointOf: (id: PlayerId) => playerOf(spatial, id),
      targetOf: (id: PlayerId) => {
        const node = playerOf(spatial, id);
        return node ? { x: node.tx, y: node.ty } : undefined;
      },
      onPitch: (id: PlayerId | null | undefined) => Boolean(id) && spatial.players.some((node) => node.playerId === id),
    };
    // The delivery is built as a *separate* plan and concatenated, rather than
    // handed to the builder as one long action list.
    //
    // That is so the restart can be attached to the step it actually delivers,
    // rather than to the start of the chain. A corner is the last thing a
    // possession does, but it is rarely the *first* — there are a dozen steps of
    // build-up before it — so attaching the restart to the chain put the ball
    // down for eight seconds at the wrong end of the move, and then played the
    // build-up from a dead ball while the corner was never taken at all.
    const openPlan = buildPossessionPlan(chain.side, chain.actions, geometry);
    const deliveryPlan = chain.restart
      ? buildPossessionPlan(chain.side, chain.restartActions ?? [], geometry)
      : null;
    const plan = openPlan && deliveryPlan
      ? { ...openPlan, steps: [...openPlan.steps, ...deliveryPlan.steps] }
      : (openPlan ?? deliveryPlan);
    // The budget is the chain's own seconds: what the model counted is what the
    // picture owes it.
    if (plan) {
      // Time the chain here, once, from the model's own budget — never at play
      // time and never against a clock.
      //
      // The steps carry the *picture* durations (how long a pass takes to
      // travel, how long a shield is held) and the model's budget is what it took
      // to decide the whole possession, including the ball travelling and the
      // player's own time on the ball. The steps are therefore always shorter
      // than the budget, and the difference is real football that has to be
      // shown: it is spent as settling at the end of the chain, which is what
      // makes a twelve-second chain take twelve seconds to play. See
      // `PossessionPlan.settleSeconds`.
      plans.push({
        ...plan,
        budgetSeconds: chain.seconds,
        settleSeconds: 0, // TEMP EXPERIMENT
        // Told one line per step, as each step takes the pitch.
        commentaryCount: lines?.[index]?.length,
        toldCount: 0,
        narratedStep: -1,
        // Where in the chain the dead ball falls, and what it is. Read by
        // `advancePossession` at the moment the plan reaches that step.
        restart: chain.restart ?? null,
        restartIndex: openPlan ? openPlan.steps.length : 0,
      });
    }
  }

  // The minute's words are already written; they join the back of the queue and
  // wait to be told, in the order the chains that own them will be played.
  const untold = lines?.flat() ?? [];
  if (untold.length > 0) spatial.untold = [...(spatial.untold ?? []), ...untold];

  if (plans.length === 0) return null;

  // Whatever is already queued is *appended to*, never dropped. The clock is
  // real time now, so the pitch plays football at the speed it was decided: a
  // chain the last minute did not get through is simply still waiting, and the
  // next minute's football lines up behind it. Nothing decided is ever thrown
  // away, and a possession runs across the minute mark exactly as it was played.
  if (spatial.plan) {
    spatial.pending = [...(spatial.pending ?? []), ...plans];
    return spatial.plan;
  }

  // A goal is being enjoyed and nobody is playing football under it — but the
  // football after it has still been decided, so it waits its turn rather than
  // being thrown away. `stepSpatial` takes it up the moment the celebration is
  // over.
  if (spatial.celebration) {
    spatial.pending = [...(spatial.pending ?? []), ...plans];
    return null;
  }

  const first = plans[0]!;
  clearActions(spatial);
  spatial.plan = first;
  spatial.pending = plans.slice(1);
  // A chain whose *first* step is the delivery puts the ball down before it
  // begins, rather than beginning it and then stopping the ball mid-flight. A
  // chain that reaches its restart later installs it in `advancePossession`.
  if (first.restart && first.restartIndex === 0) {
    installRestart(match, first.restart);
    return first;
  }
  beginPossessionStep(spatial, first, first.steps[0]!, match);
  return first;
}

/**
 * Advance the match by one fixed slice of simulation time.
 *
 * The clock, the players and the ball all move; then the possession plan is
 * asked whether the step it was playing is finished, and the next chain is taken
 * up if it is. Nothing is decided here: everything moved was already going
 * somewhere, and the outcome of what it is doing was settled above.
 */
export function stepSpatial(match: Match, env: MatchEnvironment, dt: number): boolean {
  const spatial = match.spatial;
  if (!spatial || dt <= 0) return false;
  spatial.clock += dt;

  const ball = spatial.ball;
  const owner = playerOf(spatial, ball.ownerId);
  const possessing: 'home' | 'away' | null = owner ? owner.side : null;
  // A goal stops being football for a moment. While it does, nobody is playing:
  // the scorer runs, his team follows him, and the rest walk back.
  const celebration = advanceCelebration(spatial, dt);

  // A dead ball is the other thing that stops the football, and for the same
  // reason: nobody is playing, so nobody should be assigned to press. This runs
  // *before* the pressers are assigned so that a man walking up to a corner is
  // not also sent to close down a ball that is lying dead on the flag.
  //
  // It returns true for as long as the ball is dead, which suspends the
  // possession machinery below: the chain that will be played is not taken up
  // until the delivery has been struck, which is the whole difference between a
  // set piece being shown and a set piece being resolved.
  const dead = advanceRestart(match, dt);

  // Who is on the ball is settled once per step, before anybody is told where
  // to go, so that the side's shape is one decision rather than eleven
  // independent ones that each read the pitch at a slightly different moment.
  if (!celebration && !dead) assignPressers(spatial, possessing);

  // Football waiting with nothing playing it is taken up rather than left lying
  // about with the ball at somebody's feet.
  //
  // The ball must not be travelling: a restart is played from where the ball
  // lies, and dropping the chain while a pass is still in the air discards the
  // football that was on its way. Removing that guard was tried and is wrong — it
  // tore up chains mid-flight and left the pitch with the ball stopped.
  if (!spatial.celebration && !spatial.restart && !spatial.plan && (spatial.pending?.length ?? 0) > 0 && ball.status !== 'travelling') {
    dropPlan(match);
  }

  // The pitch has run out of football to play and is still behind the label.
  //
  // This is a deadlock rather than a pause. With no chain and nothing queued, the
  // ball stays wherever it was while the spatial clock falls further and further
  // behind the football clock, until the conditions that would advance the minute
  // can no longer be met: the pitch is not yet a minute ahead, and it is too far
  // behind for the "nothing left to play" case to count. It then waits forever,
  // holding the ball still — the deadest window in the match was forty-five
  // seconds.
  //
  // What this layer must not do is invent football. Handing the ball to the
  // nearest player was tried and does not work: the ball moves to a man's feet
  // and stays there, because a man with the ball and no chain has nothing to do
  // with it. The deadlock is the missing *decision*, not the missing ball.
  //
  // So the pitch says so — `stepSpatial` returns true, and the caller decides a
  // minute. The call is deliberately not made from here: advancing a minute
  // installs chains through this module, so calling it would be this file calling
  // its own caller, and the minute would be decided from inside a spatial step.
  // The signal is the honest boundary — this layer knows it has nothing to play;
  // only the layer above knows how to decide what happens next.
  // Stalled means: no chain, nothing queued, and behind the match clock. The ball's
  // own state is deliberately *not* part of it — a dead ball with nobody to
  // restart it is the same stall as a live one with nobody to play it, and
  // excluding it left the pitch waiting forever for a caller that was itself
  // waiting for the clock.
  const stalled =
    !spatial.celebration &&
    !spatial.restart &&
    !spatial.plan &&
    (spatial.pending?.length ?? 0) === 0 &&
    spatial.clock < (match.footballSeconds ?? 0);
  spatial.stalled = stalled;

  for (const node of spatial.players) {
    node.px = node.x;
    node.py = node.y;
    const target = celebration
      ? celebrationTarget(spatial, node, celebration)
      : playerTarget(spatial, node, possessing);
    node.tx = target.x;
    node.ty = target.y;
    // Only the side that scored is celebrating; the other lot are walking back.
    node.action =
      celebration && celebration.side === node.side
        ? 'celebrating'
        : ball.ownerId === node.playerId
          ? 'carrying'
          : ball.targetId === node.playerId
            ? 'chasing'
            : 'shape';
    // Legs: a tired player is slower, and the match writes energy down minute by minute.
    const player = env.getPlayer(node.playerId);
    const energy = match.performances[node.playerId]?.energy ?? player?.fitness ?? 100;
    node.speed = playerSpeed(player, energy);
    updateRest(spatial, node, ball, possessing, energy);
    moveToward(node, dt, spatial.clock);
  }

  switch (ball.status) {
    case 'travelling': {
      ball.px = ball.x;
      ball.py = ball.y;
      const dx = ball.tx - ball.x;
      const dy = ball.ty - ball.y;
      const distance = Math.hypot(dx, dy);
      const step = ball.speed * dt;
      // The ball is on its target when it has covered the ground it was struck
      // over, and not merely when it has wandered close enough to it. The second
      // test used to be allowed as well, and it let a slow ball cover several
      // times its own step in one step: a pass struck over a long duration has a
      // correspondingly slow flight, so the last fraction of an inch of its
      // journey could be worth more than a whole step's travel, and the ball
      // jumped that gap instead of rolling it. A ball does not jump.
      // The ball is on its target when it has covered the ground it was struck
      // over, and not merely when it has wandered close enough to it. The second
      // test used to be allowed as well, and it let a slow ball cover several
      // times its own step in one step: a pass struck over a long duration has a
      // correspondingly slow flight, so the last fraction of an inch of its
      // journey could be worth more than a whole step's travel, and the ball
      // jumped that gap instead of rolling it. A ball does not jump.
      //
      // The third condition is the one that stops a ball hanging in the air. A
      // ball struck over a very long duration flies at a correspondingly tiny
      // speed, and if it ends up a few inches from where it was aimed then
      // `distance > step` forever: it creeps, at a rate no one can see, and never
      // arrives. That was measured at forty seconds of a match with the ball
      // frozen in mid-shot. So a ball within an inch of its target has arrived,
      // whatever its speed — the remaining distance is not worth simulating.
      if (distance <= step || step <= 0 || distance <= BALL_ARRIVAL_EPSILON) {
        ball.x = ball.tx;
        ball.y = ball.ty;
        const receiver = playerOf(spatial, ball.targetId);
        if (receiver) {
          ball.ownerId = receiver.playerId;
          ball.status = 'controlled';
          ball.targetId = null;
          ball.speed = 0;
          ball.touchedAt = spatial.clock;
          ball.lastTouchId = receiver.playerId;
        } else {
          ball.ownerId = null;
          ball.status = 'loose';
          ball.targetId = null;
          ball.speed = 0;
        }
      } else {
        ball.x += (dx / distance) * step;
        ball.y += (dy / distance) * step;
      }
      break;
    }
    case 'controlled': {
      const carrier = playerOf(spatial, ball.ownerId);
      if (!carrier) {
        ball.status = 'loose';
        ball.ownerId = null;
        break;
      }
      ball.px = ball.x;
      ball.py = ball.y;
      // The ball is at his feet: it goes where he goes.
      ball.x = carrier.x;
      ball.y = carrier.y;
      ball.tx = carrier.x;
      ball.ty = carrier.y;
      break;
    }
    case 'loose': {
      ball.px = ball.x;
      ball.py = ball.y;
      if (ball.speed > 0) {
        const dx = ball.tx - ball.x;
        const dy = ball.ty - ball.y;
        const distance = Math.hypot(dx, dy);
        const step = ball.speed * dt;
        if (distance <= step) {
          ball.x = ball.tx;
          ball.y = ball.ty;
          ball.speed = 0;
        } else {
          ball.x += (dx / distance) * step;
          ball.y += (dy / distance) * step;
          ball.speed = Math.max(0, ball.speed - LOOSE_FRICTION * dt);
        }
      }
      break;
    }
  }

  // The contract's own view of the moment: who has it, what phase that puts the
  // match in, and how much of the match's record exists. These are readings of
  // state that already lives elsewhere — the ball's owner, the match's field
  // model and its event log — kept so a consumer can read one object.
  const ownerAfter = playerOf(spatial, ball.ownerId);
  spatial.context.possession = ownerAfter?.side ?? null;
  spatial.context.phase = match.field?.phase ?? spatial.context.phase;
  spatial.context.eventCount = match.events.length;

  // Each player's own possession flag is a view of the ball's owner, written in
  // the one place the ball settles so it can never disagree with `ball.ownerId`.
  for (const node of spatial.players) {
    node.possession = ball.ownerId === node.playerId;
  }
  syncPlayerActions(spatial);

  // Now that the ball has actually moved, wake anyone resting next to it.
  //
  // The rest checks inside the player loop run *before* the ball is advanced, so
  // they can only ever see where the ball was. A loose ball rolling onto a
  // settled defender therefore woke him one frame after it arrived — by which
  // time it had rolled past him, and a frame is thirty milliseconds of a man
  // asleep next to the football. Re-checking here, once the ball is where it
  // really is, is what makes rest responsive rather than merely bounded.
  for (const node of spatial.players) {
    if (node.restUntil === undefined) continue;
    if (spatial.clock >= node.restUntil) continue;
    if (Math.hypot(ball.x - node.x, ball.y - node.y) > BALL_REACH) continue;
    node.restUntil = undefined;
  }

  // Once the ball has moved, see whether the step it belonged to is finished —
  // and, if it is, take up the next chain. Nothing is played out while the pitch
  // is celebrating: there is no move on. Nothing is played out while the ball is
  // dead either: the delivery is what ends the restart, and it has not been
  // played yet.
  if (!spatial.celebration && !spatial.restart && spatial.plan) advancePossession(match);

  // The step is done: write down where everybody ended up, so a replay can play
  // the movement back rather than draw it. A reader and nothing more — it cannot
  // change what just happened, and a match without it plays exactly the same.
  recordKeyframe(match);
  return stalled;
}

/** The formation slot a player is filling, for callers that need the code rather than the point. */
export function positionOf(spatial: MatchSpatial, playerId: PlayerId): PositionCode | null {
  return playerOf(spatial, playerId)?.position ?? null;
}
