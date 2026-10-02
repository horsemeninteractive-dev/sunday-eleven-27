import type {
  BallSpatial,
  Celebration,
  Match,
  MatchEvent,
  MatchSpatial,
  Passage,
  PassageOutcome,
  PassageStep,
  PlayerSpatial,
} from '@/domain/match';
import type { Player } from '@/domain/person';
import { getFormation, type PositionCode } from '@/domain/positions';
import type { PlayerId } from '@/domain/ids';
import type { Rng } from '../rng';
import type { MatchEnvironment } from './engine';

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
 * The two layers are tied together by one object: the {@link Passage}. It is
 * planned here, from the names the engine actually used, and then used twice —
 * this layer plays it out on the pitch, and the narrator describes it. That is
 * the whole reason the words and the picture agree: they are the same passage,
 * not two accounts of the same minute.
 *
 * Positions are fractions of the pitch, 0..1 along each side, with the home side
 * always attacking toward x = 1 and the away side toward x = 0 — the same frame
 * the pitch is drawn in, so a renderer only has to place what it is given.
 */

/** How many seconds of football movement one match minute is played out over. */
export const SPATIAL_SECONDS_PER_MINUTE = 6;
/** The fixed step the simulation is advanced in, so outcomes cannot depend on frame rate. */
export const SPATIAL_STEP_SECONDS = 1 / 30;
/**
 * The most movement one call may spend.
 *
 * Enough to catch up a whole minute and a half of football, so the fastest
 * speed on a slow screen still shows the move the clock is on; small enough
 * that a tab returning from the background does not replay the match in a
 * single jolt.
 */
const SPATIAL_MAX_CATCH_UP_SECONDS = SPATIAL_SECONDS_PER_MINUTE * 1.5;
const SPATIAL_MAX_STEPS = Math.ceil(SPATIAL_MAX_CATCH_UP_SECONDS / SPATIAL_STEP_SECONDS) + 1;

/** How far a pass travels per simulation second, in pitch-lengths. */
const PASS_SPEED = 0.34;
/** A shot is struck harder than a pass. */
const SHOT_SPEED = 0.72;
/** A loose ball slows to a stop over this per second. */
const LOOSE_FRICTION = 0.5;
/** How long the first step of a passage is given. */
const CARRY_SECONDS = 1.2;
/** And the strike itself. */
const SHOT_SECONDS = 1.3;
/**
 * How long the pitch spends on a goal.
 *
 * Long enough to see the scorer get away and be caught, short enough that it
 * does not swallow the rest of the match: a minute of football is six seconds
 * here, so this is a little over half a minute's worth.
 */
const CELEBRATION_SECONDS = 4;

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
  return { x, y, px: x, py: y, tx: x, ty: y, status: 'loose', ownerId: null, targetId: null, speed: 0, height: 0 };
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
    baseX: base.x,
    baseY: base.y,
    x: base.x,
    y: base.y,
    px: base.x,
    py: base.y,
    tx: base.x,
    ty: base.y,
    speed: playerSpeed(player, energy),
    action: 'shape',
  };
}

/**
 * Build the spatial state from the teams on the pitch, if it is not there yet.
 *
 * This is also how an old save grows the pitch underneath it: the lineups and
 * the formations are already stored, so the players can be placed from them
 * whenever the state is first asked for.
 */
export function ensureSpatial(match: Match, env: MatchEnvironment): MatchSpatial {
  if (match.spatial) return match.spatial;

  const players: PlayerSpatial[] = [];
  for (const side of SIDES) {
    match.lineups[side].starting.forEach((slot, index) => {
      players.push(placePlayer(match, env, side, slot.playerId, slot.position, index));
    });
  }

  match.spatial = { players, ball: ballSpatial(0.5, 0.5), clock: 0, residual: 0, passage: null, celebration: null };
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

  for (const side of SIDES) {
    const starting = match.lineups[side].starting;
    const onPitch = new Set(starting.map((slot) => slot.playerId));
    for (let index = spatial.players.length - 1; index >= 0; index -= 1) {
      const node = spatial.players[index]!;
      if (node.side === side && !onPitch.has(node.playerId)) spatial.players.splice(index, 1);
    }
    starting.forEach((slot, index) => {
      if (spatial.players.some((node) => node.playerId === slot.playerId)) return;
      const placed = placePlayer(match, env, side, slot.playerId, slot.position, index);
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

  // And a passage that names a player who is no longer out there is over.
  const passage = spatial.passage;
  if (passage && passage.steps.some((step) => !stillOn(step.playerId) || (step.targetId && !stillOn(step.targetId)))) {
    spatial.passage = null;
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
  spatial.residual += Math.min(deltaSeconds, SPATIAL_MAX_CATCH_UP_SECONDS);
  let guard = 0;
  while (spatial.residual >= SPATIAL_STEP_SECONDS && guard < SPATIAL_MAX_STEPS) {
    stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    spatial.residual -= SPATIAL_STEP_SECONDS;
    guard += 1;
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
  return clamp(spatial.residual / SPATIAL_STEP_SECONDS, 0, 1);
}

/** The defending player closest to the ball, who is the one sent to close it down. */
function closestToBall(spatial: MatchSpatial, side: 'home' | 'away'): PlayerId | null {
  const ball = spatial.ball;
  let best: PlayerSpatial | null = null;
  let bestDistance = Infinity;
  for (const node of spatial.players) {
    if (node.side !== side || node.position === 'GK') continue;
    const distance = Math.hypot(ball.x - node.x, ball.y - node.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best?.playerId ?? null;
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

  // A ball coming to him is the one thing that overrides shape: he goes to meet
  // it, which is what makes a pass look like a pass.
  if (ball.status === 'travelling' && ball.targetId === node.playerId) {
    return { x: ball.tx, y: ball.ty };
  }

  // The man playing out his own step goes where the step is pointed. Carrying
  // it, that means driving at the goal; the ball goes with him because it is at
  // his feet, and that is what carries a move on between one minute and the next.
  const passage = spatial.passage;
  const step = passage ? passage.steps[passage.step] : undefined;
  if (step?.kind === 'carry' && step.playerId === node.playerId) {
    const goalX = node.side === 'home' ? 0.92 : 0.08;
    return { x: goalX, y: clamp(node.y + (0.5 - node.y) * 0.12, 0.12, 0.88) };
  }

  // A keeper stays on his line and shuffles across with play.
  if (node.position === 'GK') {
    const line = node.side === 'home' ? 0.05 : 0.95;
    return { x: line, y: clamp(0.5 + (ball.y - 0.5) * 0.3, 0.34, 0.66) };
  }

  const from = { x: node.baseX, y: node.baseY };
  const distance = Math.hypot(ball.x - from.x, ball.y - from.y);

  // Closing down. Without this the picture is two teams holding shape while the
  // ball rolls past them, which is what made it read like a diagram.
  if (possessing !== null && possessing !== node.side && closestToBall(spatial, node.side) === node.playerId) {
    const ballOrCarrier = playerOf(spatial, ball.ownerId) ?? { x: ball.x, y: ball.y };
    return { x: clamp(ballOrCarrier.x, 0.03, 0.97), y: clamp(ballOrCarrier.y, 0.04, 0.96) };
  }

  // Support. The side with the ball gives the carrier somewhere to go: men near
  // him push beyond and outside instead of crowding the same blade of grass.
  if (possessing === node.side && ball.ownerId && ball.ownerId !== node.playerId) {
    const d = Math.hypot(ball.x - node.x, ball.y - node.y);
    if (d < 0.26) {
      const forward = attackDirection(node.side) * 0.055;
      const sideways = node.y >= ball.y ? 1 : -1;
      return { x: clamp(node.x + forward, 0.02, 0.98), y: clamp(node.y + sideways * 0.05, 0.04, 0.96) };
    }
  }

  // Everyone else holds shape with a light pull toward the ball.
  const attraction = clamp(0.4 - distance * 0.9, 0.03, 0.32);
  const lean = possessing === node.side ? 0.09 : -0.05;
  const x = from.x + attackDirection(node.side) * lean;
  return {
    x: clamp(x * (1 - attraction) + ball.x * attraction, 0.02, 0.98),
    y: clamp(from.y * (1 - attraction) + ball.y * attraction, 0.03, 0.97),
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
  spatial.passage = null;
  spatial.celebration = { side, scorerId, elapsed: 0 };
}

function moveToward(node: PlayerSpatial, dt: number): void {
  const dx = node.tx - node.x;
  const dy = node.ty - node.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-4) return;
  const step = Math.min(distance, node.speed * dt);
  node.x = clamp(node.x + (dx / distance) * step, 0.02, 0.98);
  node.y = clamp(node.y + (dy / distance) * step, 0.03, 0.97);
}

/** Put the ball at a player's feet. */
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
  return { kind: 'carry', playerId, targetId: null, outcome: null, text: null, duration, elapsed: 0, started: false };
}

function passStep(fromId: PlayerId, toId: PlayerId, duration: number): PassageStep {
  return { kind: 'pass', playerId: fromId, targetId: toId, outcome: null, text: null, duration, elapsed: 0, started: false };
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
export function planPassage(
  match: Match,
  env: MatchEnvironment,
  side: 'home' | 'away',
  receivers: readonly PlayerId[],
  events: readonly MatchEvent[],
  rng: Rng,
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
        elapsed: 0,
        started: false,
      });
      return { side, minute, step: 0, steps };
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
  if (!creatorId) return { side, minute, step: 0, steps: [] };

  const steps: PassageStep[] = [carryStep(creatorId, CARRY_SECONDS)];
  let from = creatorId;
  for (const to of chain) {
    if (to === from) continue;
    steps.push(passStep(from, to, passSeconds(spatial, from, to)));
    from = to;
  }
  if (steps.length === 1) steps[0]!.duration = CARRY_SECONDS * 1.6;
  return { side, minute, step: 0, steps };
}

/** Put the planned move into play, and let the passage begin. */
export function applyMinuteSpatial(match: Match, env: MatchEnvironment, passage: Passage): void {
  const spatial = match.spatial;
  if (!spatial) return;
  syncSpatial(match, env);
  // The pitch is still celebrating the last goal. This minute's move would be
  // played into the middle of a huddle, so it is dropped rather than queued:
  // the minute it belongs to has already started on the clock, and playing it
  // late would put the picture behind the words.
  if (spatial.celebration) return;
  const first = passage.steps[0];
  // A plan that outlives the players it names is dropped rather than played
  // with ghosts.
  if (!first || !playerOf(spatial, first.playerId)) return;
  spatial.passage = passage;
  beginPassageStep(spatial);
}

/**
 * Start the current step.
 *
 * Each step is one thing a player does: he carries it, he plays it, or he hits
 * it. Nothing is decided by starting a step — the outcome of a shot was the
 * engine's to give — so this can only make the pitch catch up with the plan.
 */
function beginPassageStep(spatial: MatchSpatial): void {
  const passage = spatial.passage;
  if (!passage) return;
  const step = passage.steps[passage.step];
  if (!step || step.started) return;

  if (step.kind === 'carry') {
    const node = playerOf(spatial, step.playerId);
    if (!node) {
      spatial.passage = null;
      return;
    }
    const ball = spatial.ball;
    if (ball.status === 'controlled' && ball.ownerId === step.playerId) {
      step.started = true;
      return;
    }
    // The ball is gathered, not teleported: if it is not already at his feet it
    // travels to him while he goes to meet it. That is what stops possession
    // changing with a pop, which is the one move in the picture a manager would
    // notice as wrong.
    if (Math.hypot(ball.x - node.x, ball.y - node.y) > 0.02) {
      if (ball.status !== 'travelling' || ball.targetId !== step.playerId) {
        travelTo(spatial, { x: ball.x, y: ball.y }, { x: node.x, y: node.y }, step.playerId, PASS_SPEED);
      }
      return;
    }
    giveBallTo(spatial, step.playerId);
    step.started = true;
    return;
  }

  step.started = true;

  if (step.kind === 'pass') {
    const target = playerOf(spatial, step.targetId);
    if (!target) {
      spatial.passage = null;
      return;
    }
    travelTo(spatial, { x: spatial.ball.x, y: spatial.ball.y }, { x: target.x, y: target.y }, target.playerId, PASS_SPEED);
    return;
  }

  const shooter = playerOf(spatial, step.playerId);
  // Struck from wherever the ball actually is: normally that is the shooter's
  // feet, because the pass into him has finished, but never assume it.
  const from =
    shooter && spatial.ball.status !== 'travelling'
      ? { x: shooter.x, y: shooter.y }
      : { x: spatial.ball.x, y: spatial.ball.y };
  const goalX = passage.side === 'home' ? 0.995 : 0.005;
  const goalY = clamp(0.5 + (from.y - 0.5) * 0.35, 0.15, 0.85);
  travelTo(spatial, from, { x: goalX, y: goalY }, null, SHOT_SPEED);
}

/**
 * Has this step done what it set out to do?
 *
 * A pass is over when it arrives, not when its clock runs out — a pass cut off
 * mid-flight would restart the ball somewhere else, which is the jump this whole
 * layer exists to avoid. The duration is only a safety net for a receiver who
 * cannot get there.
 */
function passageStepDone(spatial: MatchSpatial, step: PassageStep): boolean {
  const ball = spatial.ball;
  if (step.kind === 'pass') {
    if (ball.status === 'controlled' && ball.ownerId === step.targetId) return true;
    if (ball.status === 'loose') return true;
    return step.elapsed > step.duration * 3;
  }
  if (step.kind === 'shot') return ball.status !== 'travelling' || step.elapsed > step.duration * 3;
  return step.elapsed >= step.duration;
}

function advancePassage(spatial: MatchSpatial, dt: number): void {
  const passage = spatial.passage;
  if (!passage) return;
  const step = passage.steps[passage.step];
  if (!step) {
    spatial.passage = null;
    return;
  }
  // A step that is still waiting for the ball to reach the man it names is not
  // being played yet, so its clock has not started.
  if (!step.started) {
    beginPassageStep(spatial);
    return;
  }
  step.elapsed += dt;
  if (!passageStepDone(spatial, step)) return;
  // A goal is the one step nothing follows: the ball is in the net, so the move
  // is over and the celebration takes the pitch instead.
  if (step.kind === 'shot' && (step.outcome === 'goal' || step.outcome === 'penalty-scored')) {
    startCelebration(spatial, passage.side, step.playerId);
    return;
  }
  passage.step += 1;
  if (passage.step >= passage.steps.length) {
    spatial.passage = null;
    return;
  }
  beginPassageStep(spatial);
}

/**
 * Advance the match by a fixed slice of simulation time.
 *
 * Everything moved here is already going somewhere; nothing is decided here.
 * Called often — this is the continuous part.
 */
export function stepSpatial(match: Match, env: MatchEnvironment, dt: number): void {
  const spatial = match.spatial;
  if (!spatial || dt <= 0) return;
  spatial.clock += dt;

  const ball = spatial.ball;
  const owner = playerOf(spatial, ball.ownerId);
  const possessing: 'home' | 'away' | null = owner ? owner.side : null;
  // A goal stops being football for a moment. While it does, nobody is playing:
  // the scorer runs, his team follows him, and the rest walk back.
  const celebration = advanceCelebration(spatial, dt);

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
    node.speed = playerSpeed(player, match.performances[node.playerId]?.energy ?? player?.fitness ?? 100);
    moveToward(node, dt);
  }

  switch (ball.status) {
    case 'travelling': {
      ball.px = ball.x;
      ball.py = ball.y;
      const dx = ball.tx - ball.x;
      const dy = ball.ty - ball.y;
      const distance = Math.hypot(dx, dy);
      const step = ball.speed * dt;
      if (distance <= step || distance < 1e-4) {
        ball.x = ball.tx;
        ball.y = ball.ty;
        const receiver = playerOf(spatial, ball.targetId);
        if (receiver) {
          ball.ownerId = receiver.playerId;
          ball.status = 'controlled';
          ball.targetId = null;
          ball.speed = 0;
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

  // Once the ball has moved, see whether the step it belonged to is finished.
  // Nothing is played out while the pitch is celebrating — there is no move on.
  if (!spatial.celebration) advancePassage(spatial, dt);
}

/** The formation slot a player is filling, for callers that need the code rather than the point. */
export function positionOf(spatial: MatchSpatial, playerId: PlayerId): PositionCode | null {
  return playerOf(spatial, playerId)?.position ?? null;
}
