import type { PlayerId } from '@/domain/ids';
import type { Match, MatchEvent } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { Rng } from '../rng';
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
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, 4);
  return top.reduce((sum, value) => sum + value, 0) / top.length;
}

/** The taker: whoever in the side crosses it best. */
function pickTaker(match: Match, env: MatchEnvironment, side: Side, options: { preferId?: PlayerId | null } = {}): Player | null {
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
): RoutineOutcome {
  // Where the clearance lands: mostly into midfield, sometimes all the way back.
  const progress = rng.float(0.2, 0.5);
  const x = xFromProgress(defendingSide, progress);
  const y = clamp(rng.float(0.15, 0.85), 0.05, 0.95);
  const winner = pickHeaderer(match, env, defendingSide, rng);
  return {
    nextSide: defendingSide,
    nextPlayerId: winner?.id ?? null,
    x,
    y,
    goal: false,
    counter: rng.chance(options.counterChance),
  };
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
  const taker = pickTaker(match, env, side);
  const sideY = rng.chance(0.5) ? 0.03 : 0.97;
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

  // A short one, played to a man on the edge, keeps possession without a cross.
  if (rng.chance(0.16)) {
    return {
      nextSide: side,
      nextPlayerId: taker?.id ?? null,
      x: xFromProgress(side, clamp(rng.float(0.72, 0.84), 0.1, 0.9)),
      y: rng.chance(0.5) ? 0.12 : 0.88,
      goal: false,
      counter: false,
    };
  }

  const attack = aerialPower(match, env, side) * context[side].profile.aerialMultiplier;
  const defence = aerialPower(match, env, opponent) * context[opponent].strength.organisation;
  const edge = attack / Math.max(0.2, defence);
  const homeBoost = side === 'home' ? 0.03 : 0;
  const pAttackWins = clamp(0.26 + (edge - 1) * 0.4 + homeBoost, 0.12, 0.6);

  if (!rng.chance(pAttackWins)) {
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.32 });
  }

  const headerer = pickHeaderer(match, env, side, rng);
  if (!headerer) return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.3 });

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

  if (shot.type === 'goal') {
    return { nextSide: opponent, nextPlayerId: null, x: 0.5, y: 0.5, goal: true, counter: false };
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
      };
    }
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.4 });
  }
  // Saved or off target: the keeper has it, or it has gone behind.
  return { nextSide: opponent, nextPlayerId: null, x: xFromProgress(opponent, 0.05), y: 0.5, goal: false, counter: false };
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
): RoutineOutcome {
  const opponent = otherSide(side);
  const ball = match.field?.ball;
  const progress = ball ? progressOf(side, ball.x) : 0.5;
  const central = ball ? Math.abs(ball.y - 0.5) < 0.2 : true;
  const taker = pickTaker(match, env, side);
  const goalX = side === 'home' ? 1 : 0;

  if (progress > 0.68 && central) {
    const shooter = taker ?? pickPenaltyTaker(match, env, side);
    if (!shooter) return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.25 });
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
    return finishRoutine(opponent, shot.type === 'goal', shot.type === 'shot-saved');
  }

  // A delivery into the box, the same contest as a corner but from further out.
  if (progress > 0.52 && rng.chance(0.72)) {
    const attack = aerialPower(match, env, side) * context[side].profile.aerialMultiplier;
    const defence = aerialPower(match, env, opponent) * context[opponent].strength.organisation;
    const pAttackWins = clamp(0.22 + (attack / Math.max(0.2, defence) - 1) * 0.35, 0.1, 0.5);
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
        return finishRoutine(opponent, shot.type === 'goal', shot.type === 'shot-saved');
      }
    }
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.3 });
  }

  // A quick one, played short and kept.
  return {
    nextSide: side,
    nextPlayerId: taker?.id ?? null,
    x: xFromProgress(side, clamp(progress + 0.08, 0.2, 0.85)),
    y: ball?.y ?? 0.5,
    goal: false,
    counter: false,
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
  if (!taker) return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.2 });
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
  if (shot.type === 'goal') {
    return { nextSide: opponent, nextPlayerId: null, x: 0.5, y: 0.5, goal: true, counter: false };
  }
  if (shot.type === 'shot-saved') {
    // The keeper keeps it out — the rebound is live for a heartbeat.
    if (rng.chance(0.3)) {
      return { nextSide: side, nextPlayerId: taker.id, x: xFromProgress(side, 0.85), y: 0.5, goal: false, counter: false };
    }
    return { nextSide: opponent, nextPlayerId: null, x: xFromProgress(opponent, 0.05), y: 0.5, goal: false, counter: false };
  }
  return { nextSide: opponent, nextPlayerId: null, x: xFromProgress(opponent, 0.05), y: 0.5, goal: false, counter: false };
}

/**
 * A throw-in.
 *
 * Almost always it is just the game restarting — the ball goes back into play
 * where it went out and nobody writes it down. Occasionally, deep in the
 * attacking half, somebody has a long one and it becomes an aerial contest.
 */
export function takeThrowIn(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  rng: Rng,
  sink: MatchEvent[],
): RoutineOutcome {
  const opponent = otherSide(side);
  const ball = match.field?.ball;
  const progress = ball ? progressOf(side, ball.x) : 0.4;
  const y = ball ? (ball.y < 0.5 ? 0.03 : 0.97) : 0.03;

  if (progress > 0.7 && rng.chance(0.28)) {
    const attack = aerialPower(match, env, side);
    const defence = aerialPower(match, env, opponent) * context[opponent].strength.organisation;
    const pAttackWins = clamp(0.16 + (attack / Math.max(0.2, defence) - 1) * 0.3, 0.06, 0.42);
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
            assisterId: null,
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
        return finishRoutine(opponent, shot.type === 'goal', shot.type === 'shot-saved');
      }
    }
    return clearanceOutcome(match, env, opponent, rng, { counterChance: 0.24 });
  }

  const backIntoPlay = xFromProgress(side, clamp(progress + rng.float(0, 0.06), 0.1, 0.88));
  return {
    nextSide: side,
    nextPlayerId: pickTaker(match, env, side)?.id ?? null,
    x: backIntoPlay,
    y: clamp(y + (y < 0.5 ? 0.06 : -0.06), 0.03, 0.97),
    goal: false,
    counter: false,
  };
}

/**
 * The ball is behind for a goal kick, or the keeper has gathered it.
 *
 * Distribution is a real decision, not a formality: a side that wants to play
 * out starts a build-up from its own box, and a side that does not launches it.
 */
export function goalKick(match: Match, side: Side, rng: Rng): RoutineOutcome {
  const keeperSlot = match.lineups[side].starting.find((slot) => slot.position === 'GK');
  const direct = rng.chance(0.45);
  return {
    nextSide: side,
    nextPlayerId: keeperSlot?.playerId ?? null,
    x: xFromProgress(side, direct ? rng.float(0.42, 0.56) : 0.14),
    y: clamp(0.5 + rng.float(-0.3, 0.3), 0.15, 0.85),
    goal: false,
    counter: direct,
  };
}

/** Where the game restarts after a set-piece attempt that did not go in. */
function finishRoutine(opponent: Side, goal: boolean, saved: boolean): RoutineOutcome {
  if (goal) return { nextSide: opponent, nextPlayerId: null, x: 0.5, y: 0.5, goal: true, counter: false };
  if (saved) {
    // The keeper has it: a goal kick, or a throw out that starts a break.
    return { nextSide: opponent, nextPlayerId: null, x: xFromProgress(opponent, 0.05), y: 0.5, goal: false, counter: true };
  }
  return { nextSide: opponent, nextPlayerId: null, x: xFromProgress(opponent, 0.06), y: 0.5, goal: false, counter: false };
}
