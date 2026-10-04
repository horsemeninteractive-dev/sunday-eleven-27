import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { createMatchEngine, type MatchEngine } from '@/simulation/match/matchEngine/engine';
import {
  MAX_KEYFRAMES,
  RECORD_INTERVAL_SECONDS,
  recordEngineKeyframe,
} from '@/simulation/match/recording';
import { forgetLiveEngine, liveEngineFor } from '@/state/liveEngine';
import { sampleRecording } from '@/domain/matchRecording';
import { buildMatchRenderState, recordedFrame } from './matchPresentation';
import { buildReplay, replayAt } from './matchReplay';

/**
 * A watched match, recorded and played back.
 *
 * The replay must show the afternoon that was watched, not a version of it drawn
 * afterwards. The live watch records the new engine's movement as it runs — at
 * the engine's own step cadence, through `MatchEngine.observe` — and the replay
 * reads that recording back. This pins the whole path: a watched match leaves a
 * recording, the recording is the movement the engine actually played, and the
 * replay's own clock lands on the exact instant to draw it.
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

/** A watched match: the engine runs with the same observer the live match sets. */
function watched(seed: string): { state: GameState; match: Match } {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  const engine = createMatchEngine(match, env);
  engine.observe((engineState) => recordEngineKeyframe(match, engineState));
  engine.runToCompletion();
  return { state, match };
}

/** Record a whole watched match, driven the way `play` says. */
function recordingOf(seed: string, play: (engine: MatchEngine) => void) {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  const engine = createMatchEngine(match, env);
  engine.observe((engineState) => recordEngineKeyframe(match, engineState));
  play(engine);
  return match.recording;
}

/** Drive the engine to the whistle in fixed `delta`-second calls. */
function inSteps(delta: number) {
  return (engine: MatchEngine) => {
    for (let guard = 0; guard < 200_000 && !engine.finished; guard += 1) {
      if (engine.getState().phase === 'half-time') engine.startSecondHalf();
      engine.advance(delta, delta, false);
    }
    expect(engine.finished).toBe(true);
  };
}

describe('a watched match recorded by the new engine', () => {
  it('leaves a recording of its movement, keyed by football seconds', () => {
    const { match } = watched('engine-replay-record');
    const recording = match.recording;
    expect(recording).toBeTruthy();
    expect(recording!.frames.length).toBeGreaterThan(0);
    expect(recording!.roster.length).toBeGreaterThanOrEqual(22);
    // Every frame is stamped on the football clock, and the samples only move on.
    let previous = -1;
    for (const frame of recording!.frames) {
      expect(frame.clock).toBeGreaterThan(previous);
      previous = frame.clock;
    }
  });

  it('is the movement the engine actually played, not an approximation', () => {
    const { match } = watched('engine-replay-faithful');
    const recording = match.recording!;
    // A sample in the middle of the match; reading it back at its own clock must
    // hand out exactly what the engine wrote down.
    const frame = recording.frames[Math.floor(recording.frames.length / 2)]!;
    const sample = sampleRecording(recording, frame.clock)!;
    expect(sample.ballX).toBeCloseTo(frame.ballX, 6);
    expect(sample.ballY).toBeCloseTo(frame.ballY, 6);

    const recorded = recordedFrame(match, frame.clock)!;
    expect(recorded).toBeTruthy();
    // Most of both sides — a sent-off man is correctly not drawn, so the count can
    // sit just below twenty-two — and every drawn position on the pitch.
    expect(recorded.players.length).toBeGreaterThanOrEqual(20);
    for (const player of recorded.players) {
      expect(player.x).toBeGreaterThanOrEqual(0);
      expect(player.x).toBeLessThanOrEqual(1);
      expect(player.y).toBeGreaterThanOrEqual(0);
      expect(player.y).toBeLessThanOrEqual(1);
    }
  });

  it('draws movement rather than a frozen picture', () => {
    const { match } = watched('engine-replay-moving');
    const recording = match.recording!;
    const firstClock = recording.frames[Math.floor(recording.frames.length * 0.25)]!.clock;
    const secondClock = recording.frames[Math.floor(recording.frames.length * 0.75)]!.clock;
    const before = recordedFrame(match, firstClock)!;
    const after = recordedFrame(match, secondClock)!;
    const beforeById = new Map(before.players.map((player) => [player.playerId, player]));
    let moved = 0;
    for (const player of after.players) {
      const from = beforeById.get(player.playerId);
      if (!from) continue;
      if (Math.hypot(player.x - from.x, player.y - from.y) > 0.05) moved += 1;
    }
    expect(moved).toBeGreaterThanOrEqual(8);
  });

  it('records through the same live-engine seam a watched match uses', () => {
    const { state } = createTestGame('engine-replay-live');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    forgetLiveEngine();
    try {
      const engine = liveEngineFor(match, env);
      engine.runToCompletion();
      // The live engine wired its own observer: the recording is written without
      // the caller touching the engine at all.
      expect(match.recording).toBeTruthy();
      expect(match.recording!.frames.length).toBeGreaterThan(0);
    } finally {
      forgetLiveEngine();
    }
  });

  it('records the same afternoon however the watching is paced', () => {
    // The engine's randomness is derived from the step index and the recording
    // is written from its fixed steps, so the pace of the watch — one step per
    // frame, big catch-up calls at a fast speed, or a jittery frame rate — cannot
    // change a single sample. This is what lets a replay look the same whoever
    // watched it, at whatever speed.
    const smooth = recordingOf('engine-replay-pace', inSteps(1 / 30));
    const fast = recordingOf('engine-replay-pace', inSteps(5));
    const whole = recordingOf('engine-replay-pace', (engine) => engine.runToCompletion());
    const jittery = recordingOf('engine-replay-pace', (engine) => {
      // A frame rate that wanders, the way a real one does.
      const deltas = [0.016, 0.04, 0.008, 0.065, 0.02, 0.1, 0.012, 0.03];
      let index = 0;
      for (let guard = 0; guard < 400_000 && !engine.finished; guard += 1) {
        if (engine.getState().phase === 'half-time') engine.startSecondHalf();
        const delta = deltas[index++ % deltas.length]!;
        engine.advance(delta, delta, false);
      }
      expect(engine.finished).toBe(true);
    });

    const expected = JSON.stringify(smooth);
    expect(smooth!.frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(fast)).toBe(expected);
    expect(JSON.stringify(whole)).toBe(expected);
    expect(JSON.stringify(jittery)).toBe(expected);
  });

  it('keeps the newest movement dense and only coarsens the past', () => {
    const recording = recordingOf('engine-replay-density', (engine) => engine.runToCompletion())!;
    const frames = recording.frames;
    // A whole match, thinned rather than forgotten: bounded, and never truncated.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(MAX_KEYFRAMES);
    // The last two samples are at the rate the match was watched — the movement
    // the manager is looking at stays smooth.
    // Samples land on a whole step, so the rate is the interval rounded up to
    // the engine's step; a little slack covers that.
    const newestGap = frames[frames.length - 1]!.clock - frames[frames.length - 2]!.clock;
    expect(newestGap).toBeLessThanOrEqual(RECORD_INTERVAL_SECONDS * 1.2);
    // The distant past has been decimated, so it reads more coarsely.
    const oldestGap = frames[1]!.clock - frames[0]!.clock;
    expect(oldestGap).toBeGreaterThan(newestGap * 1.5);
  });

  it('carries the recorded football through the shared render contract', () => {
    const { state, match } = watched('engine-replay-contract');
    const replay = buildReplay(match)!;
    const cue = replay.cues[Math.floor(replay.cues.length * 0.6)]!;
    const frame = replayAt(replay, cue.at);
    // The replay's own second is the football second of the moment it reached.
    expect(frame.second).toBeCloseTo(cue.second, 5);

    const recorded = recordedFrame(match, frame.second)!;
    expect(recorded).toBeTruthy();
    const render = buildMatchRenderState(match, state, {
      minute: frame.minute,
      revealed: frame.revealed,
      focus: { x: frame.x, y: frame.y },
      players: recorded.players,
      ball: recorded.ball,
    });
    expect(render.players.length).toBeGreaterThanOrEqual(20);
    // The picture is the recorded movement, not the formation fallback.
    const firstRecorded = recorded.players[0]!;
    const drawn = render.players.find((player) => player.playerId === firstRecorded.playerId)!;
    expect(drawn.x).toBeCloseTo(firstRecorded.x, 6);
    expect(drawn.y).toBeCloseTo(firstRecorded.y, 6);
  });
});
