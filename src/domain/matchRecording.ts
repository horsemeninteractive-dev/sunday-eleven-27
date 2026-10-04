import type { PlayerId } from './ids';
import type { BallStatus } from './matchState';

/**
 * The match, written down as it was watched.
 *
 * The replay already reads a match back from its record — the events, the
 * commentary — and lays the teams out from their formation between the moments
 * that were written down. That is a *reconstruction*: the football is exactly
 * what was played, but the movement between one recorded moment and the next is
 * drawn by the pitch rather than remembered.
 *
 * A recording removes the drawing. While a match is watched, the continuous
 * state is sampled on its way past — where every player stood and where the ball
 * was — and those samples are kept. A replay that finds one plays the real
 * movement back instead of inventing it.
 *
 * ```text
 *   watched match  ──►  MatchSpatial (authoritative, now)
 *                            │  sampled while it moves
 *                            ▼
 *                       MatchRecording  ──►  replay reads it back
 * ```
 *
 * This is presentation data and only presentation data. Nothing here decides
 * anything, nothing here feeds back into the football, and a recording can be
 * thrown away without changing a single result. It is the opposite of the
 * simulation: the simulation's job is to work out what happens, and this file's
 * job is only to remember where everyone was while it happened.
 */

/**
 * One instant of a watched match.
 *
 * Positions are stored flat and parallel to {@link MatchRecording.roster}: two
 * numbers per roster slot, `-1` for a slot that is not on the pitch (a substitute
 * who has not come on, or a man who has gone off). The array's length is however
 * long the roster was at the moment of the sample, so an older frame simply has
 * fewer slots to read — which is exactly right, because those players were not
 * out there yet.
 *
 * Everything is rounded to four decimals. A pitch fraction to 1e-4 is a
 * centimetre on a full-size pitch, far finer than anything a replay can see, and
 * rounding it is what keeps a whole afternoon's movement small enough to keep.
 */
export interface ReplayKeyframe {
  /** Spatial seconds of football since kick-off, at this sample. */
  clock: number;
  /** Where the ball was, in the fixed frame. */
  ballX: number;
  ballY: number;
  ballStatus: BallStatus;
  /** Roster slot of the ball's owner / target, or -1 for neither. */
  owner: number;
  target: number;
  /** Flat `[x0,y0,x1,y1,…]`, parallel to the roster prefix at this instant. */
  players: number[];
}

/**
 * A watched match's movement, remembered.
 *
 * The roster only ever grows: it begins as the twenty-two who start and a
 * substitute is appended the moment he comes on, so a slot's index never moves
 * and a keyframe can always be read against the roster as it was when it was
 * taken. `interval` is the shortest (spatial) seconds between samples — the rate
 * the newest movement was sampled at — and the gap between two older samples can
 * be wider, because thinning decimates the past and keeps the recent tail whole.
 * A reader must therefore never assume the samples are evenly spaced.
 */
export interface MatchRecording {
  /** Everyone who appeared, in the order their positions are stored. */
  roster: PlayerId[];
  /** Spatial seconds between the newest samples; the floor on any gap. */
  interval: number;
  /** The samples, in order, from kick-off to wherever the watching stopped. */
  frames: ReplayKeyframe[];
}

/** A recording read back at one instant, ready to be turned into a picture. */
export interface RecordedSample {
  /** The spatial clock the sample was taken at. */
  clock: number;
  ballX: number;
  ballY: number;
  ballStatus: BallStatus;
  owner: number;
  target: number;
  /** Interpolated flat `[x0,y0,…]`, parallel to the roster prefix. */
  players: number[];
}

function sampleOf(frame: ReplayKeyframe): RecordedSample {
  return {
    clock: frame.clock,
    ballX: frame.ballX,
    ballY: frame.ballY,
    ballStatus: frame.ballStatus,
    owner: frame.owner,
    target: frame.target,
    players: frame.players.slice(),
  };
}

/**
 * Read a recording at a given spatial clock, interpolating between samples.
 *
 * The recording is deliberately sparse — a few samples a second at its densest,
 * and less the further back it goes — so the movement between two of them is
 * worked out here, by a straight line from one to the next. The samples are not
 * evenly spaced (thinning decimates the past and keeps the recent tail whole),
 * so the bracket is found by clock and the blend uses the two real samples
 * around the instant. That is presentation, not simulation: it changes no state
 * and decides nothing, and it is what lets a small recording draw smoothly.
 *
 * A slot that is off the pitch in either neighbouring sample is not blended with
 * a real position: a man coming on is placed rather than slid in from the
 * touchline, and a man going off leaves rather than being dragged to the bench.
 * Null only when there is nothing recorded at all.
 */
export function sampleRecording(recording: MatchRecording, clock: number): RecordedSample | null {
  const { frames } = recording;
  if (frames.length === 0) return null;

  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (frames.length === 1 || clock <= first.clock) return sampleOf(first);
  if (clock >= last.clock) return sampleOf(last);

  // The two samples the instant falls between. The frames are in order, so the
  // bracket is found by halving rather than walking a whole afternoon.
  let low = 0;
  let high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (frames[mid]!.clock <= clock) low = mid;
    else high = mid;
  }
  const a = frames[low]!;
  const b = frames[high]!;
  const span = b.clock - a.clock;
  const t = span > 0 ? (clock - a.clock) / span : 0;

  // Read every slot either neighbour knows about, not just the shorter one. The
  // roster only grows, so a frame taken before a substitute came on simply has no
  // slot for him yet; truncating to the shorter frame would drop the man who came
  // on — and, at the same instant, the man he replaced, who is `-1` in the later
  // frame and so would be read as absent too. A missing slot is treated as
  // off the pitch, exactly as a `-1` is.
  const count = Math.max(a.players.length, b.players.length);
  const players: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const from = a.players[i] ?? -1;
    const to = b.players[i] ?? -1;
    // An off-pitch slot stays off the pitch; only two real positions are blended.
    players[i] = from < 0 || to < 0 ? (from < 0 ? to : from) : from + (to - from) * t;
  }

  // The discrete facts — who has it, whether it is travelling — are the nearest
  // sample's, not a blend of two: the ball is either at a man's feet or it is not.
  const nearer = t < 0.5 ? a : b;
  return {
    clock,
    ballX: a.ballX + (b.ballX - a.ballX) * t,
    ballY: a.ballY + (b.ballY - a.ballY) * t,
    ballStatus: nearer.ballStatus,
    owner: nearer.owner,
    target: nearer.target,
    players,
  };
}
