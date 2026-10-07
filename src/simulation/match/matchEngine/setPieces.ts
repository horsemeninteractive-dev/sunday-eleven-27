import type { Rng } from '../../rng';
import { otherSide } from '../core';
// The restarts themselves — which ones exist, where each is placed, how long each
// is given, who takes it and what a strike from it is worth — are the laws of the
// game and live in `../laws`, shared with the background resolution.
import {
  RESTART_SETUP_SECONDS,
  RESTART_STRIKES,
  penaltyTaker,
  restartSpotFor,
  strikeOutcome,
} from '../laws';
import { roleProfile } from '../roles';
import { strikeBall } from './ball';
import type { DecisionWorld } from './decisions';
import { statsFor } from './events';
import { clamp, distance, goalLine, ownGoalLine, progressOf, xFromProgress } from './pitch';
import { activePlayers, keeperOf, playerOf } from './state';
import type { MatchEngineState, PlayerMatchState, SetPieceKind, SetPieceState, Side } from './types';

/**
 * Set pieces, as phases of the same simulation.
 *
 * A corner is not an animation beside the football and not an event button: the
 * engine stops the clock's football, arranges twenty-two men, has the taker walk
 * to the ball, strikes the delivery, and then lets the ordinary ball and contest
 * rules decide what it came to. Everything a corner can produce — a header, a
 * save, a scramble, a clearance, a goal kick — comes out of the same rules that
 * produce it in open play.
 */

/**
 * The centre circle's radius, as a fraction of the pitch.
 *
 * The circle is nine and a quarter yards around a pitch drawn about a hundred
 * yards long, so it is a touch under a tenth of the length. Everyone bar the
 * taker must be outside it at a kick-off.
 */
const CENTRE_CIRCLE_RADIUS = 0.09;

/**
 * Where a dead ball is placed: the law's own geometry, taken from `../laws` so
 * that both resolutions put a corner on the same blade of grass. Re-exported
 * under the name the engine has always called it.
 */
export { restartSpotFor as spotFor };

/**
 * The order to begin a dead ball with.
 *
 * Two things are the caller's rather than the laws': whether a free kick is
 * *direct* (a foul's restart is; an offside's is not), and whether the club has
 * named a taker for it.
 */
export interface SetPieceOrder {
  /** A direct free kick may be struck at goal. */
  direct?: boolean;
  /** The club's nominated taker, when the tactics name one. */
  takerId?: string | null;
}

/**
 * Choose who takes it: the nearest able man, or the keeper for a goal kick.
 *
 * A penalty follows the law in `../laws`: the club's nominated taker when it
 * named one and he is out there, and otherwise the side's most advanced
 * outfielder — its striker — never the keeper, who only takes goal kicks. The
 * nomination used to be read by the background resolution alone, which left the
 * manager's choice on the tactics screen while a watched match handed the ball to
 * somebody else.
 */
function chooseTaker(
  state: MatchEngineState,
  sp: SetPieceState,
  nominatedTakerId?: string | null,
): PlayerMatchState | null {
  if (sp.kind === 'goal-kick') {
    return keeperOf(state, sp.side) ?? activePlayers(state, sp.side)[0] ?? null;
  }
  if (sp.kind === 'penalty') {
    const outfield = activePlayers(state, sp.side).filter((player) => player.position !== 'GK');
    const pool = outfield.length > 0 ? outfield : activePlayers(state, sp.side);
    const nominated = nominatedTakerId
      ? pool.find((player) => player.playerId === nominatedTakerId)
      : undefined;
    return (
      penaltyTaker(nominated, () =>
        pool.reduce((best, player) =>
          progressOf(sp.side, player.baseX) > progressOf(sp.side, best.baseX) ? player : best,
        ),
      ) ?? null
    );
  }
  const candidates = activePlayers(state, sp.side).filter((player) => player.position !== 'GK');
  if (candidates.length === 0) return activePlayers(state, sp.side)[0] ?? null;
  return candidates.reduce((best, player) =>
    distance(player.x, player.y, sp.spot.x, sp.spot.y) < distance(best.x, best.y, sp.spot.x, sp.spot.y) ? player : best,
  );
}

/**
 * Begin a dead ball: place it, choose the taker, and hand the arrangement over.
 *
 * The spot, the time it is given and who takes it are the laws of the game
 * (`../laws`); the `order` is the caller's two bits of local knowledge — whether
 * the free kick is direct, and whether the club named a taker.
 */
export function beginSetPiece(
  state: MatchEngineState,
  kind: SetPieceKind,
  side: Side,
  spot: { x: number; y: number },
  order: SetPieceOrder = {},
): void {
  const sp: SetPieceState = {
    kind,
    side,
    spot: { x: clamp(spot.x, 0.01, 0.99), y: clamp(spot.y, 0.01, 0.99) },
    phase: 'setup',
    elapsed: 0,
    setupSeconds: RESTART_SETUP_SECONDS[kind],
    takerId: null,
    delivery: null,
    direct: order.direct ?? false,
    played: false,
    arranged: false,
  };
  sp.takerId = chooseTaker(state, sp, order.takerId)?.playerId ?? null;
  state.setPiece = sp;
  state.phase = kind === 'kickoff' ? 'kickoff' : kind;
  state.possession = side;
  const ball = state.ball;
  ball.status = 'out-of-play';
  ball.x = sp.spot.x;
  ball.y = sp.spot.y;
  ball.px = sp.spot.x;
  ball.py = sp.spot.y;
  ball.tx = sp.spot.x;
  ball.ty = sp.spot.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.speed = 0;
  ball.height = 0;
  ball.vz = 0;
  ball.ownerId = null;
  ball.targetId = null;
  ball.kind = null;
  ball.attempted = [];
  ball.intendedSide = side;
  for (const player of state.players) player.possession = false;
}

/**
 * Where everybody stands while a set piece is arranged.
 *
 * The taker goes to the ball; the attacking side crowds the area the ball is
 * going into; the defending side fills the space in front of its goal. This is
 * arrangement, not football — no outcome is decided here.
 */
function arrange(state: MatchEngineState, sp: SetPieceState, rng: Rng): void {
  const attacking = sp.side;
  const defending = otherSide(attacking);
  const facing = attacking === 'home' ? 1 : -1;
  const towardGoalX = xFromProgress(attacking, 0.92);
  const taker = playerOf(state, sp.takerId);

  for (const player of state.players) {
    if (player.sentOff) continue;

    if (taker && player.playerId === taker.playerId) {
      // The taker stands at the ball: on the spot itself for a kick-off or a
      // throw-in — where he is the one man allowed at it — and a couple of paces
      // behind it for the rest, so he can meet it.
      const back = sp.kind === 'kickoff' || sp.kind === 'throw-in' ? 0 : sp.kind === 'corner' ? 0.02 : 0.03;
      player.tx = clamp(sp.spot.x - facing * back, 0.02, 0.98);
      player.ty = clamp(sp.spot.y, 0.02, 0.98);
      player.intent = 'hold';
      continue;
    }

    if (player.side === attacking) {
      if (sp.kind === 'penalty') {
        // Everybody else waits outside the box.
        const ring = 0.18 + (player.slotIndex % 4) * 0.03;
        player.tx = clamp(state.ball.x - facing * ring, 0.05, 0.95);
        player.ty = clamp(0.35 + (player.slotIndex % 6) * 0.06, 0.2, 0.8);
      } else if (sp.kind === 'throw-in') {
        const spread = (player.slotIndex % 5) - 2;
        player.tx = clamp(sp.spot.x + facing * (0.04 + Math.abs(spread) * 0.02), 0.04, 0.96);
        player.ty = clamp(sp.spot.y - Math.sign(sp.spot.y - 0.5) * (0.03 + Math.abs(spread) * 0.04), 0.04, 0.96);
      } else if (sp.kind === 'kickoff') {
        // In their own half and clear of the centre circle: only the taker may
        // stand inside it until the ball is played. The old arrangement crowded
        // men right up to the spot, which is against the laws of the game.
        const offset = CENTRE_CIRCLE_RADIUS + 0.03 + (player.slotIndex % 5) * 0.05;
        player.tx = clamp(0.5 - facing * offset, 0.06, 0.94);
        player.ty = clamp(0.26 + (player.slotIndex % 7) * 0.08, 0.16, 0.84);
      } else {
        // A corner or a free kick: crowd the box, spread across it.
        const lane = (player.slotIndex % 6) - 2.5;
        const depth = 0.06 + (player.slotIndex % 3) * 0.03;
        player.tx = clamp(towardGoalX - facing * depth, 0.04, 0.96);
        player.ty = clamp(0.5 + lane * 0.09 + rng.float(-0.01, 0.01), 0.16, 0.84);
        player.intent = 'run';
      }
    } else {
      // Defending: fill the space in front of goal, and mark in the box.
      if (sp.kind === 'kickoff') {
        // The defending side is in its own half and outside the centre circle.
        const offset = CENTRE_CIRCLE_RADIUS + 0.03 + (player.slotIndex % 5) * 0.05;
        player.tx = clamp(0.5 + facing * offset, 0.06, 0.94);
        player.ty = clamp(0.26 + (player.slotIndex % 7) * 0.08, 0.16, 0.84);
      } else if (sp.kind === 'penalty' && player.position === 'GK') {
        // A keeper stands on his line for a penalty, on the middle of the goal,
        // not wide with the men behind the ball.
        player.tx = clamp(ownGoalLine(defending), 0.02, 0.98);
        player.ty = 0.5;
        player.intent = 'cover';
      } else if (sp.kind === 'penalty') {
        // Everybody else — both sides — waits outside the area and behind the
        // ball. Standing defenders inside the six-yard box, in the taker's path,
        // is not a penalty in any rulebook.
        const ring = 0.05 + (player.slotIndex % 5) * 0.035;
        player.tx = clamp(state.ball.x - facing * ring, 0.05, 0.95);
        player.ty = clamp(0.3 + (player.slotIndex % 6) * 0.08, 0.18, 0.82);
        player.intent = 'cover';
      } else if (sp.kind === 'throw-in') {
        const spread = (player.slotIndex % 6) - 2.5;
        player.tx = clamp(sp.spot.x - facing * (0.05 + Math.abs(spread) * 0.02), 0.04, 0.96);
        player.ty = clamp(sp.spot.y + Math.sign(0.5 - sp.spot.y) * (0.04 + Math.abs(spread) * 0.03), 0.04, 0.96);
      } else {
        const lane = (player.slotIndex % 6) - 2.5;
        const depth = 0.04 + (player.slotIndex % 3) * 0.02;
        player.tx = clamp(ownGoalLine(defending) + (defending === 'home' ? depth : -depth), 0.03, 0.97);
        player.ty = clamp(0.5 + lane * 0.1, 0.14, 0.86);
        player.intent = 'cover';
      }
    }
    player.action = 'shape';
  }
}

/** Decide what the taker is going to do with it. */
function planDelivery(state: MatchEngineState, sp: SetPieceState, rng: Rng): void {
  const side = sp.side;
  const attacking = activePlayers(state, side).filter((player) => player.playerId !== sp.takerId && player.position !== 'GK');
  const towardGoalX = xFromProgress(side, 0.92);

  const nearestMate = attacking.length
    ? attacking.reduce((best, player) =>
        distance(player.x, player.y, sp.spot.x, sp.spot.y) < distance(best.x, best.y, sp.spot.x, sp.spot.y) ? player : best,
      )
    : null;

  switch (sp.kind) {
    case 'kickoff': {
      const mate = nearestMate;
      if (mate) {
        sp.delivery = { kind: 'pass', targetId: mate.playerId, x: mate.x, y: mate.y, seconds: 1 };
      }
      break;
    }
    case 'throw-in': {
      // A throw-in is a throw, always: short to a shirt, or long into the box
      // from near it. It is never struck as a cross — the ball comes out of the
      // thrower's hands, from the touchline, not off his boot.
      const progress = progressOf(side, sp.spot.x);
      if (progress > 0.6 && rng.chance(0.5)) {
        sp.delivery = { kind: 'throw', targetId: null, x: towardGoalX, y: 0.5 + rng.float(-0.12, 0.12), seconds: 1.2 };
      } else if (nearestMate) {
        sp.delivery = { kind: 'throw', targetId: nearestMate.playerId, x: nearestMate.x, y: nearestMate.y, seconds: 1 };
      }
      break;
    }
    case 'goal-kick': {
      if (rng.chance(0.35) && nearestMate) {
        sp.delivery = { kind: 'pass', targetId: nearestMate.playerId, x: nearestMate.x, y: nearestMate.y, seconds: 1 };
      } else {
        const x = xFromProgress(side, rng.float(0.42, 0.62));
        sp.delivery = { kind: 'clear', targetId: null, x, y: 0.5 + rng.float(-0.2, 0.2), seconds: 1.4 };
      }
      break;
    }
    case 'corner': {
      const near = rng.chance(0.5);
      const y = near ? 0.5 - 0.11 : 0.5 + 0.11;
      sp.delivery = { kind: 'cross', targetId: null, x: towardGoalX - (side === 'home' ? 0.02 : -0.02), y, seconds: 1.3 };
      break;
    }
    case 'free-kick': {
      const progress = progressOf(side, sp.spot.x);
      const shooter = sp.takerId ? playerOf(state, sp.takerId) : undefined;
      const shooting = roleProfile(shooter?.role).shotZones;
      const canShoot = Boolean(shooting && (shooting.includes('final-third') || shooting.includes('box')));
      if (sp.direct && progress > 0.68 && canShoot && rng.chance(0.7)) {
        // A direct free kick at goal has the same outcomes as any other shot:
        // usually kept out, sometimes beaten, sometimes off target. What it is
        // worth is the law's, in `../laws`, so the background resolution and this
        // one cannot drift about what a free kick at goal is.
        const outcome = strikeOutcome(RESTART_STRIKES['free-kick'], rng.float(0, 1));
        const y =
          outcome === 'wide'
            ? 0.5 + (rng.chance(0.5) ? -1 : 1) * (0.055 + rng.float(0.01, 0.04))
            : 0.5 + rng.float(-0.05, 0.05);
        sp.delivery = { kind: 'shot', targetId: null, x: goalLine(side), y, seconds: 1.2, shotOutcome: outcome };
      } else if (progress > 0.5) {
        sp.delivery = { kind: 'cross', targetId: null, x: towardGoalX, y: 0.5 + rng.float(-0.14, 0.14), seconds: 1.3 };
      } else if (nearestMate) {
        sp.delivery = { kind: 'pass', targetId: nearestMate.playerId, x: nearestMate.x, y: nearestMate.y, seconds: 1 };
      }
      break;
    }
    case 'penalty': {
      const posts = { near: 0.5 - 0.055, far: 0.5 + 0.055 };
      // A penalty is a shot from the spot: mostly scored, sometimes saved, and
      // every so often put wide. "Mostly" is not "always", and how much "mostly"
      // is is the law's (`../laws`), shared with the background resolution.
      const outcome = strikeOutcome(RESTART_STRIKES.penalty, rng.float(0, 1));
      if (outcome === 'wide' || outcome === 'over') {
        const sideOfPitch = rng.chance(0.5) ? -1 : 1;
        sp.delivery = {
          kind: 'shot',
          targetId: null,
          x: goalLine(side),
          y: 0.5 + sideOfPitch * (0.055 + rng.float(0.01, 0.04)),
          seconds: 1.1,
          shotOutcome: 'wide',
        };
      } else if (outcome === 'saved') {
        // A save is struck where the keeper is; a goal into a corner.
        sp.delivery = { kind: 'shot', targetId: null, x: goalLine(side), y: 0.5 + rng.float(-0.03, 0.03), seconds: 1.1, shotOutcome: 'saved' };
      } else {
        const corner = rng.chance(0.62);
        const y = corner ? (rng.chance(0.5) ? posts.near + 0.012 : posts.far - 0.012) : 0.5 + rng.float(-0.04, 0.04);
        sp.delivery = { kind: 'shot', targetId: null, x: goalLine(side), y, seconds: 1.1, shotOutcome: 'goal' };
      }
      break;
    }
  }
}

/**
 * Whether a kick-off may be taken: everybody bar the taker is in his own half
 * and outside the centre circle.
 *
 * The law is not decoration. At a kick-off the ball is played from the centre
 * spot and every other player must be in his own half and at least nine and a
 * quarter yards from the ball — the circle is exactly that distance. Waiting for
 * the pitch to be legal rather than playing with men still wandering back is
 * what makes a kick-off look like a kick-off.
 */
function kickoffReady(state: MatchEngineState, sp: SetPieceState): boolean {
  for (const player of state.players) {
    if (player.sentOff || player.playerId === sp.takerId) continue;
    const dx = player.x - 0.5;
    const dy = player.y - 0.5;
    if (dx * dx + dy * dy < CENTRE_CIRCLE_RADIUS * CENTRE_CIRCLE_RADIUS) return false;
    if (progressOf(player.side, player.x) > 0.5) return false;
  }
  return true;
}

/**
 * Advance a set piece by one step.
 *
 * Setup holds the ball dead while the men walk up; the delivery strikes it and
 * hands the ball to the ordinary rules; the phase is cleared the moment the ball
 * is live again.
 */
export function advanceSetPiece(state: MatchEngineState, world: DecisionWorld, sp: SetPieceState, dt: number, rng: Rng): void {
  if (sp.phase === 'setup') {
    // The arrangement is laid out once, when the dead ball begins. The men walk
    // to the spots they were given under the ordinary movement rules; re-rolling
    // those spots every step would jitter them a little and spend randomness
    // describing a shape that has already been decided.
    if (!sp.arranged) {
      arrange(state, sp, rng);
      sp.arranged = true;
    }
    sp.elapsed += dt;
    const taker = playerOf(state, sp.takerId);
    // A throw-in is not taken until the taker is genuinely at the line: a looser
    // tolerance let the ball be thrown from a pace or two inside the field, which
    // is exactly what a throw-in must not look like. The margin allows for the
    // stride the movement rules always leave short of a mark.
    const arriveMargin = sp.kind === 'throw-in' ? 0.02 : 0.05;
    const arrived = !taker || distance(taker.x, taker.y, sp.spot.x, sp.spot.y) < arriveMargin;
    // A kick-off also waits for the pitch to be legal: everyone back in his own
    // half and out of the circle.
    const legal = sp.kind !== 'kickoff' || kickoffReady(state, sp);
    if (sp.elapsed >= sp.setupSeconds && arrived && legal) {
      planDelivery(state, sp, rng);
      sp.phase = 'delivery';
    }
    return;
  }

  if (sp.phase === 'delivery') {
    const delivery = sp.delivery;
    if (!delivery) {
      state.setPiece = null;
      state.phase = 'open-play';
      return;
    }
    const taker = playerOf(state, sp.takerId);
    const from = taker ? { x: taker.x, y: taker.y } : { x: sp.spot.x, y: sp.spot.y };
    strikeBall(state, {
      from,
      to: { x: delivery.x, y: delivery.y },
      kind: delivery.kind === 'throw' ? 'throw' : delivery.kind,
      speed: delivery.kind === 'shot' ? 0.7 : delivery.kind === 'throw' ? 0.2 : 0.33,
      targetId: delivery.targetId,
      intendedSide: sp.side,
      loft: delivery.kind === 'cross' || delivery.kind === 'clear' || delivery.kind === 'throw',
      playerId: sp.takerId,
      penaltyShot: sp.kind === 'penalty',
      shotOutcome: delivery.shotOutcome ?? null,
    });
    // A penalty is a shot at goal like any other, and it is counted like one.
    if (sp.kind === 'penalty') {
      const takerPerformance = sp.takerId ? world.match.performances[sp.takerId] : undefined;
      if (takerPerformance) takerPerformance.shots += 1;
      statsFor(state, sp.side).shots += 1;
    }
    sp.played = true;
    sp.phase = 'resolution';
    state.setPiece = null;
    state.phase = 'open-play';
    return;
  }

  // Resolution belongs to the ball rules; a set piece never lingers in it.
  state.setPiece = null;
  state.phase = 'open-play';
}
