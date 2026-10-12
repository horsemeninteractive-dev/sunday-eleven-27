import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { GROUND_UPKEEP } from '@/domain/facilities';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { createMatchEngine } from '@/simulation/match/matchEngine/engine';
import { setUpGroundUpkeep } from '@/simulation/grounds';
import { buildEngineRenderState } from './matchEnginePresentation';

/**
 * The new engine through the render contract.
 *
 * The 2D pitch does not know which engine played the match; it draws whatever
 * `buildEngineRenderState` hands it. This pins the one thing the picture gained
 * with the celebration: during a goal hold the render state carries positions
 * that actually change, so the dots run rather than pulse in place — while the
 * ball stays exactly where it crossed the line and the conceding side holds.
 */

function userMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('no fixture');
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

describe('the engine render state', () => {
  it('carries the goal celebration as movement, not a frozen picture', () => {
    const { state } = createTestGame('engine-presentation-goal');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));

    // Catch the hold near its start, in half-second chunks.
    let scored = false;
    for (let i = 0; i < 40000 && !scored && !engine.finished; i += 1) {
      engine.advance(0.5, 0.5, false);
      scored = engine.getState().phase === 'goal';
    }
    expect(scored).toBe(true);

    const held = buildEngineRenderState(engine, match, state);
    expect(held.phase).toBe('goal');
    const celebration = held.celebration;
    expect(celebration).toBeTruthy();
    const side = celebration!.side;
    const ballX = held.ball.x;
    const ballY = held.ball.y;
    const before = new Map(held.players.map((player) => [player.playerId, { x: player.x, y: player.y }]));

    // A second of celebration, read through the contract exactly as the pitch does.
    engine.advance(1, 1, false);
    const during = buildEngineRenderState(engine, match, state);
    let scorersMoved = 0;
    let concedersMoved = 0;
    for (const player of during.players) {
      const from = before.get(player.playerId)!;
      if (Math.hypot(player.x - from.x, player.y - from.y) <= 0.01) continue;
      if (player.side === side) scorersMoved += 1;
      else concedersMoved += 1;
    }
    expect(scorersMoved).toBeGreaterThanOrEqual(5);
    expect(concedersMoved).toBe(0);
    // The ball rests in the net the whole hold, drawn where it is.
    expect(during.ball.x).toBe(ballX);
    expect(during.ball.y).toBe(ballY);
    expect(during.ball.px).toBe(ballX);
  });

  it('carries the dead ball being taken, and the man over it', () => {
    // A restart is football that is not being played: the ball is out of play on
    // the line it left from, one man walks to it, and everybody else is arranged
    // around where it is going. None of that can be read off positions — which
    // man takes it is a decision, not a reading — so the contract hands over the
    // engine's own answer. It is read rather than stored because a restart begins
    // and ends between two events, with no render around either.
    const { state } = createTestGame('engine-presentation-restart');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const view = buildEngineRenderState(engine, match, state);

    // Catch the throw-in at the moment it is actually played: that is the moment
    // the picture has to draw, and the moment the man taking it is over the ball.
    let throwing = false;
    for (let step = 0; step < 40000 && !throwing && !engine.finished; step += 1) {
      engine.advance(1 / 30, 1 / 30, false);
      const piece = engine.getState().setPiece;
      throwing = piece?.kind === 'throw-in' && piece.phase === 'delivery';
    }
    expect(throwing).toBe(true);

    const restart = view.restart();
    expect(restart?.kind).toBe('throw-in');
    expect(restart?.takerId).toBe(engine.getState().setPiece?.takerId);
    expect(view.ball.status).toBe('out-of-play');

    const taker = view.players.find((node) => node.playerId === restart?.takerId);
    expect(taker).toBeTruthy();
    expect(taker!.side).toBe(restart!.side);
    // He is standing over the ball in the sense that matters — it is in his hands
    // — and he is standing *off* the pitch to do it, because a throw-in is the
    // one restart taken from outside the field of play. Which is why the contract
    // hands over the spot as well: the mark the picture chalks is the point on
    // the line the ball comes back in from, and it is not under the ball.
    expect(Math.hypot(taker!.x - view.ball.x, taker!.y - view.ball.y)).toBeLessThan(0.02);
    expect(Math.min(restart!.spot.y, 1 - restart!.spot.y)).toBeLessThan(0.04);
    expect(
      Math.min(taker!.y, 1 - taker!.y),
      `the thrower is on the grass at y=${taker!.y}`,
    ).toBeLessThan(0);
    // Over the spot along the line, a stride outside it: he is sent to the spot's
    // own x and counts as arrived within the stride the arrangement allows.
    expect(Math.abs(taker!.x - restart!.spot.x)).toBeLessThan(0.03);

    // And the reading is live. Once the ball is back in play the picture stops
    // being told about a restart, without waiting for anything to re-render.
    let backInPlay = false;
    for (let step = 0; step < 6000 && !backInPlay && !engine.finished; step += 1) {
      engine.advance(1 / 30, 1 / 30, false);
      backInPlay = view.restart() === null;
    }
    expect(backInPlay).toBe(true);
  });

  it('hands over the ground the afternoon is being played on, wear and all', () => {
    // A renderer has no ground and no weather: it cannot tell a February league
    // game on a pudding from a July friendly on a lawn, and a picture that
    // inferred one from the football would be inventing it. So the surface is
    // part of the contract — the kind of surface, the day's verdict, the ground's
    // own grass and how far into its next point of wear it has been played.
    const { state } = createTestGame('engine-presentation-surface');
    const fixture = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId && !candidate.played,
    )!;
    prepareMatchday(state, fixture.matchday);
    const match = cloneMatch(state.matches[fixture.id]!);
    const ground = state.world.grounds[match.groundId]!;

    ground.quality = 6;
    ground.fixturesSinceAttention = GROUND_UPKEEP.fixturesPerWear / 2;
    match.conditions = { ...match.conditions, pitch: 'muddy' };

    const engine = createMatchEngine(match, envFor(state, match));
    const render = buildEngineRenderState(engine, match, state);
    expect(render.surface.surface).toBe(ground.surface);
    expect(render.surface.condition).toBe('muddy');
    expect(render.surface.quality).toBe(6);
    // Half the way to the next point of wear: the goalmouths are going but the
    // surface has not been charged for it yet.
    expect(render.surface.scuff).toBeCloseTo(0.5, 6);

    // And the £9 a week is a *reading* of the ground rather than a promise: the
    // moment the club pays for the pitch to be looked after, the wear is nought,
    // and the picture of the goalmouths changes with it.
    expect(setUpGroundUpkeep(state, state.userClubId, true).ok).toBe(true);
    expect(buildEngineRenderState(engine, match, state).surface.scuff).toBe(0);
  });
});

function envFor(state: GameState, match: Match) {
  return matchEnvironment(state, match, { autoManageAllBenches: true });
}
