import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { advanceMinute } from '@/simulation/match/engine';
import { SPATIAL_SECONDS_PER_MINUTE, SPATIAL_STEP_SECONDS, advanceSpatial } from '@/simulation/match/spatial';
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

const STEPS_PER_MINUTE = Math.round(SPATIAL_SECONDS_PER_MINUTE / SPATIAL_STEP_SECONDS);

function watched(seed: string): { state: GameState; match: Match; env: ReturnType<typeof matchEnvironment> } {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  advanceMinute(match, env); // kick-off, which puts the pitch in place
  for (let minute = 0; minute < 4; minute += 1) {
    advanceMinute(match, env);
    for (let step = 0; step < STEPS_PER_MINUTE; step += 1) advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
  }
  return { state, match, env };
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
      minute: clock / SPATIAL_SECONDS_PER_MINUTE,
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
