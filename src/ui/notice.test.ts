import { describe, expect, it } from 'vitest';
import { noticeLifetime } from './notice';

/**
 * A notice is the game talking, and it has to get out of the way on its own.
 * If this drifts, either a one-line confirmation sits on the screen for a
 * fortnight or a three-day digest vanishes before it can be read.
 */
describe('notice lifetime', () => {
  it('gives a short confirmation a few seconds and no more', () => {
    const short = noticeLifetime('Training: 10 turned up. Ordinary.');
    expect(short).toBeGreaterThanOrEqual(4_500);
    expect(short).toBeLessThan(6_000);
  });

  it('gives a long digest longer, without ever running away', () => {
    const long = noticeLifetime('x'.repeat(400));
    expect(long).toBeGreaterThan(noticeLifetime('x'.repeat(40)));
    expect(long).toBe(11_000);
  });

  it('never dips below the floor, however clipped the message', () => {
    expect(noticeLifetime('')).toBe(4_500);
  });
});
