import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { PossessionChain } from './possession';
import type { PlayerId } from '@/domain/ids';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { advanceMinute, beginMatch } from './engine';
import { giveBallTo, installPossessionChains, SPATIAL_SECONDS_PER_MINUTE, SPATIAL_STEP_SECONDS, advanceSpatial, ensureSpatial, stepSpatial } from './spatial';
import type { TimelineAction } from './actionTimeline';

/**
 * One clock: the picture owes the football exactly the time it was decided
 * over.
 *
 * The possession model decides a minute of football in sixty-odd seconds of
 * match time. The pitch plays it in spatial seconds, and since the two are the
 * same clock now, those have to be the same sixty-odd seconds. If the pitch
 * plays a decision faster than it was decided — as it did when every step was
 * given only the time its geometry needed — it runs out of football halfway
 * through the minute, the players walk back to shape and stand there, and the
 * next minute's plans snap them off again. That is the pause at the minute
 * mark, and none of these may let it back.
 */

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function staged(seed: string) {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  return { match, env };
}

function action(
  kind: TimelineAction['kind'],
  playerId: PlayerId,
  targetPlayerId: PlayerId | null,
  outcome: TimelineAction['outcome'],
): TimelineAction {
  return {
    kind,
    decision: kind,
    side: 'home',
    playerId,
    targetPlayerId,
    fromX: 0.5,
    fromY: 0.5,
    toX: 0.6,
    toY: 0.5,
    startSecond: 0,
    duration: 3,
    outcome,
  };
}

/** How much football is still waiting to be played, in seconds. */
function queuedSeconds(spatial: NonNullable<Match['spatial']>): number {
  const plans = [...(spatial.plan ? [spatial.plan] : []), ...(spatial.pending ?? [])];
  return plans.reduce((sum, plan) => {
    const budget = plan.budgetSeconds;
    if (typeof budget !== 'number') return sum;
    if (plan.startedAt === undefined) return sum + budget;
    return sum + Math.max(0, budget - (spatial.clock - plan.startedAt));
  }, 0);
}

describe('a chain takes as long as the model gave it', () => {
  it('spends its whole budget rather than racing through the geometry', () => {
    const { match, env } = staged('chain-budget');
    const spatial = match.spatial!;
    const home = spatial.players.filter((node) => node.side === 'home' && node.position !== 'GK');
    const carrier = home.find((node) => node.position === 'CM') ?? home[0]!;
    const receiver = home.find((node) => node.position === 'RM' && node.playerId !== carrier.playerId) ?? home[1]!;

    giveBallTo(spatial, carrier.playerId);
    const chain: PossessionChain = {
      side: 'home',
      seconds: 12,
      receivers: [receiver.playerId],
      goal: false,
      actions: [
        action('carry', carrier.playerId, null, 'carry'),
        action('pass', carrier.playerId, receiver.playerId, 'completed'),
      ],
    };

    const plan = installPossessionChains(match, env, [chain]);
    expect(plan).not.toBeNull();
    const startedAt = plan!.startedAt!;

    let guard = 0;
    while (spatial.plan && guard < 4000) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      guard += 1;
    }

    const played = spatial.clock - startedAt;
    // Twelve seconds of decided football, played in twelve seconds of picture —
    // not in the handful the steps' geometry would have taken on their own.
    expect(played).toBeGreaterThanOrEqual(11.5);
    expect(played).toBeLessThan(13);
  });
});

describe('the pitch never runs out of football', () => {
  it('keeps the queue fed for a whole half, the way the store drives it', () => {
    const { state } = createTestGame('one-clock');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    match.spatial = undefined;
    ensureSpatial(match, env);
    beginMatch(match, env);

    // One frame of watching at Normal speed: 0.016 real seconds at ten match
    // seconds to the real one.
    const frame = 0.16;
    const frames = 4000;
    let idle = 0;
    let longestIdle = 0;
    let run = 0;
    let ticks = 0;
    let queuedAtTick = 0;
    let maxQueuedAtTick = 0;

    for (let index = 0; index < frames; index += 1) {
      advanceSpatial(match, env, frame);
      const spatial = match.spatial!;
      const decided = match.footballSeconds ?? 0;
      const owed = decided - spatial.clock;
      const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;

      // A frame with nothing on the pitch is a frame of players standing still.
      if (!spatial.celebration && spent) {
        idle += 1;
        run += 1;
        longestIdle = Math.max(longestIdle, run);
      } else {
        run = 0;
      }

      if (spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE || (spent && owed < SPATIAL_SECONDS_PER_MINUTE)) {
        const stillWaiting = queuedSeconds(spatial);
        advanceMinute(match, env);
        ticks += 1;
        queuedAtTick += stillWaiting;
        maxQueuedAtTick = Math.max(maxQueuedAtTick, stillWaiting);
      }
    }

    expect(ticks).toBeGreaterThan(5);
    // Nothing left over: the next minute is decided exactly when this one has
    // been played out, so the picture is never ahead of the words or behind the
    // decisions it is showing.
    expect(maxQueuedAtTick).toBeLessThan(5);
    // And almost no frame is spent with an empty pitch.
    expect(idle / frames).toBeLessThan(0.05);
    expect(longestIdle * frame).toBeLessThan(2);
    expect(queuedAtTick / ticks).toBeLessThan(1);
  });
});
