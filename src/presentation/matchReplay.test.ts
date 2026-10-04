import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { simulateToCompletion } from '@/simulation/match/engine';
import { buildMatchRenderState } from './matchPresentation';
import { buildReplay, replayAt } from './matchReplay';

/**
 * The replay.
 *
 * A replay is not a second simulation: it is a reading of the record a match
 * already left behind — its events, in the shared signal vocabulary, laid out on
 * a clock of their own. These tests pin the parts that make it safe to watch an
 * afternoon back: the cues are the match's own moments in order, the replay is
 * sampled from them without ever reading ahead, and watching a match back cannot
 * change a line of it.
 */

function played(seed: string): { state: GameState; match: Match } {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  simulateToCompletion(match, env);
  return { state, match };
}

describe('building a replay', () => {
  it('has nothing to replay for a match that was never played', () => {
    const { state } = createTestGame('replay-empty');
    const fixture = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
    )!;
    const match = cloneMatch(state.matches[fixture.id]!);
    match.events = [];
    expect(buildReplay(match)).toBeNull();
  });

  it('turns the match record into cues in the order it happened', () => {
    const { match } = played('replay-cues');
    const replay = buildReplay(match)!;
    expect(replay.cues).toHaveLength(match.events.length);
    expect(replay.signals).toHaveLength(match.events.length);
    expect(replay.duration).toBeGreaterThan(0);

    // The cues are the record, in order, and their replay times only move on.
    let previous = -1;
    replay.cues.forEach((cue, index) => {
      expect(cue.index).toBe(index);
      expect(cue.at).toBeGreaterThan(previous);
      previous = cue.at;
      expect(cue.x).toBeGreaterThanOrEqual(0);
      expect(cue.x).toBeLessThanOrEqual(1);
    });
    // Nothing can be shown after the replay has run out.
    expect(replay.cues[replay.cues.length - 1]!.at).toBeLessThanOrEqual(replay.duration);
  });

  it('does not change the match it is reading', () => {
    const { match } = played('replay-readonly');
    const before = JSON.stringify({ events: match.events, result: match.result, minute: match.minute });
    const replay = buildReplay(match)!;
    replayAt(replay, replay.duration / 2);
    replayAt(replay, replay.duration);
    const after = JSON.stringify({ events: match.events, result: match.result, minute: match.minute });
    expect(after).toBe(before);
  });
});

describe('watching a replay', () => {
  it('reveals the record only as its time comes', () => {
    const { match } = played('replay-reveal');
    const replay = buildReplay(match)!;

    const start = replayAt(replay, 0);
    const end = replayAt(replay, replay.duration);
    expect(start.revealed).toBeLessThan(end.revealed);
    expect(end.revealed).toBe(replay.cues.length);

    // Every moment in between reveals at least what came before it.
    let previous = 0;
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const frame = replayAt(replay, replay.duration * fraction);
      expect(frame.revealed).toBeGreaterThanOrEqual(previous);
      previous = frame.revealed;
    }
  });

  it('puts the ball at the moment when the moment arrives', () => {
    const { match } = played('replay-position');
    const replay = buildReplay(match)!;
    const cue = replay.cues[Math.floor(replay.cues.length / 2)]!;
    const frame = replayAt(replay, cue.at);
    expect(frame.x).toBeCloseTo(cue.x, 5);
    expect(frame.y).toBeCloseTo(cue.y, 5);
    expect(frame.cue?.index).toBe(cue.index);
  });

  it('keeps the ball on the pitch between moments', () => {
    const { match } = played('replay-between');
    const replay = buildReplay(match)!;
    for (let step = 0; step <= 20; step += 1) {
      const frame = replayAt(replay, (replay.duration * step) / 20);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x).toBeLessThanOrEqual(1);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('a replay through the render contract', () => {
  it('draws the record through the same state the live match uses', () => {
    const { state, match } = played('replay-contract');
    const replay = buildReplay(match)!;
    const frame = replayAt(replay, replay.duration * 0.6);

    const render = buildMatchRenderState(match, state, {
      minute: frame.minute,
      revealed: frame.revealed,
      focus: { x: frame.x, y: frame.y },
    });

    // A replay has no continuous state to read — only the record — so the
    // picture is the reconstruction, and the ball is where the frame says.
    expect(render.continuous).toBe(false);
    expect(render.signals).toHaveLength(frame.revealed);
    expect(render.ball.x).toBeCloseTo(frame.x, 5);
    expect(render.ball.y).toBeCloseTo(frame.y, 5);
    expect(render.players).toHaveLength(match.lineups.home.starting.length + match.lineups.away.starting.length);

    // And it is fed from the record: no cue that has not been reached leaks in.
    const leaked = render.signals.length < match.events.length;
    expect(leaked).toBe(frame.revealed < match.events.length);
  });

  it('stands everyone on the pitch, even for a match with no spatial state', () => {
    const { state, match } = played('replay-no-spatial');
    match.spatial = undefined;
    const replay = buildReplay(match)!;
    const frame = replayAt(replay, replay.duration * 0.4);
    const render = buildMatchRenderState(match, state, {
      minute: frame.minute,
      revealed: frame.revealed,
      focus: { x: frame.x, y: frame.y },
    });
    expect(render.players.length).toBeGreaterThan(0);
    expect(render.players.every((node) => node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1)).toBe(true);
  });
});
