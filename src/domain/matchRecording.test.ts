import { describe, expect, it } from 'vitest';
import type { PlayerId } from './ids';
import { sampleRecording, type MatchRecording } from './matchRecording';

/**
 * Reading a recording back.
 *
 * A recording is the real movement, sampled sparsely — a couple of instants a
 * second — so reading it is mostly about the straight lines drawn between those
 * instants. These tests pin the reading and nothing else: the football was
 * decided before any of it was written down, and reading it cannot change it.
 */

const roster = ['a', 'b'] as PlayerId[];

/** Positions are blended, so they are compared to a tolerance rather than as bits. */
function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
}

const recording: MatchRecording = {
  roster,
  interval: 0.5,
  frames: [
    { clock: 0, ballX: 0.5, ballY: 0.5, ballStatus: 'controlled', owner: 0, target: -1, players: [0.1, 0.2, 0.3, 0.4] },
    { clock: 1, ballX: 0.7, ballY: 0.6, ballStatus: 'travelling', owner: -1, target: 1, players: [0.3, 0.4, 0.5, 0.6] },
  ],
};

describe('reading a recording back', () => {
  it('has nothing to read when nothing was recorded', () => {
    expect(sampleRecording({ roster: [], interval: 0.5, frames: [] }, 0)).toBeNull();
  });

  it('returns the sample itself at the exact instant it was taken', () => {
    const start = sampleRecording(recording, 0)!;
    expect(start.ballX).toBeCloseTo(0.5, 6);
    expect(start.ballY).toBeCloseTo(0.5, 6);
    expect(start.players).toEqual([0.1, 0.2, 0.3, 0.4]);

    const end = sampleRecording(recording, 1)!;
    expect(end.ballX).toBeCloseTo(0.7, 6);
  });

  it('holds the ends rather than running off them', () => {
    const before = sampleRecording(recording, -5)!;
    expect(before.ballX).toBeCloseTo(0.5, 6);
    const after = sampleRecording(recording, 99)!;
    expect(after.ballX).toBeCloseTo(0.7, 6);
  });

  it('draws a straight line between two samples', () => {
    const mid = sampleRecording(recording, 0.5)!;
    expect(mid.ballX).toBeCloseTo(0.6, 6);
    expect(mid.ballY).toBeCloseTo(0.55, 6);
    expectClose(mid.players, [0.2, 0.3, 0.4, 0.5]);
  });

  it('takes the discrete facts from the nearer sample, not a blend of two', () => {
    // The ball is either at a man's feet or it is not; there is no halfway.
    expect(sampleRecording(recording, 0.4)!.ballStatus).toBe('controlled');
    expect(sampleRecording(recording, 0.4)!.owner).toBe(0);
    expect(sampleRecording(recording, 0.6)!.ballStatus).toBe('travelling');
    expect(sampleRecording(recording, 0.6)!.target).toBe(1);
  });

  it('does not slide a man on from the touchline when he is not in both samples', () => {
    const subbed: MatchRecording = {
      roster,
      interval: 0.5,
      frames: [
        { clock: 0, ballX: 0.5, ballY: 0.5, ballStatus: 'loose', owner: -1, target: -1, players: [0.1, 0.2, -1, -1] },
        { clock: 1, ballX: 0.5, ballY: 0.5, ballStatus: 'loose', owner: -1, target: -1, players: [0.3, 0.4, 0.5, 0.6] },
      ],
    };
    const mid = sampleRecording(subbed, 0.5)!;
    // The man already on is blended; the man coming on is simply placed.
    expectClose(mid.players, [0.2, 0.3, 0.5, 0.6]);
  });

  it('reads an older, shorter frame against the roster it was taken with', () => {
    const grown: MatchRecording = {
      roster: ['a', 'b', 'c'] as PlayerId[],
      interval: 0.5,
      frames: [
        { clock: 0, ballX: 0.5, ballY: 0.5, ballStatus: 'loose', owner: -1, target: -1, players: [0.1, 0.2] },
        { clock: 1, ballX: 0.5, ballY: 0.5, ballStatus: 'loose', owner: -1, target: -1, players: [0.3, 0.4, 0.5, 0.6] },
      ],
    };
    const mid = sampleRecording(grown, 0.5)!;
    // Only the slots both samples knew about are blended.
    expectClose(mid.players, [0.2, 0.3]);
  });
});
