import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CommentaryEvent } from '@/domain/match';
import { inkForColour, withAlpha } from '../colour';
import { BASE_MINUTE_MS } from '../matchPace';

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
 * A line is told as the step it describes takes the pitch, so the words and the
 * football are the same moment: the pass is played and the bar says so, rather
 * than the bar running a queue that the picture had already left behind. The bar
 * then shows the newest of those lines, holding each one only long enough to
 * read. That is the whole design — a minute of football is a few seconds on
 * screen, and a bar that tried to show every line in order would be permanently
 * behind, describing a move the pitch had finished. Anything the hold overruns
 * is a tab away in the transcript.
 *
 * The pacing is presentation only: the lines themselves, and the football, come
 * from the engine.
 */

/**
 * How long a line stays on screen before the bar moves on.
 *
 * The bar shows one line, so a line that is replaced instantly is a line that is
 * never read. But this is a *hold*, not a walk: when the timer runs out the bar
 * jumps to the newest line there is, not to the next one in sequence. That is
 * the whole difference between a bar that keeps up with the football and one that
 * does not — walking one line at a time could only ever fall further behind, and
 * a bar behind the pitch describes a move the pitch finished long ago.
 *
 * It is set near the rate lines are actually told at (a busy passage is told
 * something every few hundred milliseconds at 1x) so that the bar normally shows
 * each line as it is said rather than skipping every other one. A line is a
 * sentence or two; this is about how long it takes to read one.
 *
 * Overrunning a hold costs at most that one line, and the transcript has it. Being
 * behind costs every line from here to the end of the match.
 */
const LINE_HOLD_MS = 900;

/**
 * The shortest a hold may be, however fast the match is being watched.
 *
 * At high speed a minute of football is a couple of seconds and a busy one says
 * a dozen things, so a hold scaled purely by speed would put a line on screen for
 * a few frames. This floor keeps it legible — the bar shows the newest line, so
 * the lines it overruns are lost from the bar, but the bar is never behind.
 */
const MIN_LINE_MS = 260;

/**
 * How long the bar holds a line, given how long a minute of football is on
 * screen.
 *
 * The hold is a floor on legibility, not a pace: it is what stops a line being
 * replaced before it can be read. It scales with the compression of the watch,
 * because at 8x a minute is three quarters of a second and a fixed hold would be
 * several minutes of the pitch — but it is capped, because a line the manager
 * has had time to read does not need holding for the rest of the minute.
 */
export function lineHoldMs(minuteMs: number): number {
  const scaled = (LINE_HOLD_MS * minuteMs) / BASE_MINUTE_MS;
  return Math.max(MIN_LINE_MS, Math.min(LINE_HOLD_MS, scaled));
}

export function CurrentCommentary({
  commentary,
  revision,
  paused,
  minuteMs,
  live,
  homeColour,
  awayColour,
}: {
  commentary: CommentaryEvent[];
  revision: number;
  paused: boolean;
  /** How long one match minute lasts on screen at this speed. */
  minuteMs: number;
  live: boolean;
  /**
   * The first colour of the strip each side is actually wearing. The bar is
   * tinted in the shirt rather than the club colour, so a line about the
   * visitors in a white away strip arrives on white.
   */
  homeColour: string;
  awayColour: string;
}) {
  const [seen, setSeen] = useState(0);
  // When the line now on screen arrived, so a hold can be timed from the line
  // itself rather than from whenever the effect last happened to re-arm.
  const shownAt = useRef(0);

  // The hold is a floor on how long a line stays legible, not a pace to be
  // divided between lines: the football decides how often something happens, and
  // the bar shows the latest of it.
  const holdMs = lineHoldMs(minuteMs);

  // A whistle, a pause or the end of the match puts the screen on the last
  // word; there is nothing left to pace.
  useEffect(() => {
    if (!live || paused) {
      setSeen(commentary.length);
      shownAt.current = performance.now();
    }
  }, [live, paused, commentary.length]);

  useEffect(() => {
    if (!live || paused) return;
    if (seen >= commentary.length) return;
    // A line that is already on screen keeps the bar for its hold, however many
    // lines land during it. Without this the timer restarted on every arrival,
    // so on a busy minute — where a line lands every few hundred milliseconds
    // and the hold is longer than that — it would never once run out, and the
    // bar would sit on the same line for the whole match.
    const held = performance.now() - shownAt.current;
    const wait = Math.max(0, holdMs - held);
    const timer = window.setTimeout(() => {
      shownAt.current = performance.now();
      // To the *newest* line, not the next one. A busy minute says more than can
      // be read at the pace the football is being played, and the bar's job is
      // to say what is happening now, not to be a queue that is served in order.
      setSeen(commentary.length);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [seen, commentary.length, live, paused, revision, holdMs]);

  const current = currentCommentaryLine(commentary, seen);

  if (!current) {
    return (
      <section className="commentary commentary--live" aria-label="Current commentary">
        <p className="commentary__idle">{live ? 'We are under way...' : 'Nothing yet — the whistle has not gone.'}</p>
      </section>
    );
  }

  const primary =
    current.side === 'home' ? homeColour : current.side === 'away' ? awayColour : null;
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
 *
 * `seen` is the count of lines the bar has *reached*, not a promise to show
 * them all: it jumps forward when the football outruns the hold, because a bar
 * behind the pitch is worse than a bar that has skipped a line.
 */
export function currentCommentaryLine(commentary: readonly CommentaryEvent[], seen: number): CommentaryEvent | null {
  if (commentary.length === 0) return null;
  const index = Math.min(commentary.length, Math.max(1, seen)) - 1;
  return commentary[index]!;
}
