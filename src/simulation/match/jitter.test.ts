import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { advanceMinute, beginMatch } from './engine';
import { advanceMovement } from './state';
import type { MovementState } from './state';
import { advanceSpatial, ensureSpatial, SPATIAL_SECONDS_PER_MINUTE, SPATIAL_STEP_SECONDS } from './spatial';

/**
 * A settled player does not vibrate.
 *
 * The pitch used to shake at every minute mark: men who had arrived at their
 * place reversed direction every step or two without going anywhere, which the
 * renderer drew as a facing arrow swinging back and forth over a player who
 * appeared to be standing still. None of these may let it back.
 *
 * The symptom is not movement, it is *reversal*. A player jogging about is
 * fine; a player whose velocity changes sign while he covers no ground is the
 * bug, so that is what is measured.
 */

/** The velocity below which a player is standing still rather than travelling. */
const RESTING = 0.004;
/** Below this, a change of direction cannot be seen anyway. */
const SIGNIFICANT = 1e-3;
/** A mark that jumps further than this in one frame has lurched. */
const LURCH = 0.05;

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (c) => c.homeClubId === state.userClubId || c.awayClubId === state.userClubId,
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
  beginMatch(match, env);
  return { match, env, spatial: match.spatial! };
}

/** Drive the pitch the way the store does, one watch frame at a time. */
function watch(match: Match, env: ReturnType<typeof matchEnvironment>, frames: number, onStep: (index: number) => void) {
  const spatial = match.spatial!;
  const frame = 0.16;
  for (let index = 0; index < frames; index += 1) {
    advanceSpatial(match, env, frame);
    const decided = match.footballSeconds ?? 0;
    const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
    if (spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE || (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)) {
      advanceMinute(match, env);
    }
    onStep(index);
  }
}

describe('a player who has arrived stands still', () => {
  it('walks onto his mark and stays on it', () => {
    const mover: MovementState = {
      x: 0.5,
      y: 0.5,
      px: 0.5,
      py: 0.5,
      tx: 0.62,
      ty: 0.5,
      vx: 0,
      vy: 0,
      speed: 0.08,
    } as MovementState;

    for (let step = 0; step < 400; step += 1) advanceMovement(mover, SPATIAL_STEP_SECONDS);

    // He gets there, and he stops there rather than creeping the last of the way
    // for ever.
    expect(Math.abs(mover.x - mover.tx)).toBeLessThan(1e-3);
    expect(Math.abs(mover.vx)).toBeLessThan(1e-6);
  });

  it('does not set off again because his mark drifted a little', () => {
    const mover: MovementState = {
      x: 0.5,
      y: 0.5,
      px: 0.5,
      py: 0.5,
      tx: 0.5,
      ty: 0.5,
      vx: 0,
      vy: 0,
      speed: 0.08,
    } as MovementState;
    for (let step = 0; step < 200; step += 1) advanceMovement(mover, SPATIAL_STEP_SECONDS);
    expect(Math.abs(mover.vx)).toBeLessThan(1e-6);

    // The ball breathes: his mark wanders by a few inches, as it does constantly
    // while possession shifts around a settled player.
    let reversals = 0;
    let previousSign = 0;
    for (let step = 0; step < 120; step += 1) {
      const drift = Math.sin(step / 7) * 0.004;
      mover.tx = 0.5 + drift;
      mover.ty = 0.5;
      advanceMovement(mover, SPATIAL_STEP_SECONDS);
      const sign = mover.vx > SIGNIFICANT ? 1 : mover.vx < -SIGNIFICANT ? -1 : 0;
      if (sign !== 0 && previousSign !== 0 && sign !== previousSign) reversals += 1;
      if (sign !== 0) previousSign = sign;
    }

    // A mark that has moved a couple of inches is not worth walking to, so he
    // never turns round to follow it.
    expect(reversals).toBe(0);
  });

  it('never covers more ground in one step than his own pace allows', () => {
    const mover: MovementState = {
      x: 0.5,
      y: 0.5,
      px: 0.5,
      py: 0.5,
      tx: 0.5004,
      ty: 0.5,
      vx: 0.05,
      vy: 0,
      speed: 0.08,
    } as MovementState;

    for (let step = 0; step < 400; step += 1) {
      const before = { x: mover.x, y: mover.y };
      // A target that keeps moving about, which is what a shape player near a
      // moving ball is given.
      mover.tx = 0.5 + Math.sin(step / 5) * 0.05;
      advanceMovement(mover, SPATIAL_STEP_SECONDS);
      expect(Math.hypot(mover.x - before.x, mover.y - before.y)).toBeLessThanOrEqual(
        mover.speed * SPATIAL_STEP_SECONDS + 1e-9,
      );
    }
  });
});

describe('the pitch does not buzz', () => {
  it('never reverses a barely-moving player on consecutive frames', () => {
    const { match, env } = staged('jitter-reversal');
    const spatial = match.spatial!;

    const sign = new Map<string, number>();
    let restReversals = 0;
    let drawnReversals = 0;
    let worstRun = 0;
    const runs = new Map<string, number>();

    watch(match, env, 3000, () => {
      for (const node of spatial.players) {
        const vx = node.vx ?? 0;
        const drawn = Math.hypot(vx, node.vy ?? 0) > RESTING;
        const current = Math.abs(vx) < SIGNIFICANT ? 0 : Math.sign(vx);
        const before = sign.get(node.playerId);

        if (before !== undefined && current !== 0 && before !== 0 && current !== before) {
          // The reported symptom exactly: a man who is not really moving,
          // reversing, one frame after he reversed the frame before.
          if (!drawn) restReversals += 1;
          if (drawn) drawnReversals += 1;
          const run = (runs.get(node.playerId) ?? 0) + 1;
          runs.set(node.playerId, run);
          worstRun = Math.max(worstRun, run);
        } else if (current !== 0) {
          runs.set(node.playerId, 0);
        }
        if (current !== 0) sign.set(node.playerId, current);
      }
    });

    // Nobody rattles: not on consecutive frames, and hardly at all otherwise.
    expect(worstRun).toBeLessThanOrEqual(3);
    expect(restReversals).toBeLessThan(400);
    expect(drawnReversals).toBeLessThan(900);
  });

  it('keeps the closing-down job with one man instead of swapping it', () => {
    const { match, env } = staged('jitter-press');
    const spatial = match.spatial!;

    const assignments: Array<{ home: unknown; away: unknown }> = [];
    watch(match, env, 1500, () => {
      assignments.push({ home: spatial.pressing?.home, away: spatial.pressing?.away });
    });

    let changes = 0;
    let sawAnyone = false;
    for (let index = 1; index < assignments.length; index += 1) {
      const now = assignments[index]!;
      const before = assignments[index - 1]!;
      if (now.home) sawAnyone = true;
      if (now.home !== before.home || now.away !== before.away) changes += 1;
    }

    expect(sawAnyone).toBe(true);
    // Fifteen hundred frames is two and a half minutes of football. Handing the
    // job over several times a second is the old behaviour; a handful of times
    // across all of that is a defence reorganising itself.
    expect(changes).toBeLessThan(60);
  });

  it('does not lurch the whole side when the ball changes hands', () => {
    const { match, env } = staged('jitter-handover');
    const spatial = match.spatial!;

    let worstMove = 0;
    let handovers = 0;
    const lurches: number[] = [];
    let previousOwner = spatial.ball.ownerId;
    let previous: Array<[number, number]> = spatial.players.map((node) => [node.tx, node.ty]);

    watch(match, env, 3000, () => {
      const ownerBefore = previousOwner;
      previousOwner = spatial.ball.ownerId;
      const turnedOver = spatial.ball.ownerId !== ownerBefore;
      if (turnedOver) handovers += 1;

      // Only look at the frames where the ball actually changed hands. A goal
      // moves everybody to the other end of the pitch on purpose, and that is
      // the celebration doing its job rather than the shape snapping.
      if (turnedOver && !spatial.celebration) {
        let lurching = 0;
        spatial.players.forEach((node, index) => {
          const last = previous[index];
          if (!last) return;
          worstMove = Math.max(worstMove, Math.hypot(node.tx - last[0], node.ty - last[1]));
          if (Math.hypot(node.tx - last[0], node.ty - last[1]) > LURCH) lurching += 1;
        });
        lurches.push(lurching);
      }
      previous = spatial.players.map((node) => [node.tx, node.ty]);
    });

    const sorted = [...lurches].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const worst = sorted[sorted.length - 1] ?? 0;
    console.log(
      `handovers=${handovers} men lurching at a typical turnover=${typical} worst=${worst}`,
    );
    expect(handovers).toBeGreaterThan(5);
    // A turnover used to shift every man's mark by the whole difference between
    // the two leans at once — about a seventh of the pitch, all twenty-two on
    // the same frame. That is the whole side twitching in unison rather than a
    // team reacting to losing the ball, and it is what this must not allow.
    expect(typical).toBeLessThanOrEqual(4);
    expect(worst).toBeLessThan(12);
  });
});