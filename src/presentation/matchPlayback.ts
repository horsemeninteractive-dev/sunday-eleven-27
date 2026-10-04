import type { MatchPassage, MatchTimeline } from './matchTimeline';
import { passageAt } from './matchTimeline';

/**
 * How the match is watched, as opposed to how it is played.
 *
 * The engine decides what happens and how long it takes in football seconds.
 * This decides how much of that the manager sees and how quickly — the whole of
 * the presentation half of the split. It never touches the simulation: it reads
 * the timeline, keeps a cursor in *simulation seconds*, and spends real time on
 * those seconds according to how interesting the football is.
 *
 * That is the difference from the old model. A match used to be watched at a
 * fixed compression — a minute of football is six seconds on screen — so a goal
 * and a throw-in cost the same and the manager either missed everything or
 * watched everything. Here, ordinary play is fast-forwarded and the passages
 * that matter are slowed down, and the ratio is not a constant at all: it is a
 * decision made per passage, from the football.
 *
 * Crucially the engine is never allowed to run ahead of the picture. The cursor
 * *is* the engine's clock: the presentation says how fast to spend the next
 * frame and the engine plays exactly that much. A skip is therefore not a jump
 * through a pre-played match — it is the presentation choosing to spend the
 * football very quickly until the passage it is inside becomes one worth
 * watching. Nothing is skipped in the record; only in what has been watched.
 *
 * Nothing in here simulates. Every passage it reads was already played by the
 * engine; the worst a bug here can do is show the wrong amount of the right
 * football.
 */

/** How much of the match the manager wants to see. */
export type ViewingMode = 'full' | 'extended' | 'key' | 'commentary';

export const VIEWING_MODES: readonly ViewingMode[] = ['full', 'extended', 'key', 'commentary'];

export const VIEWING_MODE_LABEL: Record<ViewingMode, string> = {
  full: 'Full match',
  extended: 'Extended',
  key: 'Key moments',
  commentary: 'Commentary',
};

export const VIEWING_MODE_DETAIL: Record<ViewingMode, string> = {
  full: 'Every passage, ordinary play accelerated and the big moments slowed down.',
  extended: 'Notable passages only; the quiet stretches are skipped.',
  key: 'Goals, chances and incidents; everything else is fast-forwarded.',
  commentary: 'No pitch — the match runs ahead and the words carry it.',
};

/** The lowest passage importance a mode bothers to show in detail. */
const MODE_THRESHOLD: Record<ViewingMode, 1 | 2 | 3> = {
  full: 1,
  extended: 2,
  key: 3,
  commentary: 1,
};

/**
 * Real seconds given to one simulation second of ordinary football.
 *
 * This is the fast-forward: at a fifth of real time, ordinary play runs five
 * times faster than life — quick enough to get through the quiet spells, slow
 * enough that the ball is still followable, and a good deal calmer than the old
 * fixed ten-to-one compression that made every second of a match race past.
 * Everything else is expressed as an addition on top of this rather than as a
 * replacement for it, so a long passage of nothing stays cheap however it is
 * being watched.
 */
export const FILLER_REAL_PER_SIM = 0.2;

/**
 * Extra real seconds per simulation second a passage earns for being notable.
 *
 * A flat rate rather than a total spread over the passage's length: the length
 * is not known until the passage is over, and a rate that changed as events
 * arrived would make the picture stutter. At these values ordinary play runs
 * five times faster than life, a notable passage about three times, and a clear
 * chance or a goal close to real time — which is the whole point of the split:
 * the moments that matter are watched, and the filler is got through.
 */
const HOLD_PER_SIM: Record<1 | 2 | 3, number> = {
  1: 0,
  2: 0.15,
  3: 0.5,
};

/**
 * How fast the cursor runs when it is skipping, in simulation seconds per real
 * second at 1×.
 *
 * A skip is not an instant — the presentation still consumes the football, so
 * the clock and the commentary stay coherent — it is just fast enough that a few
 * minutes of nothing pass in a moment. Sixty simulation seconds a second runs a
 * goalless half in under a minute.
 */
export const SKIP_RATE = 60;

/**
 * The most football one skip tick may consume.
 *
 * The cursor must never run *past* the passage it is skipping to. If a frame
 * were allowed to spend twenty seconds at once it could sail through the goal it
 * was looking for and have to be wound back, leaving the engine — which is
 * driven to the cursor — briefly ahead of the picture. Capping the step keeps
 * the engine level with the cursor: the presentation can only ever land on a
 * highlight it has not yet passed.
 */
export const MAX_SKIP_STEP_SECONDS = 1;

/** The presentation's own state, independent of the engine's. */
export interface PlaybackCursor {
  /** Simulation seconds the presentation has reached. */
  cursor: number;
  /** True while fast-forwarding to the next thing worth watching. */
  skipping: boolean;
}

export function createCursor(cursor = 0): PlaybackCursor {
  return { cursor, skipping: false };
}

/** Whether a passage is shown in detail under a mode, or skipped over. */
export function passageShown(passage: MatchPassage, mode: ViewingMode): boolean {
  return passage.importance >= MODE_THRESHOLD[mode];
}

/** A speed multiplier that is safe to divide by. */
function safeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/**
 * Real seconds one simulation second of a passage is worth.
 *
 * Filler costs {@link FILLER_REAL_PER_SIM} a second; a notable passage adds its
 * hold. The manager's speed multiplier then divides the whole thing — speed
 * never changes *what* is shown, only how quickly it is spent, which is what
 * keeps the football independent of it.
 */
export function realSecondsPerSimSecond(
  passage: MatchPassage | null,
  mode: ViewingMode,
  speed: number,
): number {
  const multiplier = safeSpeed(speed);
  if (!passage) return FILLER_REAL_PER_SIM / multiplier;
  if (!passageShown(passage, mode)) return (1 / SKIP_RATE) / multiplier;
  return (FILLER_REAL_PER_SIM + HOLD_PER_SIM[passage.importance]) / multiplier;
}

/**
 * How much simulation time a real-time delta buys at this instant.
 *
 * The inverse of {@link realSecondsPerSimSecond}: the presentation's answer to
 * "how much football is this frame worth?". A skip runs at {@link SKIP_RATE}
 * whatever the passage, which is what makes it a fast-forward rather than a
 * second viewing mode.
 */
export function simSecondsForRealDelta(
  state: PlaybackCursor,
  mode: ViewingMode,
  speed: number,
  timeline: MatchTimeline,
  realDelta: number,
): number {
  if (!(realDelta > 0)) return 0;
  const multiplier = safeSpeed(speed);
  if (state.skipping) {
    return Math.min(realDelta * SKIP_RATE * multiplier, MAX_SKIP_STEP_SECONDS);
  }
  return realDelta / realSecondsPerSimSecond(passageAt(timeline, state.cursor), mode, multiplier);
}

/** What one tick of the presentation should do. */
export interface PlaybackTick {
  /** Simulation second the presentation should now be at. */
  cursor: number;
  /** Whether the presentation is still fast-forwarding. */
  skipping: boolean;
  /** The passage being shown, if any. */
  passage: MatchPassage | null;
}

/**
 * Advance the presentation by a real-time delta.
 *
 * The cursor moves through simulation seconds at the rate the current passage
 * deserves, and the caller plays the engine forward to match. A skip runs the
 * cursor quickly and stops the moment the football enters a passage this mode
 * would show — landing on that passage's first second rather than sailing past
 * it, so the manager sees the move from its beginning.
 */
export function tickPlayback(
  state: PlaybackCursor,
  mode: ViewingMode,
  speed: number,
  timeline: MatchTimeline,
  realDelta: number,
): PlaybackTick {
  const delta = simSecondsForRealDelta(state, mode, speed, timeline, realDelta);
  let cursor = state.cursor + delta;
  let skipping = state.skipping;

  if (skipping) {
    // The football just played has told us what is happening now. If this mode
    // would show the passage the cursor has arrived in — and it is a passage the
    // skip began before — the fast-forward is over.
    const arrived = passageAt(timeline, cursor);
    if (
      arrived &&
      arrived.startSecond > state.cursor &&
      passageShown(arrived, mode)
    ) {
      cursor = arrived.startSecond;
      skipping = false;
    } else {
      // Otherwise keep looking one passage ahead: the skip stops as soon as a
      // passage worth showing has *begun*, rather than running to the end.
      const ahead = timeline.passages.find(
        (passage) => passage.startSecond > state.cursor && passageShown(passage, mode),
      );
      if (ahead && cursor >= ahead.startSecond) {
        cursor = ahead.startSecond;
        skipping = false;
      }
    }
  }

  return { cursor, skipping, passage: passageAt(timeline, cursor) };
}

/** Begin skipping to the next thing worth watching. */
export function beginSkip(state: PlaybackCursor): PlaybackCursor {
  return { ...state, skipping: true };
}

/** Jump the cursor to a simulation second — a "skip ahead" or a scrub. */
export function seekTo(state: PlaybackCursor, second: number): PlaybackCursor {
  return { ...state, cursor: Math.max(0, second), skipping: false };
}

/** How long, in real seconds, a whole match would take to watch under a mode. */
export function estimatedWatchSeconds(timeline: MatchTimeline, mode: ViewingMode, speed = 1): number {
  let total = 0;
  for (const passage of timeline.passages) {
    const length = Math.max(1, passage.endSecond - passage.startSecond);
    total += length * realSecondsPerSimSecond(passage, mode, speed);
  }
  return total;
}
