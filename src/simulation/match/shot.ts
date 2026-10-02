import type { PlayerId } from '@/domain/ids';
import type { Match, MatchEvent } from '@/domain/match';
import type { Player } from '@/domain/person';
import * as C from './commentary';
import {
  currentScore,
  eventCoords,
  makeEvent,
  otherSide,
  performanceOf,
  pushEvent,
  textContext,
  type MatchContext,
  type MatchEnvironment,
  type Side,
} from './core';
import { playerEffectiveness } from './teamStrength';
import type { Rng } from '../rng';

/**
 * Finishing a chance.
 *
 * A shot is the last decision of a move, not a lottery that replaces one. It is
 * resolved in three steps, because the three things that decide whether a goal
 * is scored are genuinely different things:
 *
 *  1. **Chance quality** — how good the opportunity is. A striker bearing down
 *     on goal from eight yards with the defence beaten is not the same animal as
 *     a centre-back swinging a boot at a bouncing ball twenty-seven yards out.
 *     This is decided by the move that produced it and is handed in.
 *  2. **Shot quality** — what this particular player does with that chance. His
 *     finishing, his composure and the pressure on him turn an opportunity into
 *     an attempt, and a tired man in the ninetieth minute hits it worse.
 *  3. **The keeper** — ability, positioning and agility, against where the shot
 *     is going.
 *
 * The old model had one combined quality figure and a keeper penalty, which is
 * why two very different shots could end with the same probability. Splitting
 * them means a great chance for a poor finisher and a half-chance for a good one
 * are both possible, and both mean something.
 */

export type AssistKind = 'pass' | 'through' | 'cross' | 'rebound' | 'set-piece' | 'solo' | 'carry';

export interface ChanceInput {
  shooterId: PlayerId;
  assisterId: PlayerId | null;
  /** 0..1 — how good the opportunity is, decided by the move that made it. */
  chanceQuality: number;
  /** Where the attempt is taken from, in the fixed frame. */
  x: number;
  y: number;
  /** 0..1 — how hard the shooter is being closed down. */
  pressure: number;
  assistKind: AssistKind;
  /** Defenders genuinely between the ball and the goal. */
  blockers: number;
  /** A set-piece chance is harder to charge down. */
  fromSetPiece: boolean;
  /** Set when the shot comes from a penalty, which bypasses everything else. */
  penalty?: boolean;
}

export type ShotOutcome = 'goal' | 'shot-saved' | 'shot-blocked' | 'shot-off-target';

export interface ShotResult {
  type: ShotOutcome;
  /** The three numbers behind the outcome, for the trace and for tests. */
  chanceQuality: number;
  shotQuality: number;
  keeperQuality: number;
  onTarget: boolean;
  blocked: boolean;
  shooterId: PlayerId;
  assisterId: PlayerId | null;
  keeperId: PlayerId | null;
  blockerId: PlayerId | null;
  /** Where the ball ended up, so the pitch and the map strip agree. */
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ShooterQuality {
  shooter: number;
  keeper: number;
  keeperPlayerId: PlayerId | null;
}

function qualityOf(match: Match, env: MatchEnvironment, shooterId: PlayerId, defendingSide: Side): ShooterQuality {
  const shooter = env.getPlayer(shooterId);
  const shooterPerf = performanceOf(match, shooterId);
  const shooterEff = shooter
    ? playerEffectiveness(shooter, shooterPerf?.positionPlayed ?? shooter.preferredPosition, {
        energy: shooterPerf?.energy,
        carryingInjury: Boolean(shooterPerf?.injuryDetail),
      })
    : null;
  const shooterQuality = shooterEff
    ? clamp01(
        (shooterEff.effective.shooting * 0.5 +
          shooterEff.effective.composure * 0.22 +
          shooterEff.effective.ballControl * 0.16 +
          shooterEff.effective.positioning * 0.12) /
          20,
      )
    : 0.4;

  const keeperSlot = match.lineups[defendingSide].starting.find((slot) => slot.position === 'GK');
  const keeper = keeperSlot ? env.getPlayer(keeperSlot.playerId) : undefined;
  const keeperPerf = keeper ? performanceOf(match, keeper.id) : undefined;
  const keeperEff = keeper
    ? playerEffectiveness(keeper, 'GK', {
        energy: keeperPerf?.energy,
        carryingInjury: Boolean(keeperPerf?.injuryDetail),
      })
    : null;
  const keeperQuality = keeperEff
    ? clamp01(
        (keeperEff.effective.goalkeeping * 0.7 +
          keeperEff.effective.positioning * 0.15 +
          keeperEff.effective.agility * 0.15) /
          20,
      )
    : 0.35;

  return { shooter: shooterQuality, keeper: keeperQuality, keeperPlayerId: keeper?.id ?? null };
}

/**
 * Resolve the attempt, write it down, and credit the men involved.
 *
 * The event written here is the authoritative record of the shot: shots, shots
 * on target, goals, assists and saves are all incremented here and nowhere else,
 * so the statistics cannot drift away from the football.
 */
export function resolveShot(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  chance: ChanceInput,
  rng: Rng,
  sink: MatchEvent[],
): ShotResult {
  const opponent = otherSide(side);
  const { shooter, keeper, keeperPlayerId } = qualityOf(match, env, chance.shooterId, opponent);
  const shooterPlayer = env.getPlayer(chance.shooterId) ?? undefined;
  const shooterPerf = performanceOf(match, chance.shooterId);
  const keeperPlayer = keeperPlayerId ? env.getPlayer(keeperPlayerId) : undefined;

  // A penalty is a chance and a half and nothing else can intervene.
  if (chance.penalty) {
    const saved = rng.chance(clamp01(0.26 + keeper * 0.22 - shooter * 0.3));
    const placed = Math.max(0.05, 0.9 - keeper * 0.35);
    const onTarget = saved || rng.chance(placed);
    if (shooterPerf) shooterPerf.shots += 1;
    if (onTarget && shooterPerf) shooterPerf.shotsOnTarget += 1;
    const coords = eventCoords(match, chance.x, chance.y);

    if (onTarget && !saved) {
      if (shooterPerf) shooterPerf.goals += 1;
      const score = currentScore(match);
      const next = { home: score.home + (side === 'home' ? 1 : 0), away: score.away + (side === 'away' ? 1 : 0) };
      pushEvent(
        match,
        makeEvent(match, 'penalty-scored', {
          minute: match.minute,
          side,
          playerId: chance.shooterId,
          text: C.writePenaltyScored(
            textContext(env, match, side, rng, { player: shooterPlayer, score: `${next.home}-${next.away}` }),
          ),
          x: coords.x,
          y: coords.y,
          importance: 3,
          scoreAfter: next,
        }),
        sink,
      );
      return {
        type: 'goal',
        chanceQuality: 1,
        shotQuality: 1,
        keeperQuality: keeper,
        onTarget: true,
        blocked: false,
        shooterId: chance.shooterId,
        assisterId: null,
        keeperId: keeperPlayerId,
        blockerId: null,
        x: coords.x,
        y: coords.y,
      };
    }

    const keeperPerf = keeperPlayerId ? performanceOf(match, keeperPlayerId) : undefined;
    if (saved && keeperPerf) keeperPerf.saves += 1;
    pushEvent(
      match,
      makeEvent(match, 'penalty-missed', {
        minute: match.minute,
        side,
        playerId: chance.shooterId,
        text: C.writePenaltyMissed(textContext(env, match, side, rng, { player: shooterPlayer })),
        x: coords.x,
        y: coords.y,
        importance: 3,
      }),
      sink,
    );
    return {
      type: 'shot-saved',
      chanceQuality: 1,
      shotQuality: 1,
      keeperQuality: keeper,
      onTarget,
      blocked: false,
      shooterId: chance.shooterId,
      assisterId: null,
      keeperId: keeperPlayerId,
      blockerId: null,
      x: coords.x,
      y: coords.y,
    };
  }

  const pressure = clamp01(chance.pressure);
  const shotQuality = clamp01(
    0.08 + chance.chanceQuality * 0.56 + shooter * 0.42 - pressure * 0.2,
  );

  // Who, if anyone, gets in the way. A crowded box and a man in your face are
  // what turn a shot into a block; a good chance means the defence is beaten.
  // A well-drilled defence closes shots down; a disorganised one arrives late.
  const organisation = context[opponent].strength.organisation;
  const blockChance = chance.fromSetPiece
    ? clamp(0.05 + chance.blockers * 0.03 + pressure * 0.06, 0.02, 0.4)
    : clamp(
        (0.12 + chance.blockers * 0.1 + pressure * 0.2 - chance.chanceQuality * 0.12) * organisation,
        0.02,
        0.55,
      );

  const coords = eventCoords(match, chance.x, chance.y);
  if (shooterPerf) shooterPerf.shots += 1;

  if (rng.chance(blockChance)) {
    const blocker = chooseBlocker(match, env, opponent, rng);
    const blockerPerf = blocker ? performanceOf(match, blocker.id) : undefined;
    if (blockerPerf) blockerPerf.tackles += 1;
    pushEvent(
      match,
      makeEvent(match, 'shot-blocked', {
        minute: match.minute,
        side,
        playerId: chance.shooterId,
        secondaryPlayerId: blocker?.id ?? null,
        text: C.writeBlocked(textContext(env, match, side, rng, { player: shooterPlayer, partner: blocker })),
        x: coords.x,
        y: coords.y,
        importance: 1,
      }),
      sink,
    );
    return {
      type: 'shot-blocked',
      chanceQuality: chance.chanceQuality,
      shotQuality,
      keeperQuality: keeper,
      onTarget: false,
      blocked: true,
      shooterId: chance.shooterId,
      assisterId: chance.assisterId,
      keeperId: keeperPlayerId,
      blockerId: blocker?.id ?? null,
      x: coords.x,
      y: coords.y,
    };
  }

  // Roughly a third of attempts hit the target, and roughly a third of those
  // beat the keeper — which is what a Sunday League afternoon looks like.
  const pOnTarget = clamp(0.3 + shotQuality * 0.46 - keeper * 0.15, 0.12, 0.85);
  if (!rng.chance(pOnTarget)) {
    pushEvent(
      match,
      makeEvent(match, 'shot-off-target', {
        minute: match.minute,
        side,
        playerId: chance.shooterId,
        text: C.writeOffTarget(textContext(env, match, side, rng, { player: shooterPlayer })),
        x: coords.x,
        y: coords.y < 0.5 ? Math.max(0, coords.y - 0.06) : Math.min(1, coords.y + 0.06),
        importance: 1,
      }),
      sink,
    );
    return {
      type: 'shot-off-target',
      chanceQuality: chance.chanceQuality,
      shotQuality,
      keeperQuality: keeper,
      onTarget: false,
      blocked: false,
      shooterId: chance.shooterId,
      assisterId: chance.assisterId,
      keeperId: keeperPlayerId,
      blockerId: null,
      x: coords.x,
      y: coords.y,
    };
  }

  if (shooterPerf) shooterPerf.shotsOnTarget += 1;
  const pGoal = clamp(0.3 + shotQuality * 0.54 - keeper * 0.34, 0.04, 0.72);

  if (rng.chance(pGoal)) {
    if (shooterPerf) shooterPerf.goals += 1;
    const assistPerf = chance.assisterId ? performanceOf(match, chance.assisterId) : undefined;
    if (assistPerf) assistPerf.assists += 1;
    const assister = chance.assisterId ? env.getPlayer(chance.assisterId) : null;
    const score = currentScore(match);
    const next = { home: score.home + (side === 'home' ? 1 : 0), away: score.away + (side === 'away' ? 1 : 0) };
    pushEvent(
      match,
      makeEvent(match, 'goal', {
        minute: match.minute,
        side,
        playerId: chance.shooterId,
        secondaryPlayerId: chance.assisterId,
        text: C.writeGoal(
          textContext(env, match, side, rng, {
            player: shooterPlayer,
            partner: assister,
            quality: shotQuality,
            score: `${next.home}-${next.away}`,
          }),
        ),
        x: coords.x,
        y: coords.y,
        importance: 3,
        scoreAfter: next,
      }),
      sink,
    );
    return {
      type: 'goal',
      chanceQuality: chance.chanceQuality,
      shotQuality,
      keeperQuality: keeper,
      onTarget: true,
      blocked: false,
      shooterId: chance.shooterId,
      assisterId: chance.assisterId,
      keeperId: keeperPlayerId,
      blockerId: null,
      x: coords.x,
      y: coords.y,
    };
  }

  const keeperPerf = keeperPlayerId ? performanceOf(match, keeperPlayerId) : undefined;
  if (keeperPerf) keeperPerf.saves += 1;
  pushEvent(
    match,
    makeEvent(match, 'shot-saved', {
      minute: match.minute,
      side,
      playerId: chance.shooterId,
      secondaryPlayerId: keeperPlayerId,
      text: C.writeSaved(textContext(env, match, side, rng, { player: shooterPlayer, partner: keeperPlayer ?? null, quality: shotQuality })),
      x: coords.x,
      y: coords.y,
      importance: 2,
    }),
    sink,
  );
  return {
    type: 'shot-saved',
    chanceQuality: chance.chanceQuality,
    shotQuality,
    keeperQuality: keeper,
    onTarget: true,
    blocked: false,
    shooterId: chance.shooterId,
    assisterId: chance.assisterId,
    keeperId: keeperPlayerId,
    blockerId: null,
    x: coords.x,
    y: coords.y,
  };
}

/** A defender near the ball who gets something in the way. */
function chooseBlocker(match: Match, env: MatchEnvironment, side: Side, rng: Rng): Player | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
      return { value: player, weight: Math.max(0.0001, (eff.effective.tackling + eff.effective.positioning) / 2) };
    });
  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}
