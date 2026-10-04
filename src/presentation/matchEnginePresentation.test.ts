import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { createMatchEngine } from '@/simulation/match/matchEngine/engine';
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
});

function envFor(state: GameState, match: Match) {
  return matchEnvironment(state, match, { autoManageAllBenches: true });
}
