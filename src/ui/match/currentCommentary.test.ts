import { describe, expect, it } from 'vitest';
import type { CommentaryEvent } from '@/domain/match';
import { caughtUpIndex, currentCommentaryLine, isGoalLine, newestMinuteLines } from './CurrentCommentary';

/**
 * The live screen shows exactly one line. These pin the two rules that make it
 * behave: it is always a line that was actually written, and the newest one is
 * the end of the story rather than the start of the next.
 */

function line(minute: number, firstHalf: boolean, text: string): CommentaryEvent {
  return {
    id: `c${minute}-${text}`,
    minute,
    firstHalf,
    side: 'home',
    category: 'possession',
    priority: 'routine',
    kind: null,
    text,
    x: 0.5,
    y: 0.5,
    scoreAfter: null,
    playerId: null,
  };
}

describe('current commentary', () => {
  it('shows nothing before the first line', () => {
    expect(currentCommentaryLine([], 0)).toBeNull();
  });

  it('shows the first line, then walks forward one at a time', () => {
    const commentary = [line(10, true, 'One.'), line(10, true, 'Two.'), line(11, true, 'Three.')];
    expect(currentCommentaryLine(commentary, 1)?.text).toBe('One.');
    expect(currentCommentaryLine(commentary, 2)?.text).toBe('Two.');
    expect(currentCommentaryLine(commentary, 3)?.text).toBe('Three.');
  });

  it('never runs past the newest line, however far ahead the cursor is', () => {
    const commentary = [line(10, true, 'One.'), line(11, true, 'Two.')];
    expect(currentCommentaryLine(commentary, 99)?.text).toBe('Two.');
    // And a zero cursor still shows the match's first word rather than nothing.
    expect(currentCommentaryLine(commentary, 0)?.text).toBe('One.');
  });

  it('always returns a line that was actually written', () => {
    const commentary = [line(10, true, 'One.'), line(11, true, 'Two.')];
    for (let seen = -3; seen <= 5; seen += 1) {
      const current = currentCommentaryLine(commentary, seen);
      expect(commentary).toContain(current);
    }
  });

  it('knows how much the match has said in the minute it is on', () => {
    const commentary = [line(10, true, 'One.'), line(11, true, 'Two.'), line(11, true, 'Three.'), line(11, true, 'Four.')];
    expect(newestMinuteLines(commentary)).toBe(3);
    expect(newestMinuteLines([])).toBe(0);
    // The two halves run their minutes separately, so the same number in each
    // is two different minutes.
    const halves = [line(46, false, 'Second half.'), line(47, true, 'Stoppage.'), line(46, false, 'Back under way.')];
    expect(newestMinuteLines(halves)).toBe(1);
  });

  it('never leaves a minute on screen once the match has moved past it', () => {
    const commentary = [line(10, true, 'One.'), line(10, true, 'Two.'), line(11, true, 'Three.'), line(11, true, 'Four.')];
    // Still reading minute ten while minute eleven has lines: jump to the start
    // of the new minute rather than finishing a passage that has gone.
    expect(caughtUpIndex(commentary, 1)).toBe(3);
    // Already on the newest minute: left alone to walk it a line at a time.
    expect(caughtUpIndex(commentary, 3)).toBe(3);
    expect(caughtUpIndex(commentary, 4)).toBe(4);
    expect(caughtUpIndex([], 0)).toBe(0);
  });

  it('flashes only for a goal, not for anything else that matters', () => {
    expect(isGoalLine({ ...line(10, true, 'GOAL!'), kind: 'Goal' })).toBe(true);
    expect(isGoalLine({ ...line(10, true, 'Penalty!'), kind: 'Penalty scored' })).toBe(true);
    expect(isGoalLine({ ...line(10, true, 'Booking.'), kind: 'Yellow card' })).toBe(false);
    expect(isGoalLine({ ...line(10, true, 'Half time.'), kind: 'Half time' })).toBe(false);
    expect(isGoalLine(line(10, true, 'A pass.'))).toBe(false);
  });
});
