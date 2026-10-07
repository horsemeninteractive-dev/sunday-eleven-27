import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { createMatchEngine } from '@/simulation/match/matchEngine/engine';
import { recordEngineKeyframe } from '@/simulation/match/recording';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { buildMatchRenderState, recordedFrame } from './matchPresentation';

/**
 * Playing the real movement back.
 *
 * A watched match is recorded as it moves, so a replay can draw what was played
 * rather than a formation leaned toward a recorded moment. These tests pin the
 * seam: a recording becomes the same `PlayerState`/ball the live match produces,
 * through the same render contract, and a match with no recording still falls
 * back to the reconstruction.
 */

/** Football seconds to a match minute: the engine's clock is real seconds. */
const SECONDS_PER_MINUTE = 60;
/** How much of the match is played: enough that the recording is a real one. */
const WATCHED_MINUTES = 4;

/**
 * A watched match: the authoritative engine is driven with the same observer the
 * live match wires, so the recording is the movement the football actually held
 * rather than a picture reconstructed afterwards.
 */
function watched(seed: string): { state: GameState; match: Match } {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  const engine = createMatchEngine(match, env);
  engine.observe((engineState) => recordEngineKeyframe(match, engineState));
  engine.advance(WATCHED_MINUTES * SECONDS_PER_MINUTE, WATCHED_MINUTES * SECONDS_PER_MINUTE, false);
  return { state, match };
}

describe('reading a recording into a picture', () => {
  it('gives the pitch the positions the match actually held', () => {
    const { match } = watched('recorded-frame');
    const recording = match.recording!;
    const clock = recording.frames[Math.floor(recording.frames.length / 2)]!.clock;

    const frame = recordedFrame(match, clock)!;
    expect(frame).toBeTruthy();
    // A full side, on the pitch, drawn where they were recorded.
    expect(frame.players.length).toBeGreaterThan(18);
    expect(frame.players.every((node) => node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1)).toBe(true);
    // A recorded position is drawn as it was, not smoothed in from nowhere.
    expect(frame.players.every((node) => node.px === node.x && node.py === node.y)).toBe(true);
    expect(frame.ball.x).toBeGreaterThanOrEqual(0);
    expect(frame.ball.x).toBeLessThanOrEqual(1);
  });

  it('has nothing to read for a match that was not watched', () => {
    const { state } = createTestGame('recorded-none');
    const fixture = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
    )!;
    const match = cloneMatch(state.matches[fixture.id]!);
    expect(recordedFrame(match, 0)).toBeNull();
  });

  it('draws the recording through the same render contract as the live match', () => {
    const { state, match } = watched('recorded-contract');
    const recording = match.recording!;
    const clock = recording.frames[recording.frames.length - 1]!.clock;
    const recorded = recordedFrame(match, clock)!;

    const render = buildMatchRenderState(match, state, {
      minute: clock / SECONDS_PER_MINUTE,
      revealed: match.events.length,
      focus: { x: recorded.ball.x, y: recorded.ball.y },
      players: recorded.players,
      ball: recorded.ball,
    });

    // The picture is the recorded movement, not a reconstruction.
    expect(render.continuous).toBe(true);
    expect(render.players).toBe(recorded.players);
    expect(render.ball).toBe(recorded.ball);
    expect(render.players.length).toBeGreaterThan(18);
  });

  it('falls back to the reconstruction when there is no recording to draw', () => {
    const { state, match } = watched('recorded-fallback');
    match.recording = undefined;
    const render = buildMatchRenderState(match, state, {
      minute: 20,
      revealed: 0,
      focus: { x: 0.5, y: 0.5 },
    });
    expect(render.continuous).toBe(false);
    expect(render.players.length).toBe(
      match.lineups.home.starting.length + match.lineups.away.starting.length,
    );
  });
});
