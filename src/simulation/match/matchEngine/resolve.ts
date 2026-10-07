import type { Rng } from '../../rng';
import { otherSide } from '../core';
// What a foul becomes is a law of the game, shared with the background
// resolution; only the chances are this resolution's own.
import { cardForFoul } from '../laws';
import { setPieceRoutinesFor } from '../tacticsModel';
import { playerEffectiveness } from '../teamStrength';
import { giveBallTo, releaseBall } from './ball';
import { emitEvent, statsFor } from './events';
import { attackDirection, clamp, distance, distanceSq, goalLine, hasScored, inOwnBox, outOfPlay, ownGoalLine } from './pitch';
import { raiseOffside } from './offside';
import { beginSetPiece, spotFor } from './setPieces';
import { invalidateIndex, keeperOf, playerOf } from './state';
import type { DecisionWorld } from './decisions';
import type { MatchEngineState, PlayerMatchState } from './types';

/**
 * What happens when the ball meets a player.
 *
 * The ball is a first-class object, so a pass does not transfer possession; it
 * launches the ball and the football decides. This module is that decision: the
 * ball reaches a receiver or it does not, a defender reads it or he does not, a
 * tackle wins it or it does not, a shot beats the keeper or it does not. Every
 * outcome is settled from the live positions and the players' attributes, which
 * is why a deflection or a loose ball can change everything after the decision
 * that started it.
 */

/** A player's name, as a report writes it — enough to tell two men apart. */
function shortName(env: DecisionWorld['env'], playerId: string): string {
  const player = env.getPlayer(playerId);
  return player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'a player';
}

/** Within this of the ball a player can touch it. */
const CONTROL_RADIUS = 0.028;
/** Within this of a travelling ball a defender can read it. */
const INTERCEPT_RADIUS = 0.018;
/** Within this of the carrier an opponent can attempt a tackle. */
const TACKLE_RADIUS = 0.03;
/** How long after a touch the same man cannot immediately re-collect it. */
const SELF_TOUCH_LOCK = 0.35;
/** Within this of a shot a defender can get something in the way of it. */
const BLOCK_RADIUS = 0.03;
/** How long after a completed pass a goal may still be assisted by it. */
const ASSIST_WINDOW_SECONDS = 15;

/**
 * A ball knocked loose by a defender deep in his own third is being cleared, not
 * rolled at his own net.
 *
 * Left alone, a cut-out cross or a tackle won on the edge of the six-yard box
 * sent the loose ball drifting over his own line between the posts — an own goal
 * the football never earned. The release is given an outward component so that
 * a defender getting rid of the ball actually gets rid of it, while a genuine
 * slice in open play can still be punished.
 */
function clearOfOwnGoal(
  player: PlayerMatchState,
  vx: number,
  vy: number,
): { vx: number; vy: number } {
  const line = ownGoalLine(player.side);
  if (Math.abs(player.x - line) > 0.18) return { vx, vy };
  const push = attackDirection(player.side);
  return { vx: push * Math.max(Math.abs(vx), 0.05), vy };
}

/**
 * Resolve everything that happens between the ball and the players this step.
 *
 * Order matters and is deliberate: a goal is read before the ball is judged to
 * have left play, a shot is read before an interception, and a loose ball is
 * picked up before a tackle is considered.
 */
export function resolveInteractions(state: MatchEngineState, world: DecisionWorld, rng: Rng): void {
  const ball = state.ball;
  // A dead ball cannot be a goal, a save, a block or out of play, and a ball at
  // a man's feet cannot either: the goal-line and boundary rules are all false
  // for it. Answering those two cases directly saves four rule checks on every
  // step, which is most steps of a match.
  if (ball.status === 'out-of-play') return;
  if (ball.status === 'controlled') {
    checkTackles(state, world, rng);
    return;
  }

  if (checkWoodwork(state, world, rng)) return;
  if (checkSavedShot(state, world, rng)) return;
  if (checkGoal(state, world)) return;
  if (checkOutOfPlay(state, world)) return;

  if (ball.status === 'travelling') {
    if (checkBlock(state, world, rng)) return;
    if (checkKeeperCollects(state)) return;
    if (checkInterception(state, world, rng)) return;
    if (checkArrival(state, world, rng)) return;
    return;
  }

  if (ball.status === 'loose') {
    pickUpLooseBall(state, world, rng);
  }
}

// --- Goals -----------------------------------------------------------------

function checkGoal(state: MatchEngineState, world: DecisionWorld): boolean {
  const ball = state.ball;
  if (ball.status === 'out-of-play') return false;
  // A shot flagged over the bar crosses the goal line between the posts but not
  // between them *below the bar*. The geometry alone cannot see height, so the
  // shot's own outcome says what it was: it is not a goal, and the out-of-play
  // rule will give the goal kick it deserves.
  if (ball.kind === 'shot' && ball.shotOutcome === 'over') return false;
  if (hasScored('home', ball.x, ball.y)) {
    scoreGoal(state, world, 'home');
    return true;
  }
  if (hasScored('away', ball.x, ball.y)) {
    scoreGoal(state, world, 'away');
    return true;
  }
  return false;
}

/**
 * A goal: the score, the event, the celebration phase, and the ball back on the
 * spot.
 *
 * Three kinds are told apart by the ball's own story. A penalty that beats the
 * keeper is a `penalty-scored`. A goal whose last touch was an opponent is an
 * `own-goal`, credited to the side it helped and named to the man who put it in.
 * Everything else is an ordinary goal, and the man who received a teammate's
 * pass shortly before scoring is given the assist — but only when the record
 * shows that chain, never invented to make a name look busier.
 */
function scoreGoal(state: MatchEngineState, world: DecisionWorld, side: 'home' | 'away'): void {
  const ball = state.ball;
  state.score[side] += 1;
  statsFor(state, side).goals += 1;

  const scorerId = ball.lastTouchId;
  const scorer = playerOf(state, scorerId);
  const isPenalty = ball.penaltyShot;
  const ownGoal = !isPenalty && (!scorer || scorer.side !== side);

  let type: 'goal' | 'penalty-scored' | 'own-goal' = 'goal';
  let playerId: string | null = null;
  let assistId: string | null = null;
  let text = 'GOAL!';

  if (isPenalty) {
    type = 'penalty-scored';
    text = 'Penalty scored!';
    if (scorer && scorer.side === side && scorerId) {
      playerId = scorerId;
      const performance = world.match.performances[scorerId];
      if (performance) {
        performance.goals += 1;
        performance.shotsOnTarget += 1;
      }
      statsFor(state, side).shotsOnTarget += 1;
    }
  } else if (ownGoal) {
    type = 'own-goal';
    text = 'Own goal!';
    playerId = scorerId ?? null;
  } else if (scorer && scorerId) {
    playerId = scorerId;
    const performance = world.match.performances[scorerId];
    // A goal is on target: counting only the shots the keeper saved made the
    // "on target" figure disagree with the scoreboard.
    if (performance) {
      performance.goals += 1;
      performance.shotsOnTarget += 1;
    }
    statsFor(state, side).shotsOnTarget += 1;

    const lastPass = state.lastPass;
    if (
      lastPass &&
      lastPass.side === side &&
      lastPass.receiverId === scorerId &&
      lastPass.passerId !== scorerId &&
      state.clock - lastPass.clock <= ASSIST_WINDOW_SECONDS
    ) {
      assistId = lastPass.passerId;
      const assistPerformance = world.match.performances[assistId];
      if (assistPerformance) assistPerformance.assists += 1;
    }
  }

  emitEvent(state, world.match, {
    type,
    side,
    playerId,
    secondaryPlayerId: assistId,
    text,
    x: ball.x,
    y: ball.y,
    importance: 3,
    scoreAfter: { ...state.score },
  });
  state.phase = 'goal';
  state.phaseElapsed = 0;
  state.concedingSide = otherSide(side);
  // The celebration: the side that scored, and the man to mob (nobody, on an own
  // goal — the last touch was the conceding side's own). The movement rules read
  // this to send them running; it decides no football of its own, because the
  // kick-off that follows lays every man out afresh.
  state.celebration = { side, scorerId: ownGoal ? null : playerId };
  ball.status = 'out-of-play';
  // The ball stays where it crossed the line for the celebration. The kick-off
  // that follows the hold is what returns it to the centre spot; moving it here
  // meant the picture showed a ball already on the spot at the very moment it
  // should be in the net. Its previous position is collapsed onto it too, so the
  // renderer does not interpolate back towards the goal mouth from a stale `px`.
  ball.vx = 0;
  ball.vy = 0;
  ball.speed = 0;
  ball.height = 0;
  ball.vz = 0;
  ball.px = ball.x;
  ball.py = ball.y;
  ball.ownerId = null;
  ball.targetId = null;
  ball.kind = null;
  state.possession = null;
  for (const player of state.players) {
    player.possession = false;
    player.committedUntil = 0;
  }
}

// --- The ball leaving play --------------------------------------------------

function checkOutOfPlay(state: MatchEngineState, world: DecisionWorld): boolean {
  const ball = state.ball;
  if (ball.status === 'out-of-play') return false;
  if (!outOfPlay(ball.x, ball.y)) return false;

  const last = ball.lastTouchId ? playerOf(state, ball.lastTouchId)?.side ?? null : null;
  const intended = ball.intendedSide;

  // Over a touchline: a throw-in to the side that did not put it there.
  if (ball.y <= 0 || ball.y >= 1) {
    const side = last ? otherSide(last) : intended ? otherSide(intended) : 'home';
    const spot = spotFor('throw-in', side, ball);
    statsFor(state, side).throwIns += 1;
    // Begin the restart before writing it down, so the record can name the man
    // who will actually take it. A throw-in the reader cannot attach to a player
    // standing on the touchline is not a throw-in; it is a ball on the line.
    beginSetPiece(state, 'throw-in', side, spot);
    emitEvent(state, world.match, {
      type: 'throw-in',
      side,
      playerId: state.setPiece?.takerId ?? null,
      text: 'Throw-in.',
      x: spot.x,
      y: spot.y,
      importance: 1,
    });
    return true;
  }

  // Over a goal line. Which side is attacking that end?
  const attackingSide: 'home' | 'away' = ball.x <= 0 ? 'away' : 'home';
  const defending = otherSide(attackingSide);
  const lastTouchWasAttacking = last === attackingSide;

  if (lastTouchWasAttacking) {
    // The ball crossed the goal line off an attacker. If it was a shot, it was
    // a shot that missed; if it was a penalty, it was a penalty that missed. A
    // clearance or a pass over the line is neither — it is just a goal kick.
    if (ball.penaltyShot) {
      emitEvent(state, world.match, {
        type: 'penalty-missed',
        side: attackingSide,
        playerId: ball.lastTouchId,
        text: 'Penalty missed.',
        x: ball.x,
        y: ball.y,
        importance: 3,
      });
    } else if (ball.kind === 'shot') {
      emitEvent(state, world.match, {
        type: 'shot-off-target',
        side: attackingSide,
        playerId: ball.lastTouchId,
        text: 'Off target.',
        x: ball.x,
        y: ball.y,
        importance: 1,
      });
    }
    statsFor(state, defending).goalKicks += 1;
    const spot = spotFor('goal-kick', defending, ball);
    // A restart is written down as well as counted, exactly like a corner or a
    // throw-in: the statistic and the record must not disagree about a goal kick.
    emitEvent(state, world.match, {
      type: 'goal-kick',
      side: defending,
      text: 'Goal kick.',
      x: spot.x,
      y: spot.y,
      importance: 1,
    });
    beginSetPiece(state, 'goal-kick', defending, spot);
  } else {
    statsFor(state, attackingSide).corners += 1;
    emitEvent(state, world.match, {
      type: 'corner',
      side: attackingSide,
      text: 'Corner.',
      x: ball.x <= 0 ? 0.03 : 0.97,
      y: ball.y <= 0.5 ? 0.04 : 0.96,
      importance: 1,
    });
    beginSetPiece(state, 'corner', attackingSide, spotFor('corner', attackingSide, ball));
  }
  return true;
}

// --- Shots, saves and control ----------------------------------------------

/**
 * A shot off the frame.
 *
 * A shot flagged as woodwork has reached the goal-line region; it rattles the
 * post or the bar and comes back into play rather than going in or out. It is
 * an on-target attempt that did not beat the goal, and the rebound is live —
 * which is what makes a shot off the post a chance for somebody else.
 */
function checkWoodwork(state: MatchEngineState, world: DecisionWorld, rng: Rng): boolean {
  const ball = state.ball;
  if (ball.kind !== 'shot' || ball.shotOutcome !== 'woodwork' || !ball.intendedSide) return false;
  const side = ball.intendedSide;
  const line = goalLine(side);
  const reached = side === 'home' ? ball.x >= line - 0.014 : ball.x <= line + 0.014;
  if (!reached) return false;

  // Off the frame, but on target: the keeper never got near it.
  statsFor(state, side).shotsOnTarget += 1;
  const shooterId = ball.lastTouchId;
  if (shooterId) {
    const shooter = world.match.performances[shooterId];
    if (shooter) shooter.shotsOnTarget += 1;
  }
  emitEvent(state, world.match, {
    type: 'shot-off-target',
    side,
    playerId: shooterId,
    text: 'Off the woodwork!',
    x: ball.x,
    y: ball.y,
    importance: 2,
  });
  // Back into play, away from goal, for anybody to win.
  const inward = -attackDirection(side);
  releaseBall(
    state,
    clamp(ball.x + inward * 0.02, 0.03, 0.97),
    clamp(ball.y, 0.3, 0.7),
    inward * rng.float(0.08, 0.16),
    rng.float(-0.12, 0.12),
    shooterId,
  );
  return true;
}

/**
 * A defender throwing himself in front of a shot.
 *
 * Any defender, bar the keeper, goal-side of the ball can block it before it
 * reaches the goal. A block is not automatically a corner: most deflections
 * simply ricochet away and have to be won again, and only some go behind for a
 * corner.
 */
function checkBlock(state: MatchEngineState, world: DecisionWorld, rng: Rng): boolean {
  const ball = state.ball;
  if (ball.kind !== 'shot' || !ball.intendedSide || ball.penaltyShot) return false;
  const defending = otherSide(ball.intendedSide);
  const forward = attackDirection(ball.intendedSide);

  const limit = BLOCK_RADIUS * BLOCK_RADIUS;
  let best: PlayerMatchState | null = null;
  let bestDistanceSq = Infinity;
  for (const player of state.players) {
    if (player.sentOff || player.side !== defending || player.position === 'GK') continue;
    if (ball.attempted.includes(player.playerId)) continue;
    // Only a man goal-side of the ball can get in front of the shot.
    if (forward * (player.x - ball.x) <= 0) continue;
    const d2 = distanceSq(ball.x, ball.y, player.x, player.y);
    if (d2 < limit && d2 < bestDistanceSq) {
      bestDistanceSq = d2;
      best = player;
    }
  }
  if (!best) return false;
  ball.attempted.push(best.playerId);
  const bestDistance = Math.sqrt(bestDistanceSq);

  const person = world.env.getPlayer(best.playerId);
  const read = person ? playerEffectiveness(person, best.position, { energy: best.stamina }) : undefined;
  const positioning = read ? read.effective.positioning / 20 : 0.5;
  const aggression = read ? read.effective.tackling / 20 : 0.5;
  const chance = clamp(0.42 + positioning * 0.22 + aggression * 0.12 - (bestDistance / BLOCK_RADIUS) * 0.3, 0.12, 0.8);
  if (!rng.chance(chance)) return false;

  emitEvent(state, world.match, {
    type: 'shot-blocked',
    side: ball.intendedSide,
    playerId: ball.lastTouchId,
    secondaryPlayerId: best.playerId,
    text: 'Blocked!',
    x: ball.x,
    y: ball.y,
    importance: 2,
  });
  statsFor(state, defending).shotsBlocked += 1;

  if (rng.chance(0.3)) {
    const cornerSide = ball.intendedSide;
    statsFor(state, cornerSide).corners += 1;
    emitEvent(state, world.match, {
      type: 'corner',
      side: cornerSide,
      text: 'Corner.',
      x: goalLine(cornerSide) <= 0 ? 0.03 : 0.97,
      y: ball.y <= 0.5 ? 0.04 : 0.96,
      importance: 1,
    });
    beginSetPiece(state, 'corner', cornerSide, spotFor('corner', cornerSide, { x: goalLine(cornerSide), y: clamp(ball.y, 0.05, 0.95) }));
  } else {
    const inward = -forward;
    releaseBall(
      state,
      clamp(ball.x, 0.03, 0.97),
      clamp(ball.y, 0.03, 0.97),
      inward * rng.float(0.04, 0.12),
      rng.float(-0.15, 0.15),
      best.playerId,
    );
  }
  return true;
}

/** A keeper gathering anything that comes near him — a cross, a loose ball. */
function checkKeeperCollects(state: MatchEngineState): boolean {
  const ball = state.ball;
  if (!ball.intendedSide || ball.kind === 'shot') return false;
  const keeper = keeperOf(state, otherSide(ball.intendedSide));
  if (!keeper) return false;
  if (distanceSq(ball.x, ball.y, keeper.x, keeper.y) > 0.06 * 0.06) return false;
  giveBallTo(state, keeper.playerId);
  return true;
}

/**
 * A shot the keeper is going to keep out.
 *
 * The shot's outcome was settled when it was struck; this is where it is carried
 * out. The ball travels the length of the attempt and is met at the goal line, so
 * a save is a moment at the end of a shot rather than an invisible roll at its
 * start — and the keeper's ability has already had its say in whether the shot
 * was worth saving at all.
 */
function checkSavedShot(state: MatchEngineState, world: DecisionWorld, rng: Rng): boolean {
  const ball = state.ball;
  if (ball.kind !== 'shot' || ball.shotOutcome !== 'saved' || !ball.intendedSide) return false;
  const side = ball.intendedSide;
  const line = goalLine(side);
  const reached = side === 'home' ? ball.x >= line - 0.05 : ball.x <= line + 0.05;
  if (!reached) return false;

  const defending = otherSide(side);
  const keeper = keeperOf(state, defending);
  const shooterId = ball.lastTouchId;
  statsFor(state, defending).saves += 1;
  if (keeper) {
    const savingPerformance = world.match.performances[keeper.playerId];
    if (savingPerformance) savingPerformance.saves += 1;
  }
  if (ball.penaltyShot) {
    // A saved penalty is a missed penalty; it is told as one, whatever the
    // keeper then does with the ball.
    emitEvent(state, world.match, {
      type: 'penalty-missed',
      side,
      playerId: shooterId,
      secondaryPlayerId: keeper?.playerId ?? null,
      text: 'Penalty saved!',
      x: ball.x,
      y: ball.y,
      importance: 3,
    });
  } else {
    // A shot on target is one the keeper had to deal with.
    if (shooterId) {
      const shooter = world.match.performances[shooterId];
      if (shooter) shooter.shotsOnTarget += 1;
    }
    statsFor(state, side).shotsOnTarget += 1;
    emitEvent(state, world.match, {
      type: 'shot-saved',
      side,
      playerId: shooterId,
      secondaryPlayerId: keeper?.playerId ?? null,
      text: 'Saved!',
      x: ball.x,
      y: ball.y,
      importance: 2,
    });
  }

  if (keeper && rng.chance(0.55)) {
    giveBallTo(state, keeper.playerId);
  } else {
    // Parried away from his own goal — back into play, toward the nearer
    // touchline — rather than straight back through the middle of his own net.
    const intoPlay = attackDirection(defending);
    const lateral = ball.y <= 0.5 ? -1 : 1;
    releaseBall(state, ball.x, ball.y, intoPlay * rng.float(0.05, 0.12), lateral * rng.float(0.06, 0.16), keeper?.playerId ?? null);
  }
  return true;
}

/** A defender reading a travelling ball that is not meant for him. */
function checkInterception(state: MatchEngineState, world: DecisionWorld, rng: Rng): boolean {
  const ball = state.ball;
  if (!ball.intendedSide) return false;
  // A shot is met by a block or by the keeper, never "read" like a pass.
  if (ball.kind === 'shot') return false;
  const hunting = otherSide(ball.intendedSide);

  const limit = INTERCEPT_RADIUS * INTERCEPT_RADIUS;
  let best: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.sentOff || player.side !== hunting) continue;
    // One read per man per flight. Rolling every step turned a single misplaced
    // pass into a dozen chances at it, which is how a match ended up with seven
    // hundred interceptions in it.
    if (ball.attempted.includes(player.playerId)) continue;
    const d2 = distanceSq(ball.x, ball.y, player.x, player.y);
    if (d2 < limit && d2 < bestDistance) {
      bestDistance = d2;
      best = player;
    }
  }
  if (!best) return false;
  ball.attempted.push(best.playerId);

  const person = world.env.getPlayer(best.playerId);
  const read = person ? playerEffectiveness(person, best.position, { energy: best.stamina }) : undefined;
  const ability = read ? (read.effective.positioning + read.effective.ballControl) / 40 : 0.5;
  const speed = clamp(Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) / 0.4, 0, 1);
  const chance = clamp(0.32 + ability * 0.4 - speed * 0.25, 0.1, 0.9);
  if (!rng.chance(chance)) return false;

  statsFor(state, best.side).interceptions += 1;
  const performance = world.match.performances[best.playerId];
  if (performance) performance.interceptions += 1;
  emitEvent(state, world.match, {
    type: 'note',
    side: best.side,
    playerId: best.playerId,
    text: 'Intercepted.',
    x: ball.x,
    y: ball.y,
    importance: 1,
  });

  if (rng.chance(0.6)) giveBallTo(state, best.playerId);
  else {
    const loose = clearOfOwnGoal(best, rng.float(-0.1, 0.1), rng.float(-0.1, 0.1));
    releaseBall(state, ball.x, ball.y, loose.vx, loose.vy, best.playerId);
  }
  return true;
}

/** The ball reaching a player, or simply arriving at its aim point with nobody there. */
function checkArrival(state: MatchEngineState, world: DecisionWorld, rng: Rng): boolean {
  const ball = state.ball;
  // A shot is never "met" like a pass. Its fate is a block, a save, or the
  // goal line; letting it be collected by whoever stood nearest the net swallowed
  // shots on the very brink of crossing and turned them into silent turnovers.
  if (ball.kind === 'shot') return false;
  const receiver = ball.targetId ? playerOf(state, ball.targetId) : undefined;
  const intendedArrives = receiver && !receiver.sentOff && distance(receiver.x, receiver.y, ball.x, ball.y) < 0.06;
  const reachedAim = distanceSq(ball.x, ball.y, ball.tx, ball.ty) < 0.03 * 0.03;

  // Whoever is actually there when the ball is there meets it: the intended man
  // if he made it, otherwise the nearest player in the vicinity.
  let meet = intendedArrives ? receiver! : undefined;
  if (!meet && reachedAim) meet = nearestWithin(state, ball.x, ball.y, 0.055) ?? undefined;
  if (!meet) return false;

  // The law was judged when the ball was played: if the man meeting it is the
  // one left in an offside position, the move ends here, not with a touch.
  if (meet.playerId === ball.offsidePlayerId && meet.side === ball.intendedSide) {
    raiseOffside(state, world, meet);
    return true;
  }

  const person = world.env.getPlayer(meet.playerId);
  const read = person ? playerEffectiveness(person, meet.position, { energy: meet.stamina }) : undefined;
  const control = read ? read.effective.ballControl / 20 : 0.5;
  const marker = closestOpponent(state, meet);
  const pressure = marker ? clamp(1 - distance(marker.x, marker.y, meet.x, meet.y) / 0.12, 0, 1) : 0;
  const heightPenalty = ball.height > 0.25 ? 0.12 : 0;
  const chance = clamp(0.68 + control * 0.3 - pressure * 0.3 - heightPenalty, 0.25, 0.97);

  if (rng.chance(chance)) {
    // Read the passer before the ball changes hands: `giveBallTo` overwrites
    // `lastTouchId`, so reading it afterwards always names the receiver.
    const passerId = ball.lastTouchId;
    giveBallTo(state, meet.playerId);
    meet.committedUntil = state.clock + 0.5;
    if (passerId && passerId !== meet.playerId && meet.side === ball.intendedSide) {
      const passer = world.match.performances[passerId];
      if (passer) passer.passesCompleted += 1;
      statsFor(state, meet.side).passesCompleted += 1;
      // Remember the chain, so a goal soon afterwards can be assisted.
      state.lastPass = { passerId, receiverId: meet.playerId, side: meet.side, clock: state.clock };
    }
    return true;
  }
  const loose = clearOfOwnGoal(meet, rng.float(-0.08, 0.08), rng.float(-0.08, 0.08));
  releaseBall(state, ball.x, ball.y, loose.vx, loose.vy, meet.playerId);
  return true;
}

/** The nearest player to a point within a radius, or null. */
function nearestWithin(state: MatchEngineState, x: number, y: number, radius: number): PlayerMatchState | null {
  let best: PlayerMatchState | null = null;
  let bestDistanceSq = radius * radius;
  for (const player of state.players) {
    if (player.sentOff) continue;
    const d2 = distanceSq(player.x, player.y, x, y);
    if (d2 < bestDistanceSq) {
      bestDistanceSq = d2;
      best = player;
    }
  }
  return best;
}

function closestOpponent(state: MatchEngineState, player: PlayerMatchState): PlayerMatchState | null {
  let best: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const other of state.players) {
    if (other.sentOff || other.side === player.side) continue;
    const d2 = distanceSq(player.x, player.y, other.x, other.y);
    if (d2 < bestDistance) {
      bestDistance = d2;
      best = other;
    }
  }
  return best;
}

/** Any player near enough to a loose ball takes it. */
function pickUpLooseBall(state: MatchEngineState, world: DecisionWorld, rng: Rng): void {
  const ball = state.ball;
  if (state.clock - ball.touchedAt < SELF_TOUCH_LOCK && ball.lastTouchId) {
    // The man who just released it cannot instantly re-collect it, but nobody
    // else is barred — so only the releaser is skipped below.
  }

  let best: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.sentOff) continue;
    if (player.playerId === ball.lastTouchId && state.clock - ball.touchedAt < SELF_TOUCH_LOCK) continue;
    // A keeper's reach in his own box is a good deal longer than anybody else's.
    const reach = player.position === 'GK' && inOwnBox(player.side, ball.x, ball.y) ? 0.075 : CONTROL_RADIUS;
    const d2 = distanceSq(ball.x, ball.y, player.x, player.y);
    if (d2 < reach * reach && d2 < bestDistance) {
      bestDistance = d2;
      best = player;
    }
  }
  if (!best) return;

  const person = world.env.getPlayer(best.playerId);
  const read = person ? playerEffectiveness(person, best.position, { energy: best.stamina }) : undefined;
  const control = read ? read.effective.ballControl / 20 : 0.5;
  if (!rng.chance(clamp(0.65 + control * 0.3, 0.3, 0.98))) {
    // Knocked loose rather than controlled.
    const loose = clearOfOwnGoal(best, rng.float(-0.06, 0.06), rng.float(-0.06, 0.06));
    releaseBall(state, ball.x, ball.y, loose.vx, loose.vy, best.playerId);
    return;
  }
  giveBallTo(state, best.playerId);
  best.committedUntil = state.clock + 0.5;
}

// --- Challenges -------------------------------------------------------------

/** Opponents close enough to the carrier to attempt a challenge. */
function checkTackles(state: MatchEngineState, world: DecisionWorld, rng: Rng): void {
  const ball = state.ball;
  const carrier = ball.ownerId ? playerOf(state, ball.ownerId) : undefined;
  if (!carrier) return;

  // One challenge per possession: a man carries the ball, somebody has a go at
  // him, and after that it is the football's business again. Attempting one per
  // defender per step is what made tackles and fouls ten times too frequent.
  if (ball.attempted.length > 0) return;
  // Everybody on top of the carrier this instant is one challenge, not one per
  // man per frame: they attempt as a group, they are on cooldown as a group, and
  // the next attempt is a fresh challenge a second or so later.
  // Only a man who has actually gone to close the ball down challenges for it —
  // and the nearest such man who is not still committed to something else is the
  // one who does, found in a single walk rather than a filter, a copy and a sort
  // (and one array allocation) on every step the ball is at a man's feet.
  const limit = TACKLE_RADIUS * TACKLE_RADIUS;
  let challenger: PlayerMatchState | null = null;
  let bestDistance = Infinity;
  for (const player of state.players) {
    if (player.sentOff || player.side === carrier.side) continue;
    if (player.intent !== 'press' && player.intent !== 'chase') continue;
    if (player.committedUntil > state.clock) continue;
    const d2 = distanceSq(player.x, player.y, carrier.x, carrier.y);
    if (d2 < limit && d2 < bestDistance) {
      bestDistance = d2;
      challenger = player;
    }
  }
  if (!challenger) return;
  ball.attempted.push(challenger.playerId);

  const defenderPerson = world.env.getPlayer(challenger.playerId);
  const carrierPerson = world.env.getPlayer(carrier.playerId);
  const tackling = defenderPerson
    ? playerEffectiveness(defenderPerson, challenger.position, { energy: challenger.stamina }).effective.tackling / 20
    : 0.5;
  const control = carrierPerson
    ? playerEffectiveness(carrierPerson, carrier.position, { energy: carrier.stamina }).effective.ballControl / 20
    : 0.5;
  const winChance = clamp(0.18 + tackling * 0.4 - control * 0.22, 0.06, 0.66);

  if (rng.chance(winChance)) {
    statsFor(state, challenger.side).tackles += 1;
    const performance = world.match.performances[challenger.playerId];
    if (performance) performance.tackles += 1;
    emitEvent(state, world.match, {
      type: 'tackle',
      side: challenger.side,
      playerId: challenger.playerId,
      secondaryPlayerId: carrier.playerId,
      text: `${shortName(world.env, challenger.playerId)} wins it.`,
      x: ball.x,
      y: ball.y,
      importance: 1,
    });
    if (rng.chance(0.6)) giveBallTo(state, challenger.playerId);
    else {
      const loose = clearOfOwnGoal(challenger, rng.float(-0.12, 0.12), rng.float(-0.12, 0.12));
      releaseBall(state, ball.x, ball.y, loose.vx, loose.vy, challenger.playerId);
    }
    return;
  }

  // A failed challenge is sometimes a foul.
  const discipline = defenderPerson
    ? playerEffectiveness(defenderPerson, challenger.position, { energy: challenger.stamina }).effective.discipline / 20
    : 0.5;
  const foulChance = clamp(0.06 + (1 - discipline) * 0.12, 0.02, 0.24);
  if (!rng.chance(foulChance)) return;

  commitFoul(state, world, challenger, carrier, rng);
}

/**
 * A foul: stop the game, free kick to the victim's side, and sometimes a card.
 *
 * Exported so a test can hand it a scripted referee and prove, without waiting
 * for a seed to oblige, that a foul in the area can become a penalty and one
 * outside it cannot.
 */
export function commitFoul(state: MatchEngineState, world: DecisionWorld, offender: PlayerMatchState, victim: PlayerMatchState, rng: Rng): void {
  const side = victim.side;
  statsFor(state, offender.side).fouls += 1;
  const offenderPerformance = world.match.performances[offender.playerId];
  if (offenderPerformance) offenderPerformance.fouls += 1;

  emitEvent(state, world.match, {
    type: 'foul',
    side: offender.side,
    playerId: offender.playerId,
    secondaryPlayerId: victim.playerId,
    text: 'Foul.',
    x: state.ball.x,
    y: state.ball.y,
    importance: 2,
  });

  // Bring the two men together on the pitch, so the restart is where it happened.
  const spot = { x: state.ball.x, y: state.ball.y };
  victim.x = spot.x;
  victim.y = spot.y;

  // The referee's verdict on the challenge.
  judgeFoul(state, world, offender, rng);

  // Inside the defender's own box, a foul can be a penalty — but not every one
  // is: a foul in the area is usually a direct offence, yet the referee plays a
  // good deal of them as nothing, or judges the ball already gone. A penalty is
  // uncommon, not automatic, and when it is given it is taken through the same
  // set-piece machinery as any other restart.
  if (inOwnBox(offender.side, spot.x, spot.y) && rng.chance(0.06)) {
    emitEvent(state, world.match, {
      type: 'note',
      side,
      playerId: victim.playerId,
      text: 'Penalty awarded.',
      x: spot.x,
      y: spot.y,
      importance: 3,
    });
    beginSetPiece(state, 'penalty', side, spotFor('penalty', side, spot), {
      // The manager's nominated taker, when he named one and the man is out
      // there — the law in `../laws`, and what the background resolution has
      // always done.
      takerId: setPieceRoutinesFor(world.match, side).penaltyTakerId ?? null,
    });
    return;
  }

  // A free kick only for the direct kind if it is near enough to be worth a shot.
  beginSetPiece(state, 'free-kick', side, spot, { direct: true });
}

/**
 * The referee's verdict on a foul: a booking, a second booking, or a red.
 *
 * A booking is rare, and rarer still on a good-natured Sunday. A second booking
 * is a sending off — the man was already walking a line and stepped over it —
 * and a straight red stands on its own: a lunge, a stamp, a shove, judged from
 * the offender's discipline and how tightly the referee is running the game. Off
 * he goes, and the football plays ten against eleven from there.
 *
 * The ladder is the law's and is obeyed through `cardForFoul` (`../laws`), so the
 * background resolution cannot quietly decide that a booking is something else.
 * What is local — the two chances and the order of the writes below — is
 * deliberately unchanged, so sharing the rule moved no football.
 */
function judgeFoul(
  state: MatchEngineState,
  world: DecisionWorld,
  offender: PlayerMatchState,
  rng: Rng,
): void {
  const person = world.env.getPlayer(offender.playerId);
  const discipline = person?.attributes.behavioural.discipline ?? 10;
  const strictness = clamp(world.env.refereeStrictness / 20, 0, 1);

  // The referee's verdict, through the shared law: a straight red is its own
  // event and is decided first, so it cannot be swallowed by the booking that
  // would otherwise have followed.
  const decision = cardForFoul(
    rng,
    {
      straightRed: 0.0009 * (1 + (14 - discipline) / 8) * (1 + strictness),
      yellow: 0.05 + strictness * 0.03 + (offender.booked ? 0.015 : 0),
      // The law itself, not a calibration: a booked man who is booked again is
      // off. The background resolution passes its own share here because at its
      // foul rate the law sent men off several times too often, and says so.
      secondYellowShare: 1,
    },
    offender.booked,
  );
  if (decision === 'straight-red') {
    sendOff(state, world, offender, 'straight-red');
    return;
  }
  if (decision === 'none') return;

  const performance = world.match.performances[offender.playerId];
  statsFor(state, offender.side).yellowCards += 1;
  if (performance) performance.yellowCards += 1;

  if (decision === 'second-yellow') {
    sendOff(state, world, offender, 'second-yellow');
    return;
  }

  offender.booked = true;
  const coords = { x: state.ball.x, y: state.ball.y };
  emitEvent(state, world.match, {
    type: 'yellow-card',
    side: offender.side,
    playerId: offender.playerId,
    text: 'Booked.',
    x: coords.x,
    y: coords.y,
    importance: 3,
  });
}

/**
 * Off he goes.
 *
 * A sent-off man is not moved anywhere and not removed from anywhere: the node
 * stays on the pitch array carrying `sentOff`, and every rule of the football —
 * the decisions, the movement, the challenges — has always skipped a man who is
 * sent off. That is what makes ten men a fact about the play rather than a hole
 * in an array. His team sheet keeps his slot, so the shape does not shuffle
 * underneath the survivors, and his side is weaker only because
 * `buildContext` leaves him out of the strength.
 */
export function sendOff(
  state: MatchEngineState,
  world: DecisionWorld,
  player: PlayerMatchState,
  kind: 'second-yellow' | 'straight-red',
): void {
  if (player.sentOff) return;
  player.sentOff = true;
  player.possession = false;
  // He is off the pitch now: the derived lookups must stop counting him.
  invalidateIndex(state);
  // He stops where he is; nothing teleports, least of all a man walking off.
  player.tx = player.x;
  player.ty = player.y;
  if (state.ball.ownerId === player.playerId) {
    releaseBall(state, state.ball.x, state.ball.y, 0, 0, player.playerId);
  }

  const performance = world.match.performances[player.playerId];
  if (performance) {
    performance.sentOff = true;
    performance.wentOffMinute = world.match.minute;
    // A second yellow is a dismissal but not a red card in the record; only the
    // straight red counts as one, which is how the statistic reads everywhere.
    if (kind === 'straight-red') performance.redCards += 1;
  }
  if (kind === 'straight-red') statsFor(state, player.side).redCards += 1;

  emitEvent(state, world.match, {
    type: 'red-card',
    side: player.side,
    playerId: player.playerId,
    text: kind === 'second-yellow' ? 'Second yellow — off.' : 'Straight red — off.',
    x: player.x,
    y: player.y,
    importance: 3,
  });
}
