import { useEffect, useState, type CSSProperties } from 'react';
import type { CommentaryEvent } from '@/domain/match';
import { inkForColour, withAlpha, type ClubColours } from '../colour';

/**
 * The match's voice, one line at a time.
 *
 * There is no list here on purpose. A Sunday afternoon is watched, not read: the
 * manager should be able to look up from the pitch and see what is happening
 * right now, without a transcript scrolling beside it. The full history is still
 * written down and is a tab away — see `CommentaryTranscript` — but it never
 * competes with the current moment for attention.
 *
 * The bar carries the colour of the club the line is about, so whose moment it
 * is can be read before the words are, and a goal flashes: the one thing in a
 * match that should be impossible to miss. The minute is not shown — the clock
 * is at the top of the screen and repeating it here only spends the line's room
 * on something already known.
 *
 * The lines a minute produces are paced out as the minute is played, so a move
 * reads as a move rather than appearing whole. That pacing is presentation only:
 * the clock and the football still come from the engine, and the lines
 * themselves were written by it.
 */

/**
 * How long each line stays up.
 *
 * A minute's worth of lines is spread across that minute, so the words keep
 * pace with the move they are describing rather than racing through a passage
 * the pitch has not played yet. The busier the minute, the faster the walk.
 */
function paceFor(minuteMs: number, linesInMinute: number): number {
  return Math.max(140, Math.round(minuteMs / Math.max(1, linesInMinute)));
}

/**
 * How far behind the newest line the reader is allowed to drift before the
 * screen gives up walking and catches up. The busier a minute is, the more
 * lines it writes, and at some point the only honest thing to do is show the
 * latest rather than walk through a minute that has already gone.
 */
const BEHIND_LIMIT = 6;

export function CurrentCommentary({
  commentary,
  revision,
  paused,
  speed,
  minuteMs,
  live,
  homeColours,
  awayColours,
}: {
  commentary: CommentaryEvent[];
  revision: number;
  paused: boolean;
  speed: number;
  /** How long one match minute lasts on screen at this speed. */
  minuteMs: number;
  live: boolean;
  homeColours: ClubColours;
  awayColours: ClubColours;
}) {
  const [seen, setSeen] = useState(0);

  // How much the match has said this minute, which is how long each line gets.
  const linesInMinute = newestMinuteLines(commentary);
  const pace = paceFor(minuteMs, linesInMinute);

  // A whistle, a pause or the end of the match puts the screen on the last
  // word; there is nothing left to pace.
  useEffect(() => {
    if (!live || paused) setSeen(commentary.length);
  }, [live, paused, commentary.length]);

  useEffect(() => {
    if (!live || paused) return;
    if (seen >= commentary.length) return;
    // At the fastest setting the football is already outrunning the prose, so
    // the current line simply is the newest one.
    if (speed >= 4 || commentary.length - seen > BEHIND_LIMIT) {
      setSeen(commentary.length);
      return;
    }
    // The walk may lag a little so a move reads as a move, but it may never
    // still be reading a minute the match has already left — that is the one
    // way the bar could show something the pitch is not doing.
    const caught = caughtUpIndex(commentary, seen);
    if (caught !== seen) {
      setSeen(caught);
      return;
    }

    const timer = window.setTimeout(() => setSeen((value) => Math.min(commentary.length, value + 1)), pace);
    return () => window.clearTimeout(timer);
  }, [seen, commentary.length, live, paused, speed, pace, revision]);

  const current = currentCommentaryLine(commentary, seen);

  if (!current) {
    return (
      <section className="commentary commentary--live" aria-label="Current commentary">
        <p className="commentary__idle">{live ? 'We are under way...' : 'Nothing yet — the whistle has not gone.'}</p>
      </section>
    );
  }

  const colours = current.side === 'home' ? homeColours : current.side === 'away' ? awayColours : null;
  const primary = colours?.primary ?? null;
  // The whole bar is tinted with the club's colour from the left and carries its
  // stripe, so whose passage this is reads before the sentence does.
  const barStyle = primary
    ? ({
        '--c-bar': withAlpha(primary, 0.22),
        '--c-line': primary,
        '--c-ink': inkForColour(primary),
      } as CSSProperties)
    : undefined;
  const goal = isGoalLine(current);

  return (
    <section className="commentary commentary--live" style={barStyle} aria-label="Current commentary">
      {/* Keyed on the line so a goal gets its flash afresh, however briefly the
          previous moment was on screen. */}
      <div
        key={current.id}
        className={`commentary__now${goal ? ' commentary__now--flash' : ''}`}
        role="status"
        aria-live="polite"
      >
        <p className="commentary__text">
          {current.kind && <span className="commentary__kind">{current.kind}</span>}
          {current.text}
        </p>
        {current.scoreAfter && (
          <span className="commentary__score">
            {current.scoreAfter.home}–{current.scoreAfter.away}
          </span>
        )}
      </div>
    </section>
  );
}

/** Two lines belong to the same minute of the same half. */
function sameMinute(a: CommentaryEvent, b: CommentaryEvent): boolean {
  return a.minute === b.minute && a.firstHalf === b.firstHalf;
}

/** How many of the match's most recent lines belong to the minute it is on. */
export function newestMinuteLines(commentary: readonly CommentaryEvent[]): number {
  const newest = commentary[commentary.length - 1];
  if (!newest) return 0;
  let count = 0;
  for (let index = commentary.length - 1; index >= 0; index -= 1) {
    if (!sameMinute(commentary[index]!, newest)) break;
    count += 1;
  }
  return count;
}

/**
 * How far the reader should be brought, given what is already on screen.
 *
 * The walk is allowed to lag a beat behind so a move reads as a move, but never
 * across a minute boundary: if a newer minute has produced lines while an older
 * one was still being read, the reader jumps to the start of the newest minute
 * rather than finishing a passage the match has already moved on from.
 */
export function caughtUpIndex(commentary: readonly CommentaryEvent[], seen: number): number {
  if (commentary.length === 0) return seen;
  const newest = commentary[commentary.length - 1]!;
  const showing = commentary[Math.min(commentary.length, Math.max(1, seen)) - 1]!;
  if (sameMinute(showing, newest)) return seen;
  return commentary.length - newestMinuteLines(commentary) + 1;
}

/**
 * Whether a line is the one thing in a match that should be impossible to miss.
 * Only a goal gets the flash; a booking or a whistle is important but not that.
 */
export function isGoalLine(event: CommentaryEvent): boolean {
  return event.kind === 'Goal' || event.kind === 'Penalty scored';
}

/**
 * The one line that is on screen after `seen` lines have been shown.
 *
 * The live screen shows a single line, so this is the whole of its logic: given
 * everything the match has said and how far the manager has been brought, which
 * line is he looking at? It never runs ahead of what was written, and it always
 * ends on the last line rather than past it.
 */
export function currentCommentaryLine(commentary: readonly CommentaryEvent[], seen: number): CommentaryEvent | null {
  if (commentary.length === 0) return null;
  const index = Math.min(commentary.length, Math.max(1, seen)) - 1;
  return commentary[index]!;
}
