import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { ReplayKeyframe } from '@/domain/matchRecording';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { advanceMinute } from './engine';
import { SPATIAL_SECONDS_PER_MINUTE, SPATIAL_STEP_SECONDS, advanceSpatial } from './spatial';
import { MAX_KEYFRAMES, RECORD_INTERVAL_SECONDS, recordKeyframe } from './recording';
import { cloneMatch } from './testHelpers';

/**
 * Writing the movement down.
 *
 * A recording is what lets a replay show the afternoon that was watched rather
 * than a tidy version of it drawn afterwards, so the thing worth pinning is that
 * it is the *real* movement: sampled from the continuous state as it moves, in
 * the state's own order, and identical for identical football. It is a reader,
 * so it must also be incapable of changing a result.
 */

const STEPS_PER_MINUTE = Math.round(SPATIAL_SECONDS_PER_MINUTE / SPATIAL_STEP_SECONDS);

function fixtureOf(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  return fixture;
}

/** A watched match: kick-off has happened and the pitch is in place. */
function watched(seed: string): { state: GameState; match: Match; env: ReturnType<typeof matchEnvironment> } {
  const { state } = createTestGame(seed);
  const fixture = fixtureOf(state);
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  advanceMinute(match, env); // kick-off, which puts the pitch in place
  return { state, match, env };
}

function play(match: Match, env: ReturnType<typeof matchEnvironment>, minutes: number): void {
  for (let minute = 0; minute < minutes; minute += 1) {
    advanceMinute(match, env);
    for (let step = 0; step < STEPS_PER_MINUTE; step += 1) {
      advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
    }
  }
}

describe('recording a watched match', () => {
  it('writes nothing down for a match nobody watched', () => {
    const { state } = createTestGame('record-none');
    const fixture = fixtureOf(state);
    prepareMatchday(state, fixture.matchday);
    const match = cloneMatch(state.matches[fixture.id]!);
    match.spatial = undefined;
    recordKeyframe(match);
    expect(match.recording).toBeUndefined();
  });

  it('keeps the movement of the match as it is watched', () => {
    const { match, env } = watched('record-move');
    play(match, env, 6);

    const recording = match.recording!;
    expect(recording).toBeTruthy();
    // The twenty-two who started, and a flat position for each of them.
    expect(recording.roster.length).toBeGreaterThanOrEqual(22);
    expect(recording.frames.length).toBeGreaterThan(10);
    const last = recording.frames[recording.frames.length - 1]!;
    expect(last.players).toHaveLength(recording.roster.length * 2);
    for (const value of last.players) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('samples on its own interval rather than every step', () => {
    const { match, env } = watched('record-interval');
    play(match, env, 4);

    const { frames } = match.recording!;
    // Far fewer samples than simulation steps: it is a memory, not a transcript.
    expect(frames.length).toBeLessThan((4 + 1) * STEPS_PER_MINUTE);
    for (let i = 1; i < frames.length; i += 1) {
      const gap = frames[i]!.clock - frames[i - 1]!.clock;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeGreaterThanOrEqual(RECORD_INTERVAL_SECONDS - 1e-6);
    }
  });

  it('remembers real movement, not a still picture', () => {
    const { match, env } = watched('record-moving-picture');
    play(match, env, 5);
    const { frames } = match.recording!;
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    // The men out there actually went somewhere over the five minutes.
    expect(last.players).not.toEqual(first.players);
    expect(last.clock).toBeGreaterThan(first.clock);
  });

  it('names the ball\\u2019s owner as a slot in its own roster', () => {
    const { match, env } = watched('record-ball');
    play(match, env, 5);
    const recording = match.recording!;
    for (const frame of recording.frames) {
      if (frame.owner >= 0) expect(recording.roster[frame.owner]).toBeTruthy();
      if (frame.target >= 0) expect(recording.roster[frame.target]).toBeTruthy();
      expect(frame.ballX).toBeGreaterThanOrEqual(0);
      expect(frame.ballX).toBeLessThanOrEqual(1);
    }
    // The ball is not simply parked at the centre: it is on somebody's foot or in
    // flight at least once.
    expect(recording.frames.some((frame) => frame.owner >= 0 || frame.target >= 0)).toBe(true);
  });

  it('is the same football, recorded the same way, from the same seed', () => {
    const one = watched('record-determinism');
    play(one.match, one.env, 3);
    const two = watched('record-determinism');
    play(two.match, two.env, 3);
    expect(JSON.stringify(one.match.recording)).toBe(JSON.stringify(two.match.recording));
  });

  it('leaves the match record untouched', () => {
    const { match, env } = watched('record-readonly');
    // The engine's own minutes first — those do write events, and should. What
    // this pins is that the recording, which only ever runs during the continuous
    // steps, adds nothing to the record.
    play(match, env, 2);
    const before = JSON.stringify({ events: match.events, result: match.result, minute: match.minute });
    expect(match.recording).toBeTruthy();
    for (let step = 0; step < STEPS_PER_MINUTE; step += 1) {
      advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
    }
    expect(JSON.stringify({ events: match.events, result: match.result, minute: match.minute })).toBe(before);
  });

  it('thins the past rather than forgetting the match when it grows past its budget', () => {
    const { match } = watched('record-thin');
    const spatial = match.spatial!;
    // A recording already at its ceiling, with a little room after the last
    // sample so the next one is taken and the thinning runs.
    const frames: ReplayKeyframe[] = [];
    for (let i = 0; i <= MAX_KEYFRAMES; i += 1) {
      frames.push({
        clock: i * RECORD_INTERVAL_SECONDS,
        ballX: 0.5,
        ballY: 0.5,
        ballStatus: 'loose',
        owner: -1,
        target: -1,
        players: [],
      });
    }
    match.recording = { roster: [match.lineups.home.starting[0]!.playerId], interval: RECORD_INTERVAL_SECONDS, frames };
    spatial.clock = frames[frames.length - 1]!.clock + RECORD_INTERVAL_SECONDS;

    recordKeyframe(match);

    const recording = match.recording!;
    // The whole match is still there, its past read a little more coarsely.
    expect(recording.frames.length).toBeLessThan(MAX_KEYFRAMES);
    expect(recording.frames.length).toBeGreaterThan(MAX_KEYFRAMES / 2);
    // The rate of the newest samples does not change: only the past was thinned.
    expect(recording.interval).toBe(RECORD_INTERVAL_SECONDS);
    // And the sample just taken — the movement being watched now — is kept.
    const newest = recording.frames[recording.frames.length - 1]!;
    expect(newest.clock).toBeCloseTo(spatial.clock, 4);
  });
});
