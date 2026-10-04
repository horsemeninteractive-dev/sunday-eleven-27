import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { PlayerId } from '@/domain/ids';
import type { ActionOutcome } from '@/domain/matchState';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { SPATIAL_STEP_SECONDS, advanceSpatial, ensureSpatial, giveBallTo, installPossessionPlan, stepSpatial } from './spatial';
import type { TimelineAction } from './actionTimeline';

/**
 * The shot, resolving over time.
 *
 * The engine decides how a shot comes out — it is saved, blocked, misses, or it
 * is a goal — and it decided that before a ball moved. What is pinned here is
 * that the *picture* is the football: the ball takes a real journey, and where
 * it ends up comes from where the keeper and the defenders actually are, not
 * from where they happened to be standing when the shot was struck. A save
 * happens where the keeper gets to; a block happens at the man in the way; a
 * miss is dead behind the line. None of it changes an outcome.
 */

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function staged(seed: string): { state: GameState; match: Match; env: ReturnType<typeof matchEnvironment> } {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  return { state, match, env };
}

/** One shot, exactly as the possession model records it. */
function shot(outcome: ActionOutcome, playerId: PlayerId): TimelineAction {
  return {
    kind: 'shot',
    decision: 'shot',
    side: 'home',
    playerId,
    targetPlayerId: null,
    fromX: 0.75,
    fromY: 0.5,
    toX: 0.995,
    toY: 0.5,
    startSecond: 0,
    duration: 1.3,
    outcome,
  };
}

/**
 * A shot staged from a striker's feet, with the ball already at his boot.
 *
 * The striker stands off-centre so the goal he is shooting at is away from where
 * the keeper is standing — which is what makes the keeper's own movement part of
 * the story rather than something the test can ignore.
 */
function stageShot(outcome: ActionOutcome, seed: string, shooterY = 0.36) {
  const { match, env } = staged(seed);
  const spatial = match.spatial!;
  const shooter = spatial.players.find((node) => node.side === 'home' && node.position === 'ST')!;
  shooter.x = 0.76;
  shooter.y = shooterY;
  giveBallTo(spatial, shooter.playerId);
  const plan = installPossessionPlan(match, env, 'home', [shot(outcome, shooter.playerId)]);
  const keeper = spatial.players.find((node) => node.side === 'away' && node.position === 'GK')!;
  return { match, env, spatial, shooter, keeper, plan };
}

/** A stable, comparable picture of the pitch, to six decimal places. */
function snapshot(match: Match): string {
  const spatial = match.spatial!;
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  return JSON.stringify({
    clock: round(spatial.clock),
    ball: { x: round(spatial.ball.x), y: round(spatial.ball.y), status: spatial.ball.status, owner: spatial.ball.ownerId },
    players: spatial.players.map((node) => ({ id: node.playerId, x: round(node.x), y: round(node.y), action: node.action })),
  });
}

describe('a saved shot', () => {
  it('travels, brings the keeper across, and ends in his hands', () => {
    const { match, env, spatial, shooter, keeper } = stageShot('saved', 'shot-saved');
    expect(spatial.ball.status).toBe('travelling');

    const keeperStart = { x: keeper.x, y: keeper.y };
    let travelled = 0;
    let keeperMoved = false;
    let lastTravelling: { ball: { x: number; y: number }; keeper: { x: number; y: number } } | null = null;

    for (let i = 0; i < 4000 && (spatial.plan || spatial.ball.status === 'travelling'); i += 1) {
      const before = { x: keeper.x, y: keeper.y };
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      // He moves with his legs, not a jump.
      expect(Math.hypot(keeper.x - before.x, keeper.y - before.y)).toBeLessThanOrEqual(
        keeper.speed * SPATIAL_STEP_SECONDS + 1e-9,
      );
      if (spatial.ball.status === 'travelling') {
        travelled += 1;
        if (Math.hypot(keeper.x - before.x, keeper.y - before.y) > 0) keeperMoved = true;
        lastTravelling = { ball: { x: spatial.ball.x, y: spatial.ball.y }, keeper: { x: keeper.x, y: keeper.y } };
      }
    }

    // The ball took a real journey rather than resolving on the spot.
    expect(travelled).toBeGreaterThan(3);
    // The keeper went for it, because it was his to get.
    expect(keeperMoved).toBe(true);
    expect(Math.hypot(keeper.x - keeperStart.x, keeper.y - keeperStart.y)).toBeGreaterThan(0);
    // Where it was met is where he actually was, not where he started.
    expect(lastTravelling).not.toBeNull();
    expect(
      Math.hypot(lastTravelling!.ball.x - lastTravelling!.keeper.x, lastTravelling!.ball.y - lastTravelling!.keeper.y),
    ).toBeLessThan(0.06);
    // And the save is a save: the ball is his.
    expect(spatial.ball.ownerId).toBe(keeper.playerId);
    expect(spatial.ball.status).toBe('controlled');
    expect(spatial.ball.lastTouchId).toBe(keeper.playerId);
    // A save is not a goal: the match does not stop.
    expect(spatial.celebration).toBeFalsy();
    expect(spatial.ball.ownerId).not.toBe(shooter.playerId);
  });
});

describe('a blocked shot', () => {
  it('is met by a defender in the way, and the defender comes away with it', () => {
    const { match, env, spatial, shooter } = stageShot('blocked', 'shot-blocked');
    expect(spatial.ball.status).toBe('travelling');

    for (let i = 0; i < 4000 && (spatial.plan || spatial.ball.status === 'travelling'); i += 1) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    }

    const winner = spatial.ball.ownerId;
    expect(winner).toBeTruthy();
    expect(winner).not.toBe(shooter.playerId);
    const blocker = spatial.players.find((node) => node.playerId === winner)!;
    expect(blocker.side).toBe('away');
    // A block is an outfielder's tackle, not the keeper's save.
    expect(blocker.position).not.toBe('GK');
    expect(spatial.ball.status).toBe('controlled');
    expect(spatial.celebration).toBeFalsy();
  });
});

describe('a shot that misses', () => {
  it('is dead behind the goal line, with nobody on the end of it', () => {
    const { match, env, spatial } = stageShot('off-target', 'shot-wide', 0.5);
    for (let i = 0; i < 4000 && (spatial.plan || spatial.ball.status === 'travelling'); i += 1) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    }

    expect(spatial.ball.status).toBe('out-of-play');
    expect(spatial.ball.ownerId).toBeNull();
    // Wide of the frame, which is why it is off target and not a goal.
    expect(spatial.ball.y < 0.3 || spatial.ball.y > 0.7).toBe(true);
    expect(spatial.celebration).toBeFalsy();
  });
});

describe('a goal', () => {
  it('still stops the match for the celebration, once the ball has got there', () => {
    const { match, env, spatial } = stageShot('goal', 'shot-goal');
    let travelled = 0;
    for (let i = 0; i < 4000 && spatial.ball.status === 'travelling'; i += 1) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      travelled += 1;
    }
    expect(travelled).toBeGreaterThan(3);
    expect(spatial.celebration).toBeTruthy();
    expect(spatial.plan).toBeNull();
  });
});

describe('a shot in time, not in frames', () => {
  it('finishes identically whether it arrives as big frames or small ones', () => {
    const a = stageShot('saved', 'shot-frames');
    const b = stageShot('saved', 'shot-frames');

    // The same second of football, delivered thirty small frames and one big
    // one. The shot is worth the same fixed steps either way.
    for (let i = 0; i < 30; i += 1) advanceSpatial(a.match, a.env, SPATIAL_STEP_SECONDS);
    advanceSpatial(b.match, b.env, SPATIAL_STEP_SECONDS * 30);

    expect(snapshot(b.match)).toBe(snapshot(a.match));
  });
});
