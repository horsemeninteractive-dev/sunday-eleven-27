import { describe, expect, it } from 'vitest';
import { periodLabel, periodOf, type Match, type MatchPeriod } from './match';

/** The only two fields `periodOf` reads, so the rest of a Match is not needed. */
function matchIn(half: 1 | 2 | 3, period?: MatchPeriod): Match {
  return { half, period } as Match;
}

describe('match period', () => {
  it('reads the period the engine set, and names it', () => {
    expect(periodLabel(matchIn(1, 'first-half'))).toBe('First half');
    expect(periodLabel(matchIn(2, 'second-half'))).toBe('Second half');
    expect(periodLabel(matchIn(3, 'extra-first'))).toBe('Extra time');
    expect(periodLabel(matchIn(3, 'extra-second'))).toBe('Extra time');
  });

  it('tells the two periods of extra time apart, which the half number cannot', () => {
    // Both are half 3; only the period knows which one is being played.
    expect(periodOf(matchIn(3, 'extra-first'))).toBe('extra-first');
    expect(periodOf(matchIn(3, 'extra-second'))).toBe('extra-second');
  });

  it('falls back to the half for a save written before periods existed', () => {
    expect(periodOf(matchIn(1))).toBe('first-half');
    expect(periodOf(matchIn(2))).toBe('second-half');
    // The half can only say "extra time"; it cannot say which period of it.
    expect(periodOf(matchIn(3))).toBe('extra-first');
  });
});
