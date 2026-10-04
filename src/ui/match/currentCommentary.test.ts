import { describe, expect, it } from 'vitest';
import type { CommentaryEvent } from '@/domain/match';
import { currentCommentaryLine, isGoalLine, lineHoldMs } from './CurrentCommentary';

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

  it('shows the first line, then reaches the newest', () => {
    const commentary = [line(10, true, 'One.'), line(10, true, 'Two.'), line(11, true, 'Three.')];
    expect(currentCommentaryLine(commentary, 1)?.text).toBe('One.');
    expect(currentCommentaryLine(commentary, 2)?.text).toBe('Two.');
    // The bar jumps to the newest rather than walking, so a busy minute never
    // leaves it describing something the pitch finished long ago.
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
    // The bar reaches the newest line, so the count it shows is the whole of
    // what has been told — never a stale one from before the minute turned.
    expect(currentCommentaryLine(commentary, commentary.length)?.text).toBe('Four.');
  });

  it('holds a line long enough to read, and never longer than the football takes', () => {
    // At 1x a minute is six seconds on screen, so a line is held for a readable
    // moment against that pace.
    expect(lineHoldMs(6000)).toBeGreaterThanOrEqual(260);
    // Compressed watching scales the hold down, because there is less time for
    // everything — but never below the floor at which a line is a flash.
    expect(lineHoldMs(750)).toBeGreaterThanOrEqual(260);
    expect(lineHoldMs(750)).toBeLessThan(lineHoldMs(6000));
    // Watching at a tenth speed does not stretch a line for ten seconds; the
    // hold is bounded by what the eye can do, not by how slow the clock is.
    expect(lineHoldMs(60_000)).toBe(900);
  });

  it('flashes only for a goal, not for anything else that matters', () => {
    expect(isGoalLine({ ...line(10, true, 'GOAL!'), kind: 'Goal' })).toBe(true);
    expect(isGoalLine({ ...line(10, true, 'Penalty!'), kind: 'Penalty scored' })).toBe(true);
    expect(isGoalLine({ ...line(10, true, 'Booking.'), kind: 'Yellow card' })).toBe(false);
    expect(isGoalLine({ ...line(10, true, 'Half time.'), kind: 'Half time' })).toBe(false);
    expect(isGoalLine(line(10, true, 'A pass.'))).toBe(false);
  });
});
