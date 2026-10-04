import type { Match } from '@/domain/match';
import type { MatchId } from '@/domain/ids';
import type { Side } from '@/domain/matchState';
import { signalOfEvent, type MatchSignal } from './matchSignals';

/**
 * Replaying a match from its own record.
 *
 * A finished match is not re-simulated to watch it again — that would be a
 * second simulation, and it might not even agree with the first. Instead the
 * replay *reads* what was already written down: the match's events, told in the
 * shared signal vocabulary, laid out against the clock they happened on.
 *
 * ```text
 *   stored record            replay                renderer
 *   ─────────────            ──────                ────────
 *   Match.events  ──►  cues + signals  ──►  MatchRenderState  ──►  the same
 *   Match.lineups      (a timeline)         (via a cursor)         2D pitch
 * ```
 *
 * The output is deliberately the same neutral shape the live match produces
 * (`MatchRenderState`, built in `matchPresentation`), so the replay goes through
 * *the same renderer contract*: the pitch cannot tell a replay from a match
 * happening now, and a future 3D renderer will replay it too without knowing it
 * is doing anything different.
 *
 * This is a reconstruction, not a recording. Only the discrete record survives a
 * match — a goal, a booking, a whistle, each with a minute and a place on the
 * pitch — so the replay follows the ball from one recorded moment to the next
 * and holds the teams in the shape the moment implies. The football is exactly
 * the football that was played; only the movement between moments is drawn.
 */

/** How long a recorded moment is held before the replay moves on. */
const CUE_SECONDS = 2.4;
/**
 * The longest stretch of a quiet match the replay will sit through.
 *
 * Nothing in the record for ten minutes is ten minutes of nothing to watch, so
 * the dead air between moments is capped: a replay is the match's story, not its
 * duration.
 */
const IDLE_CAP_SECONDS = 3 * 60;
/** Football seconds to a match minute, for a record that predates `second`. */
const SECONDS_PER_MINUTE = 60;

/** One recorded moment, placed on the replay's own clock. */
export interface ReplayCue {
  /** Its position in the record. */
  index: number;
  /** Replay seconds at which this moment is reached. */
  at: number;
  /** The football second since kick-off it happened on. */
  second: number;
  /** The match minute it belongs to. */
  minute: number;
  half: 1 | 2 | 3;
  /** Whether the minute is first-half, for the 45+ label. */
  firstHalf: boolean;
  /** Where on the pitch it happened, 0..1. */
  x: number;
  y: number;
  /** The moment, in the shared vocabulary. */
  signal: MatchSignal;
  /** The engine's own sentence for it, already written down. */
  text: string;
}

/** A finished match, ready to be watched back. */
export interface MatchReplay {
  matchId: MatchId;
  /** The whole replay's length, in replay seconds. */
  duration: number;
  /** Every recorded moment, in order. */
  cues: readonly ReplayCue[];
  /** Every moment as a signal, in order — the story, for a timeline. */
  signals: readonly MatchSignal[];
}

/** Where the replay is at a given instant. */
export interface ReplayFrame {
  /** The match minute being shown, fractional between moments. */
  minute: number;
  /** The football second since kick-off being shown, fractional between moments. */
  second: number;
  half: 1 | 2 | 3;
  firstHalf: boolean;
  /** The ball's place at this instant. */
  x: number;
  y: number;
  /** The moment just reached, or null before the first. */
  cue: ReplayCue | null;
  /** How many of the match's events have been reached. */
  revealed: number;
  /** How far between the last moment and the next one, 0..1. */
  progress: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sideOfEvent(match: Match, clubId: string | null): Side | null {
  if (clubId === null) return null;
  if (clubId === match.homeClubId) return 'home';
  if (clubId === match.awayClubId) return 'away';
  return null;
}

/**
 * Read a finished match into a replay script.
 *
 * Null when there is nothing to watch: a fixture that was never played, or one
 * with an empty record, has no afternoon to give back.
 */
export function buildReplay(match: Match): MatchReplay | null {
  if (match.events.length === 0) return null;

  // Which events belong to the first half is decided by the half-time whistle,
  // exactly as the feed decides it: the clock counts straight through, so 45
  // happens once as first-half stoppage and once as the second half.
  const halfTimeIndex = match.events.findIndex((event) => event.type === 'half-time');

  const cues: ReplayCue[] = [];
  const signals: MatchSignal[] = [];
  let clock = 0;
  let lastSecond = 0;

  match.events.forEach((event, index) => {
    // The clock is football seconds since kick-off, straight through the interval
    // — the same clock the engine records movement against, so the replay's own
    // minute finds the exact instant the football held. An older record without
    // a second falls back to the minute it does carry.
    const second = event.second ?? event.minute * SECONDS_PER_MINUTE;
    // Up to a point, time between moments is honoured; beyond it, it is skipped.
    const gap = clamp(second - lastSecond, 0, IDLE_CAP_SECONDS);
    clock += gap;
    lastSecond = second;

    const firstHalf = halfTimeIndex < 0 || index <= halfTimeIndex;
    const signal = signalOfEvent(event, sideOfEvent(match, event.clubId));
    signals.push(signal);
    cues.push({
      index,
      at: clock,
      second,
      minute: event.minute,
      half: event.minute <= 45 ? 1 : event.minute <= 90 ? 2 : 3,
      firstHalf,
      x: event.x,
      y: event.y,
      signal,
      text: event.text,
    });
    clock += CUE_SECONDS;
  });

  return { matchId: match.id, duration: clock, cues, signals };
}

/**
 * Where the replay is, at a given number of replay seconds.
 *
 * The ball travels from the last moment to the next one over the time between
 * them, so the picture moves continuously rather than jumping between events;
 * the clock moves with it. Nothing here reads ahead of the record — the moment
 * only becomes visible once its time has come.
 */
export function replayAt(replay: MatchReplay, seconds: number): ReplayFrame {
  const { cues } = replay;
  if (cues.length === 0) {
    return { minute: 0, second: 0, half: 1, firstHalf: true, x: 0.5, y: 0.5, cue: null, revealed: 0, progress: 0 };
  }

  const at = clamp(seconds, 0, replay.duration);

  // The last moment already reached. Everything up to here is revealed.
  let index = -1;
  for (let cursor = 0; cursor < cues.length; cursor += 1) {
    if (cues[cursor]!.at <= at) index = cursor;
    else break;
  }
  const revealed = index + 1;

  // The ball travels between the reached moment and the next one. Before the
  // first moment it sets off from the centre spot, the way a match does.
  const from = index >= 0 ? cues[index]! : null;
  const to = index + 1 < cues.length ? cues[index + 1]! : cues[index]!;
  const fromAt = from ? from.at : 0;
  const toAt = to.at > fromAt ? to.at : fromAt;
  const progress = toAt > fromAt ? clamp((at - fromAt) / (toAt - fromAt), 0, 1) : 1;

  const fromPoint = from ?? { x: 0.5, y: 0.5, minute: 0 };
  const fromMinute = from ? from.minute : 0;
  const minute = fromMinute + (to.minute - fromMinute) * progress;
  // The football second runs between the same two moments, so the recording is
  // read at the exact instant being drawn.
  const fromSecond = from ? from.second : 0;
  const second = fromSecond + (to.second - fromSecond) * progress;

  return {
    minute,
    second,
    // The half is the one the moment just reached belongs to; before the first
    // moment it is the half the match starts in.
    half: from ? from.half : to.half,
    firstHalf: from ? from.firstHalf : to.firstHalf,
    x: fromPoint.x + (to.x - fromPoint.x) * progress,
    y: fromPoint.y + (to.y - fromPoint.y) * progress,
    cue: from,
    revealed,
    progress,
  };
}
