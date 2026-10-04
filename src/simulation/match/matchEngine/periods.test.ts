import { describe, expect, it } from 'vitest';
import {
  displayedMinuteFor,
  nextPeriod,
  PERIODS,
  periodEndSecond,
  periodStartSecond,
  specFor,
} from './periods';

/**
 * The period model is what lets the engine keep one monotonic clock and still
 * show a manager the part of the game he is watching. These tests pin the two
 * things that used to be entangled — where a period sits on the clock, and what
 * the clock reads — so extra time can be added without the second half's
 * arithmetic having to be rewritten.
 */
describe('match periods', () => {
  it('names the four parts of a match, in order', () => {
    expect(PERIODS.map((spec) => spec.period)).toEqual([
      'first-half',
      'second-half',
      'extra-first',
      'extra-second',
    ]);
    expect(nextPeriod('first-half')).toBe('second-half');
    expect(nextPeriod('second-half')).toBe('extra-first');
    expect(nextPeriod('extra-first')).toBe('extra-second');
    expect(nextPeriod('extra-second')).toBeNull();
  });

  it('shows the first half as the minutes the football has reached', () => {
    expect(displayedMinuteFor('first-half', 0, 0)).toBe(0);
    expect(displayedMinuteFor('first-half', 30 * 60, 0)).toBe(30);
    // Into stoppage: 45, then 46, 47 — the label runs on, the clock underneath.
    expect(displayedMinuteFor('first-half', 47 * 60, 0)).toBe(47);
  });

  it('rebases the second half so it opens at 45, whatever the first half added', () => {
    const firstHalfAdded = 4;
    // On the clock the second half begins at 49:00, because the clock never
    // stopped for the first half's stoppage; the label must still say 45.
    expect(periodStartSecond('second-half', firstHalfAdded)).toBe(49 * 60);
    expect(displayedMinuteFor('second-half', 49 * 60, firstHalfAdded)).toBe(45);
    expect(displayedMinuteFor('second-half', 75 * 60, firstHalfAdded)).toBe(71);
    // And the 90th minute is reached at 94:00 on the clock, and shown as 90.
    expect(displayedMinuteFor('second-half', 94 * 60, firstHalfAdded)).toBe(90);
  });

  it('opens extra time at 90 and 105, still rebased', () => {
    const added = 4 + 5; // both halves' stoppage, carried into extra time
    expect(displayedMinuteFor('extra-first', periodStartSecond('extra-first', added), added)).toBe(90);
    expect(displayedMinuteFor('extra-first', (105 + added) * 60, added)).toBe(105);
    expect(displayedMinuteFor('extra-second', periodStartSecond('extra-second', added), added)).toBe(105);
    expect(displayedMinuteFor('extra-second', (120 + added) * 60, added)).toBe(120);
  });

  it('tiles the clock with no gap and no overlap', () => {
    // Each period begins on the exact second the one before it ended, so the
    // monotonic clock and the displayed label can never disagree about where a
    // period starts.
    const firstHalfAdded = 4;
    const bothHalves = 4 + 5;
    expect(periodEndSecond('first-half', firstHalfAdded)).toBe(periodStartSecond('second-half', firstHalfAdded));
    expect(periodEndSecond('second-half', bothHalves)).toBe(periodStartSecond('extra-first', bothHalves));
    expect(periodEndSecond('extra-first', bothHalves)).toBe(periodStartSecond('extra-second', bothHalves));
  });

  it('never moves the clock backwards across the interval, only the label', () => {
    const added = 4;
    const firstHalfEnd = periodEndSecond('first-half', added);
    const secondHalfStart = periodStartSecond('second-half', added);
    // The guarantee the timeline, a replay and a report all rely on: seconds
    // since kick-off are monotonic.
    expect(secondHalfStart).toBeGreaterThanOrEqual(firstHalfEnd);
    // While the *label* drops back to 45 — that is the rebase, not a rewind.
    expect(displayedMinuteFor('first-half', firstHalfEnd, 0)).toBe(49);
    expect(displayedMinuteFor('second-half', secondHalfStart, added)).toBe(45);
  });

  it('records extra time as the third half', () => {
    expect(specFor('first-half').half).toBe(1);
    expect(specFor('second-half').half).toBe(2);
    expect(specFor('extra-first').half).toBe(3);
    expect(specFor('extra-second').half).toBe(3);
  });

  it('lets the halves take added time and plays extra time short', () => {
    expect(specFor('first-half').takesStoppage).toBe(true);
    expect(specFor('second-half').takesStoppage).toBe(true);
    expect(specFor('extra-first').takesStoppage).toBe(false);
    expect(specFor('extra-second').takesStoppage).toBe(false);
  });
});
