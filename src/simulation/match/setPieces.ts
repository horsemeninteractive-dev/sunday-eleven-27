import type { PlayerId } from '@/domain/ids';
import type { Match, MatchEvent } from '@/domain/match';
import type { ActionOutcome, RestartState } from '@/domain/matchState';
import type { Player } from '@/domain/person';
import type { Rng } from '../rng';
import { shotAction, type TimelineAction } from './actionTimeline';
import {
  eventCoords,
  makeEvent,
  otherSide,
  performanceOf,
  pushEvent,
  type MatchContext,
  type MatchEnvironment,
  type Side,
} from './core';
import { progressOf, xFromProgress } from './field';
import { resolveShot } from './shot';
import {
  beginCorner,
  beginFreeKick,
  beginGoalKick,
  beginPenalty,
  beginThrowIn,
  SETUP_SECONDS,
} from './restarts';
import { setPieceRoutinesFor } from './tacticsModel';
import { playerEffectiveness } from './teamStrength';

/**
 * Set pieces.
 *
 * A corner, a free kick or a throw is not an incident that "happens" and is then
 * over — it is a small passage of play of its own, with a taker, a contest and a
 * consequence. Each routine below runs that passage and hands the caller back the
 * ball where it finished, so the match carries on from the right place rather
 * than being reset by the next minute.
 *
 * They are also what makes the fouls mean something. The old engine decided a
 * foul had happened and then gave the other side nothing; now a foul in the box
 * is a penalty and a foul thirty yards out is a shooting chance, which is why a
 * desperate challenge late in a tight game now costs something.
 *
 * **What each routine now also returns is the delivery it decided, and the dead
 * ball it came from.** Both used to be discarded here: the cross was resolved and
 * thrown away, leaving the pitch nothing to play, and the corner existed only as
 * a line in the event log. Returning them as ordinary {@link TimelineAction}s
 * means the spatial layer plays the *same* routine that was rolled here — the
 * outcome on the action is the outcome just decided, so the picture shows that
 * football rather than playing a new one and hoping the two agree.
 *
 * Nothing about the rolling changes. The same draws, in the same order, produce
 * the same events and the same results; only what happens to be *written down*
 * has been added.
 */

export interface RoutineOutcome {
  /** Who has the ball when the routine is over. */
  nextSide: Side;
  nextPlayerId: PlayerId | null;
  x: number;
  y: number;
  goal: boolean;
  /** True when the defending side won it and can break from here. */
  counter: boolean;
  /**
   * The delivery, as the possession model decided it.
   *
   * Empty for a routine that resolved without the ball being played — which
   * should not happen, and which the restart layer treats as "nothing to show"
   * rather than as a reason to invent a cross.
   */
  actions: TimelineAction[];
  /** The dead ball to arrange before the delivery is played. */
  restart: RestartState;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * A delivery, written down.
 *
 * `startSecond` is relative to the minute rather than absolute, because that is
 * what the timeline means everywhere else and one clock is the whole point of
 * this type.
 */
function delivery(spec: {
  kind: 'cross' | 'pass' | 'clear';
  side: Side;
  from: PlayerId | null;
  to: PlayerId | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  outcome: ActionOutcome;
}): TimelineAction {
  return {
    kind: spec.kind,
    decision: spec.kind,
    side: spec.side,
    playerId: spec.from,
    targetPlayerId: spec.to,
    fromX: spec.fromX,
    fromY: spec.fromY,
    toX: spec.toX,
    toY: spec.toY,
    startSecond: 0,
    // A corner is a high ball that has to arrive; a throw is two feet of grass.
    // Taking the duration from the routine rather than from the geometry is what
    // lets a short corner actually be short.
    duration: Math.hypot(spec.toX - spec.fromX, spec.toY - spec.fromY) / 0.34,
    outcome: spec.outcome,
  };
}

/** The best header of the ball a side has out there. */
function pickHeaderer(match: Match, env: MatchEnvironment, side: Side, rng: Rng): Player | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
      const target = slot.position === 'ST' || slot.position === 'CB' || slot.position === 'AM' ? 1.5 : 1;
      return {
        value: player,
        weight: Math.max(0.0001, (eff.effective.heading * 0.6 + eff.effective.strength * 0.4) * target),
      };
    });
  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

/** How good a side is in the air, weighted toward the men who actually jump. */
function aerialPower(match: Match, env: MatchEnvironment, side: Side): number {
  const scores: number[] = [];
  for (const slot of match.lineups[side].starting) {
    if (slot.position === 'GK') continue;
    const player = env.getPlayer(slot.playerId);
    if (!player) continue;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
    scores.push(eff.effective.heading * 0.6 + eff.effective.strength * 0.4);
  }
  if (scores.length === 0) return 10;
  scores.sort((a, b) => a - b);
  const top = scores.slice(-4);
  return top.reduce((sum, value) => sum + value, 0) / top.length;
}

/** The taker: whoever in the side crosses it best. */
function pickTaker(match: Match, env: MatchEnvironment, side: Side, options: { preferId?: PlayerId | null; spot?: { x: number; y: number } } = {}): Player | null {
  const preferred = options.preferId ? env.getPlayer(options.preferId) : undefined;
  if (preferred) return preferred;
  let best: Player | null = null;
  let bestScore = -1;
  for (const slot of match.lineups[side].starting) {
    if (slot.position === 'GK') continue;
    const player = env.getPlayer(slot.playerId);
    if (!player) continue;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
    const wide = slot.position === 'RM' || slot.position === 'LM' || slot.position === 'RW' || slot.position === 'LW' ? 1.3 : 1;
    // Ability alone, deliberately: not where he is on the pitch.
    //
    // Weighting this by distance to the flag was tried and it made the *engine*
    // depend on the picture: the taker also becomes `nextPlayerId` on a short
    // corner, so a different man changed the next possession, and a match pressed
    // on at a different rate came out with a different score. It does not need to
    // anyway — the taker is placed on his spot when the restart is arranged, so
    // how far away he was is a question about the animation, not the football.
    const score = (eff.effective.crossing + eff.effective.passing * 0.4) * wide;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best;
}

/** The man you would want stepping up from twelve yards. */
function pickPenaltyTaker(match: Match, env: MatchEnvironment, side: Side): Player | null {
  const routines = setPieceRoutinesFor(match, side);
  // A named taker is a manager saying "this one". It outranks ability, because
  // the whole point of having drilled a penalty is that the drill decides.
  if (routines.penaltyTakerId) {
    const named = env.getPlayer(routines.penaltyTakerId);
    const onPitch = match.lineups[side].starting.some((slot) => slot.playerId === routines.penaltyTakerId);
    if (named && onPitch) return named;
  }
  let best: Player | null = null;
  let bestScore = -1;
  for (const slot of match.lineups[side].starting) {
    if (slot.position === 'GK') continue;
    const player = env.getPlayer(slot.playerId);
    if (!player) continue;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
    const score = eff.effective.shooting * 0.5 + eff.effective.composure * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best;
}

/** The ball is hacked clear and somebody is standing on it. */
function clearanceOutcome(
  match: Match,
  env: MatchEnvironment,
  defendingSide: Side,
  rng: Rng,
  options: { counterChance: number },
  /** The delivery that was cleared, so the picture can show it being cleared. */
  deliverySoFar: TimelineAction[],
  restart: RestartState,
): RoutineOutcome {
  // Where the clearance lands: mostly into midfield, sometimes all the way back.
  const progress = rng.float(0.2, 0.5);
  const x = xFromProgress(defendingSide, progress);
  const y = clamp(rng.float(0.15, 0.85), 0.05, 0.95);
  const winner = pickHeaderer(match, env, defendingSide, rng);
  // The clearance itself is a delivery, and it is the last thing the routine
  // decided — so it is on the timeline too. A corner that was headed clear is a
  // corner plus a header, and showing only the corner would show a ball arriving
  // at nobody.
  const cleared = delivery({
    kind: 'clear',
    side: defendingSide,
    from: winner?.id ?? null,
    to: null,
    fromX: restart.ballX,
    fromY: restart.ballY,
    toX: x,
    toY: y,
    outcome: 'completed',
  });
  return {
    nextSide: defendingSide,
    nextPlayerId: winner?.id ?? null,
    x,
    y,
    goal: false,
    counter: rng.chance(options.counterChance),
    actions: [...deliverySoFar, cleared],
    restart,
  };
}

/**
 * Where a corner is aimed.
 *
 * A side that has drilled a routine aims at a *place* — the near post, the far
 * post, the penalty spot. A side that has not aims at the middle of the box,
 * which is what actually happens when nobody has told anybody where to stand.
 * This is the whole of the set-piece slice's effect on the football: not a
 * better roll, a different idea.
 */
function cornerTarget(
  routine: 'near-post' | 'far-post' | 'short' | 'central' | 'untrained',
  restart: RestartState,
  rng: Rng,
): { x: number; y: number } {
  const attackX = restart.side === 'home' ? 1 : -1;
  const nearY = restart.ballY < 0.5 ? 0.1 : 0.9;
  const farY = restart.ballY < 0.5 ? 0.9 : 0.1;
  const boxX = attackX === 1 ? 0.88 : 0.12;
  switch (routine) {
    case 'near-post':
      return { x: attackX === 1 ? 0.96 : 0.04, y: nearY };
    case 'far-post':
      return { x: attackX === 1 ? 0.94 : 0.06, y: farY };
    case 'short':
      return { x: attackX === 1 ? 0.74 : 0.26, y: clamp(restart.ballY + (restart.ballY < 0.5 ? 0.14 : -0.14), 0.05, 0.95) };
    case 'central':
      return { x: boxX, y: 0.5 };
    case 'untrained':
    default:
      // "Somewhere in the box, and it varies", which is both what untrained
      // means and what makes an untrained corner a worse one.
      return { x: boxX, y: rng.float(0.25, 0.75) };
  }
}

/**
 * A corner.
 *
 * Most are delivered and contested — the header is a genuine chance and the
 * better side in the air wins more of them — but a short one, or one that is
 * cleared only as far as the edge of the box, keeps the move alive, because that
 * is what a corner usually is: pressure that does not quite end.
 */
export function takeCorner(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  rng: Rng,
  sink: MatchEvent[],
): RoutineOutcome {
  const opponent = otherSide(side);
  const sideY = rng.chance(0.5) ? 0.03 : 0.97;
  const taker = pickTaker(match, env, side, { spot: { x: side === 'home' ? 0.985 : 0.015, y: sideY } });
  pushEvent(
    match,
    makeEvent(match, 'corner', {
      minute: match.minute,
      side,
      playerId: taker?.id ?? null,
      text: `Corner to ${env.clubShortName(side === 'home' ? match.homeClubId : match.awayClubId)}.`,
      x: eventCoords(match, side === 'home' ? 0.98 : 0.02, sideY).x,
      y: sideY,
      importance: 1,
    }),
    sink,
  );

  // The corner is given before anything else happens to it, which is what makes
  // the picture's dead ball and the match's own record the same moment: the
  // ball is on the flag from the frame the corner event is written.
  const target = cornerTarget(setPieceRoutinesFor(match, side).corner, beginCorner(side, taker?.id ?? null, undefined, undefined, sideY), rng);
  const restart = beginCorner(side, taker?.id ?? null, undefined, undefined, sideY);

  // A short one, played to a man on the edge, keeps possession without a cross.
  if (rng.chance(0.16)) {
    const x = xFromProgress(side, clamp(rng.float(0.72, 0.84), 0.1, 0.9));
    const y = rng.chance(0.5) ? 0.12 : 0.88;
    return {
      nextSide: side,
      nextPlayerId: taker?.id ?? null,
      x,
      y,
      goal: false,
      counter: false,
      actions: [
        delivery({
          kind: 'pass',
          side,
          from: taker?.id ?? null,
          to: taker?.id ?? null,
          fromX: restart.ballX,
          fromY: restart.ballY,
          toX: x,
          toY: y,
          outcome: 'completed',
        }),
      ],
      restart,
    };
  }

  const cross = delivery({
    kind: 'cross',
    side,
    from: taker?.id ?? null,
    to: null,
    fromX: restart.ballX,
    fromY: restart.ballY,
    toX: target.x,
    toY: target.y,
    outcome: 'completed',
  });

  const attack = aerialPower(match, env, side) * context[side].profile.aerialMultiplier;
  const defence = aerialPower(match, env, opponent) * context[opponent].strength.organisation;
  const edge = attack / Math.max(0.2, defence);
  const homeBoost = side === 'home' ? 0.03 : 0;
  const pAttackWins = clamp(0.26 + (edge - 1) * 0.4 + homeBoost, 0.12, 0.6);

  if (!rng.chance(pAttackWins)) {
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.32 }, [cross], restart);
  }

  const headerer = pickHeaderer(match, env, side, rng);
  if (!headerer) return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.3 }, [cross], restart);

  const goalX = side === 'home' ? 1 : 0;
  const shot = resolveShot(
    match,
    env,
    context,
    side,
    {
      shooterId: headerer.id,
      assisterId: taker?.id ?? null,
      chanceQuality: clamp01(0.36 + rng.float(0, 0.34)),
      x: goalX === 1 ? 0.94 : 0.06,
      y: clamp(0.5 + rng.float(-0.16, 0.16), 0.24, 0.76),
      pressure: 0.5,
      assistKind: 'cross',
      blockers: 1,
      fromSetPiece: true,
    },
    rng,
    sink,
  );

  // The header, as it was actually struck and at what it was worth. Written
  // after `resolveShot` so its outcome is the one that was decided, not a second
  // roll for the same event.
  const header = shotAction({
    kind: 'shot',
    decision: 'header',
    side,
    playerId: headerer.id,
    targetPlayerId: null,
    fromX: target.x,
    fromY: target.y,
    toX: goalX,
    toY: 0.5,
    startSecond: 0,
    outcome: shot.type === 'goal' ? 'goal' : shot.type === 'shot-saved' ? 'saved' : shot.type === 'shot-blocked' ? 'blocked' : 'off-target',
  });

  if (shot.type === 'goal') {
    return {
      nextSide: opponent,
      nextPlayerId: null,
      x: 0.5,
      y: 0.5,
      goal: true,
      counter: false,
      actions: [cross, header],
      restart,
    };
  }
  if (shot.type === 'shot-blocked') {
    // Half-cleared, half still live — a scramble on the edge of the box.
    if (rng.chance(0.45)) {
      return {
        nextSide: side,
        nextPlayerId: headerer.id,
        x: xFromProgress(side, clamp(rng.float(0.76, 0.86), 0.1, 0.9)),
        y: clamp(0.5 + rng.float(-0.24, 0.24), 0.1, 0.9),
        goal: false,
        counter: false,
        actions: [cross, header],
        restart,
      };
    }
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.4 }, [cross, header], restart);
  }
  // Saved or off target: the keeper has it, or it has gone behind.
  return {
    nextSide: opponent,
    nextPlayerId: null,
    x: xFromProgress(opponent, 0.05),
    y: 0.5,
    goal: false,
    counter: false,
    actions: [cross, header],
    restart,
  };
}

/**
 * A free kick.
 *
 * Close enough and central enough and it is a shot — the wall is why it is
 * harder to block than an open-play effort, but the keeper is set, so it is not
 * the free hit a penalty is. Everything else is a delivery or a short restart.
 */
export function takeFreeKick(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  rng: Rng,
  sink: MatchEvent[],
  spot?: { x: number; y: number },
): RoutineOutcome {
  const opponent = otherSide(side);
  const ball = match.field?.ball;
  const progress = ball ? progressOf(side, ball.x) : 0.5;
  const central = ball ? Math.abs(ball.y - 0.5) < 0.2 : true;
  const goalX = side === 'home' ? 1 : 0;

  // The free kick is taken from where it was given. A foul that happened at a
  // player's feet on the pitch is taken from *those* feet; only when the caller
  // has no better answer does the field model stand in for it.
  const at = spot ?? { x: ball?.x ?? 0.5, y: ball?.y ?? 0.5 };
  const taker = pickTaker(match, env, side, { spot: at });
  const restart = beginFreeKick(side, at.x, at.y, taker?.id ?? null, undefined, undefined);

  if (progress > 0.68 && central) {
    const shooter = taker ?? pickPenaltyTaker(match, env, side);
    if (!shooter) {
      return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.25 }, [], restart);
    }
    const shot = resolveShot(
      match,
      env,
      context,
      side,
      {
        shooterId: shooter.id,
        assisterId: null,
        chanceQuality: clamp01(0.2 + rng.float(0, 0.18)),
        x: goalX === 1 ? clamp(0.72 + rng.float(0, 0.12), 0.6, 0.92) : clamp(0.28 - rng.float(0, 0.12), 0.08, 0.4),
        y: clamp(0.5 + rng.float(-0.2, 0.2), 0.2, 0.8),
        pressure: 0.25,
        assistKind: 'set-piece',
        blockers: 0,
        fromSetPiece: true,
      },
      rng,
      sink,
    );
    const effort = shotAction({
      kind: 'shot',
      decision: 'free-kick',
      side,
      playerId: shooter.id,
      targetPlayerId: null,
      fromX: restart.ballX,
      fromY: restart.ballY,
      toX: goalX,
      toY: 0.5,
      startSecond: 0,
      outcome: shot.type === 'goal' ? 'goal' : shot.type === 'shot-saved' ? 'saved' : shot.type === 'shot-blocked' ? 'blocked' : 'off-target',
    });
    return finishRoutine(opponent, shot.type === 'goal', shot.type === 'shot-saved', [effort], restart);
  }

  // A delivery into the box, the same contest as a corner but from further out.
  if (progress > 0.52 && rng.chance(0.72)) {
    const attack = aerialPower(match, env, side) * context[side].profile.aerialMultiplier;
    const defence = aerialPower(match, env, opponent) * context[opponent].strength.organisation;
    const pAttackWins = clamp(0.22 + (attack / Math.max(0.2, defence) - 1) * 0.35, 0.1, 0.5);
    const aim = { x: goalX === 1 ? 0.9 : 0.1, y: clamp(restart.ballY + rng.float(-0.12, 0.12), 0.15, 0.85) };
    const intoBox = delivery({
      kind: 'cross',
      side,
      from: taker?.id ?? null,
      to: null,
      fromX: restart.ballX,
      fromY: restart.ballY,
      toX: aim.x,
      toY: aim.y,
      outcome: 'completed',
    });
    if (rng.chance(pAttackWins)) {
      const headerer = pickHeaderer(match, env, side, rng);
      if (headerer) {
        const shot = resolveShot(
          match,
          env,
          context,
          side,
          {
            shooterId: headerer.id,
            assisterId: taker?.id ?? null,
            chanceQuality: clamp01(0.3 + rng.float(0, 0.28)),
            x: goalX === 1 ? 0.93 : 0.07,
            y: clamp(0.5 + rng.float(-0.16, 0.16), 0.24, 0.76),
            pressure: 0.52,
            assistKind: 'set-piece',
            blockers: 1,
            fromSetPiece: true,
          },
          rng,
          sink,
        );
        const header = shotAction({
          kind: 'shot',
          decision: 'header',
          side,
          playerId: headerer.id,
          targetPlayerId: null,
          fromX: aim.x,
          fromY: aim.y,
          toX: goalX,
          toY: 0.5,
          startSecond: 0,
          outcome: shot.type === 'goal' ? 'goal' : shot.type === 'shot-saved' ? 'saved' : shot.type === 'shot-blocked' ? 'blocked' : 'off-target',
        });
        return finishRoutine(opponent, shot.type === 'goal', shot.type === 'shot-saved', [intoBox, header], restart);
      }
    }
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.3 }, [intoBox], restart);
  }

  // A quick one, played short and kept.
  const to = {
    x: xFromProgress(side, clamp(progress + 0.08, 0.2, 0.85)),
    y: ball?.y ?? 0.5,
  };
  return {
    nextSide: side,
    nextPlayerId: taker?.id ?? null,
    x: to.x,
    y: to.y,
    goal: false,
    counter: false,
    actions: [
      delivery({
        kind: 'pass',
        side,
        from: taker?.id ?? null,
        to: taker?.id ?? null,
        fromX: restart.ballX,
        fromY: restart.ballY,
        toX: to.x,
        toY: to.y,
        outcome: 'completed',
      }),
    ],
    restart,
  };
}

/** Twelve yards, one keeper, and the whole ground watching. */
export function takePenalty(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  rng: Rng,
  sink: MatchEvent[],
): RoutineOutcome {
  const opponent = otherSide(side);
  const taker = pickPenaltyTaker(match, env, side);
  if (!taker) {
    return clearanceOutcome(
      match,
      env,
      opponent,
      rng,
      { counterChance: 0.2 },
      [],
      beginPenalty(side, null, undefined),
    );
  }
  const restart = beginPenalty(side, taker.id, undefined);
  const goalX = side === 'home' ? 1 : 0;
  const shot = resolveShot(
    match,
    env,
    context,
    side,
    {
      shooterId: taker.id,
      assisterId: null,
      chanceQuality: 1,
      x: goalX === 1 ? 0.88 : 0.12,
      y: 0.5,
      pressure: 0.1,
      assistKind: 'set-piece',
      blockers: 0,
      fromSetPiece: true,
      penalty: true,
    },
    rng,
    sink,
  );
  // A penalty is one action and no delivery to aim at: the spot is the spot.
  const spot = shotAction({
    kind: 'shot',
    decision: 'penalty',
    side,
    playerId: taker.id,
    targetPlayerId: null,
    fromX: restart.ballX,
    fromY: restart.ballY,
    toX: goalX,
    toY: 0.5,
    startSecond: 0,
    outcome: shot.type === 'goal' ? 'goal' : shot.type === 'shot-saved' ? 'saved' : shot.type === 'shot-blocked' ? 'blocked' : 'off-target',
  });
  if (shot.type === 'goal') {
    return { nextSide: opponent, nextPlayerId: null, x: 0.5, y: 0.5, goal: true, counter: false, actions: [spot], restart };
  }
  if (shot.type === 'shot-saved') {
    // The keeper keeps it out — the rebound is live for a heartbeat.
    if (rng.chance(0.3)) {
      return {
        nextSide: side,
        nextPlayerId: taker.id,
        x: xFromProgress(side, 0.85),
        y: 0.5,
        goal: false,
        counter: false,
        actions: [spot],
        restart,
      };
    }
    return {
      nextSide: opponent,
      nextPlayerId: null,
      x: xFromProgress(opponent, 0.05),
      y: 0.5,
      goal: false,
      counter: false,
      actions: [spot],
      restart,
    };
  }
  return {
    nextSide: opponent,
    nextPlayerId: null,
    x: xFromProgress(opponent, 0.05),
    y: 0.5,
    goal: false,
    counter: false,
    actions: [spot],
    restart,
  };
}

/**
 * A throw-in.
 *
 * Almost always it is just the game restarting — the ball goes back into play
 * where it went out and nobody writes it down. Occasionally, deep in the
 * attacking half, somebody has a long one and it becomes an aerial contest.
 *
 * This is the routine that writes its own event. It used to deliberately write
 * none, on the grounds that a throw is not worth a line of commentary — which is
 * true, and also the reason a viewer could not see the ball leave the pitch at
 * all. The event is now written, and the ball is visibly out of play until it is
 * back in.
 */
export function takeThrowIn(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  rng: Rng,
  sink: MatchEvent[],
  spot?: { x: number; y: number },
): RoutineOutcome {
  const opponent = otherSide(side);
  const ball = match.field?.ball;
  const progress = ball ? progressOf(side, ball.x) : 0.4;
  const y = ball ? (ball.y < 0.5 ? 0.03 : 0.97) : 0.03;
  const at = spot ?? { x: ball?.x ?? 0.5, y: ball?.y ?? 0.5 };

  pushEvent(
    match,
    makeEvent(match, 'throw-in', {
      minute: match.minute,
      side,
      playerId: null,
      text: 'Throw-in.',
      x: eventCoords(match, at.x, at.y).x,
      y: at.y,
      // The lowest an event can go. A throw-in is worth recording and not worth
      // being read out over the top of something else.
      importance: 1,
    }),
    sink,
  );

  const taker = pickTaker(match, env, side, { spot: at });
  const restart = beginThrowIn(side, at.x, at.y, taker?.id ?? null, undefined, undefined);

  if (progress > 0.7 && rng.chance(0.28)) {
    const attack = aerialPower(match, env, side);
    const defence = aerialPower(match, env, opponent) * context[opponent].strength.organisation;
    const pAttackWins = clamp(0.16 + (attack / Math.max(0.2, defence) - 1) * 0.3, 0.06, 0.42);
    const long = delivery({
      kind: 'cross',
      side,
      from: taker?.id ?? null,
      to: null,
      fromX: restart.ballX,
      fromY: restart.ballY,
      toX: side === 'home' ? 0.9 : 0.1,
      toY: clamp(0.5 + rng.float(-0.15, 0.15), 0.2, 0.8),
      outcome: 'completed',
    });
    if (rng.chance(pAttackWins)) {
      const headerer = pickHeaderer(match, env, side, rng);
      if (headerer) {
        const goalX = side === 'home' ? 1 : 0;
        const shot = resolveShot(
          match,
          env,
          context,
          side,
          {
            shooterId: headerer.id,
            assisterId: taker?.id ?? null,
            chanceQuality: clamp01(0.24 + rng.float(0, 0.24)),
            x: goalX === 1 ? 0.93 : 0.07,
            y: clamp(0.5 + rng.float(-0.18, 0.18), 0.22, 0.78),
            pressure: 0.55,
            assistKind: 'set-piece',
            blockers: 2,
            fromSetPiece: true,
          },
          rng,
          sink,
        );
        const header = shotAction({
          kind: 'shot',
          decision: 'header',
          side,
          playerId: headerer.id,
          targetPlayerId: null,
          fromX: side === 'home' ? 0.9 : 0.1,
          fromY: long.toY,
          toX: goalX,
          toY: 0.5,
          startSecond: 0,
          outcome: shot.type === 'goal' ? 'goal' : shot.type === 'shot-saved' ? 'saved' : shot.type === 'shot-blocked' ? 'blocked' : 'off-target',
        });
        return finishRoutine(opponent, shot.type === 'goal', shot.type === 'shot-saved', [long, header], restart);
      }
    }
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.24 }, [long], restart);
  }

  const to = { x: xFromProgress(side, clamp(progress + rng.float(0, 0.06), 0.1, 0.88)), y: 0.5 };
  return {
    nextSide: side,
    nextPlayerId: taker?.id ?? null,
    x: to.x,
    y: clamp(y + (y < 0.5 ? 0.06 : -0.06), 0.03, 0.97),
    goal: false,
    counter: false,
    actions: [
      delivery({
        kind: 'pass',
        side,
        from: taker?.id ?? null,
        to: null,
        fromX: restart.ballX,
        fromY: restart.ballY,
        toX: to.x,
        toY: to.y,
        outcome: 'completed',
      }),
    ],
    restart,
  };
}

/**
 * The ball is behind for a goal kick, or the keeper has gathered it.
 *
 * Distribution is a real decision, not a formality: a side that wants to play
 * out starts a build-up from its own box, and a side that does not launches it.
 *
 * A goal kick is the one restart taken by the goalkeeper, which is why it reads
 * differently from every other one before anyone has been told what it is.
 */
export function goalKick(match: Match, side: Side, rng: Rng): RoutineOutcome {
  const keeperSlot = match.lineups[side].starting.find((slot) => slot.position === 'GK');
  const direct = rng.chance(0.45);
  const to = {
    x: xFromProgress(side, direct ? rng.float(0.42, 0.56) : 0.14),
    y: clamp(0.5 + rng.float(-0.3, 0.3), 0.15, 0.85),
  };
  const restart = beginGoalKick(side, keeperSlot?.playerId ?? null, undefined, undefined);
  return {
    nextSide: side,
    nextPlayerId: keeperSlot?.playerId ?? null,
    x: to.x,
    y: to.y,
    goal: false,
    counter: direct,
    actions: [
      delivery({
        kind: direct ? 'clear' : 'pass',
        side,
        from: keeperSlot?.playerId ?? null,
        to: null,
        fromX: restart.ballX,
        fromY: restart.ballY,
        toX: to.x,
        toY: to.y,
        outcome: 'completed',
      }),
    ],
    restart,
  };
}

/** Where the game restarts after a set-piece attempt that did not go in. */
function finishRoutine(
  opponent: Side,
  goal: boolean,
  saved: boolean,
  actions: TimelineAction[],
  restart: RestartState,
): RoutineOutcome {
  if (goal) return { nextSide: opponent, nextPlayerId: null, x: 0.5, y: 0.5, goal: true, counter: false, actions, restart };
  if (saved) {
    // The keeper has it: a goal kick, or a throw out that starts a break.
    return {
      nextSide: opponent,
      nextPlayerId: null,
      x: xFromProgress(opponent, 0.05),
      y: 0.5,
      goal: false,
      counter: true,
      actions,
      restart,
    };
  }
  return {
    nextSide: opponent,
    nextPlayerId: null,
    x: xFromProgress(opponent, 0.06),
    y: 0.5,
    goal: false,
    counter: false,
    actions,
    restart,
  };
}

/** Re-exported so callers can size a restart's setup without importing both. */
export { SETUP_SECONDS };