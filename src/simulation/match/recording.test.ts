import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { ReplayKeyframe } from '@/domain/matchRecording';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { createMatchEngine, type MatchEngine } from './matchEngine';
import { MAX_KEYFRAMES, RECORD_INTERVAL_SECONDS, recordEngineKeyframe } from './recording';
import { cloneMatch } from './testHelpers';

/**
 * Writing the movement down.
 *
 * A recording is what lets a replay show the afternoon that was watched rather
 * than a tidy version of it drawn afterwards, so the thing worth pinning is that
 * it is the *real* movement: sampled from the authoritative engine state as it
 * moves, in the state's own order, and identical for identical football.
 *
 * It is a reader, and the engine does not record anything of its own accord —
 * the watcher wires the observer — so it must also be incapable of changing a
 * result.
 */

function fixtureOf(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  return fixture;
}

/** A watched match: the engine runs with the same observer a live match sets. */
function watched(seed: string): { state: GameState; match: Match; engine: MatchEngine } {
  const staged = unwatched(seed);
  staged.engine.observe((engineState) => recordEngineKeyframe(staged.match, engineState));
  return staged;
}

/**
 * The same fixture with nobody watching: no observer, and therefore nothing
 * written down. The engine records nothing of its own accord.
 */
function unwatched(seed: string): { state: GameState; match: Match; engine: MatchEngine } {
  const { state } = createTestGame(seed);
  const fixture = fixtureOf(state);
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  return { state, match, engine: createMatchEngine(match, env) };
}

/** Play `minutes` of football, at the pace a live watch drives the engine. */
function play(engine: MatchEngine, minutes: number): void {
  const until = minutes * 60;
  for (let guard = 0; guard < 200_000 && engine.getState().clock < until; guard += 1) {
    if (engine.getState().phase === 'half-time') engine.startSecondHalf();
    engine.advance(1, 1, false);
  }
}

describe('recording a watched match', () => {
  it('writes nothing down for a match nobody watched', () => {
    // The recording is wired by the watcher, not by the engine: a match that is
    // simulated to the whistle but never observed leaves no recording behind.
    const { state } = createTestGame('record-none');
    const fixture = fixtureOf(state);
    prepareMatchday(state, fixture.matchday);
    const match = cloneMatch(state.matches[fixture.id]!);
    const engine = createMatchEngine(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
    engine.runToCompletion();
    expect(match.recording).toBeUndefined();
  });

  it('keeps the movement of the match as it is watched', () => {
    const { match, engine } = watched('record-move');
    play(engine, 6);

    const recording = match.recording!;
    expect(recording).toBeTruthy();
    // The twenty-two who started, and a flat position for each of them.
    expect(recording.roster.length).toBeGreaterThanOrEqual(22);
    expect(recording.frames.length).toBeGreaterThan(10);
    const last = recording.frames[recording.frames.length - 1]!;
    expect(last.players).toHaveLength(recording.roster.length * 2);
    // Every man out there has a place on the pitch. A slot nobody occupies — a
    // substitute not yet on, and a sent-off man, who is deliberately not drawn —
    // is left blank rather than guessed at.
    const placed = last.players.filter((value) => value >= 0).length / 2;
    expect(placed).toBeGreaterThanOrEqual(20);
    for (const value of last.players) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('samples on its own interval rather than every step', () => {
    const { match, engine } = watched('record-interval');
    play(engine, 4);

    const { frames } = match.recording!;
    // Far fewer samples than simulation steps: it is a memory, not a transcript.
    // Four minutes of football is seven thousand two hundred fixed steps.
    expect(frames.length).toBeLessThan(4 * 60 * 30);
    for (let i = 1; i < frames.length; i += 1) {
      const gap = frames[i]!.clock - frames[i - 1]!.clock;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeGreaterThanOrEqual(RECORD_INTERVAL_SECONDS - 1e-6);
    }
  });

  it('remembers real movement, not a still picture', () => {
    const { match, engine } = watched('record-moving-picture');
    play(engine, 5);
    const { frames } = match.recording!;
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    // The men out there actually went somewhere over the five minutes.
    expect(last.players).not.toEqual(first.players);
    expect(last.clock).toBeGreaterThan(first.clock);
  });

  it('names the ball\u2019s owner as a slot in its own roster', () => {
    const { match, engine } = watched('record-ball');
    play(engine, 5);
    const recording = match.recording!;
    for (const frame of recording.frames) {
      if (frame.owner >= 0) expect(recording.roster[frame.owner]).toBeTruthy();
      if (frame.target >= 0) expect(recording.roster[frame.target]).toBeTruthy();
      // A ball that is out of play may sit a moment beyond the line; a ball in
      // play is always on the pitch.
      if (frame.ballStatus !== 'out-of-play') {
        expect(frame.ballX).toBeGreaterThanOrEqual(0);
        expect(frame.ballX).toBeLessThanOrEqual(1);
      }
    }
    // The ball is not simply parked at the centre: it is on somebody's foot or in
    // flight at least once.
    expect(recording.frames.some((frame) => frame.owner >= 0 || frame.target >= 0)).toBe(true);
  });

  it('is the same football, recorded the same way, from the same seed', () => {
    const one = watched('record-determinism');
    play(one.engine, 3);
    const two = watched('record-determinism');
    play(two.engine, 3);
    expect(JSON.stringify(one.match.recording)).toBe(JSON.stringify(two.match.recording));
  });

  it('leaves the match record untouched', () => {
    // The same afternoon twice: watched, and not. The recorder writes down what
    // the engine made true and nothing else, so observing a match cannot change a
    // single thing about the football — the events, the score, the performances
    // and the minute are all identical.
    const plain = unwatched('record-readonly');
    const recorded = watched('record-readonly');
    play(plain.engine, 3);
    play(recorded.engine, 3);
    expect(recorded.match.recording).toBeTruthy();
    expect(plain.match.recording).toBeUndefined();
    const recordOf = (match: Match) =>
      JSON.stringify({
        events: match.events,
        result: match.result,
        performances: match.performances,
        minute: match.minute,
      });
    expect(recordOf(recorded.match)).toBe(recordOf(plain.match));
  });

  it('thins the past rather than forgetting the match when it grows past its budget', () => {
    const { match, engine } = watched('record-thin');
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
    // The engine is still at kick-off, so the sample is taken from its real state
    // with the clock set past the last stored moment.
    const clock = frames[frames.length - 1]!.clock + RECORD_INTERVAL_SECONDS;
    recordEngineKeyframe(match, { ...engine.getState(), clock });

    const recording = match.recording!;
    // The whole match is still there, its past read a little more coarsely.
    expect(recording.frames.length).toBeLessThan(MAX_KEYFRAMES);
    expect(recording.frames.length).toBeGreaterThan(MAX_KEYFRAMES / 2);
    // The rate of the newest samples does not change: only the past was thinned.
    expect(recording.interval).toBe(RECORD_INTERVAL_SECONDS);
    // And the sample just taken — the movement being watched now — is kept.
    const newest = recording.frames[recording.frames.length - 1]!;
    expect(newest.clock).toBeCloseTo(clock, 4);
  });
});
