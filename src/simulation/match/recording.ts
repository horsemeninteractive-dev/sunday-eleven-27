import type { Match } from '@/domain/match';
import type { MatchRecording, ReplayKeyframe } from '@/domain/matchRecording';
import type { PlayerId } from '@/domain/ids';
import type { MatchEngineState } from './matchEngine/types';

/**
 * Writing down the movement, while the match is on.
 *
 * A replay should show the afternoon that was watched, not a tidy version of it
 * drawn afterwards. That is only possible if the movement is kept as it happens,
 * so this samples the authoritative continuous state — where every player stands
 * and where the ball is — on its way past and stores the samples on the match.
 *
 * It is a *reader*. It never moves a player, aims a ball or changes possession;
 * it takes what the engine's step has already made true and writes it down.
 * Removing it entirely would not change a single result — the replay would
 * simply fall back to drawing the teams between the recorded moments, as it did
 * before.
 *
 * Recording is cheap and gated three ways: it only runs for a match whose engine
 * is observed (a match somebody is watching), it only samples every
 * {@link RECORD_INTERVAL_SECONDS} rather than every simulation step, and it
 * never keeps more than {@link MAX_KEYFRAMES} samples — thinning instead, so a
 * long match is remembered at a coarser resolution rather than forgotten at the
 * end.
 */

/** Football seconds between samples. A replay interpolates between them. */
export const RECORD_INTERVAL_SECONDS = 0.25;

/**
 * The most samples kept.
 *
 * A ninety-minute match is five thousand four hundred spatial seconds, so a
 * whole afternoon at this rate would be twenty-odd thousand samples — far more
 * than a save should carry for something only ever drawn on a small pitch. A
 * match that runs long is therefore thinned rather than truncated, and the
 * thinning keeps the *newest* samples whole (see {@link RECENT_SHARE}): the
 * movement the manager has just watched is always at full rate, and only the
 * past grows coarser. That is what makes a replay look as smooth as the match
 * did live, where a flat decimation would make the last minute as coarse as the
 * first.
 */
export const MAX_KEYFRAMES = 2000;

/**
 * The newest share of a recording that is never thinned.
 *
 * Thinning halves the older samples and leaves this tail untouched, so a
 * recording holds two densities — dense where it has just been, coarse where it
 * has been for a while — and the part most likely to be replayed stays sharp.
 */
const RECENT_SHARE = 0.25;

/** Pitch fractions are kept to four decimals — finer than a replay can show. */
const DECIMALS = 4;
const SCALE = 10 ** DECIMALS;

function round(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

/** One man who was on the pitch at a sample: who, and where. */
interface RecordedNode {
  playerId: PlayerId;
  x: number;
  y: number;
}

/** The recording on a match, created the first time a sample is taken. */
function ensureRecording(match: Match): MatchRecording {
  return (match.recording ??= {
    roster: [],
    interval: RECORD_INTERVAL_SECONDS,
    frames: [],
  });
}

/**
 * Write one sample.
 *
 * The recording is engine-agnostic: it stores positions, the ball and who is on
 * it, keyed by the football clock, so the replay that reads it back knows
 * nothing about how the afternoon was played.
 */
function writeKeyframe(
  recording: MatchRecording,
  clock: number,
  ballX: number,
  ballY: number,
  ballStatus: ReplayKeyframe['ballStatus'],
  ownerId: PlayerId | null,
  targetId: PlayerId | null,
  nodes: readonly RecordedNode[],
): void {
  const last = recording.frames[recording.frames.length - 1];
  if (last && clock - last.clock < recording.interval) return;

  // The roster only ever grows. A substitute is appended the moment he first
  // appears on the pitch, so a slot's index never moves and every earlier frame
  // — which stored fewer slots — is still read correctly against it.
  for (const node of nodes) {
    if (!recording.roster.includes(node.playerId)) recording.roster.push(node.playerId);
  }
  const index = new Map<PlayerId, number>();
  recording.roster.forEach((id, slot) => index.set(id, slot));

  // Flat positions, parallel to the roster: every slot starts off the pitch and
  // only the men actually out there are placed.
  const players = new Array<number>(recording.roster.length * 2).fill(-1);
  for (const node of nodes) {
    const slot = index.get(node.playerId);
    if (slot === undefined) continue;
    players[slot * 2] = round(node.x);
    players[slot * 2 + 1] = round(node.y);
  }

  const frame: ReplayKeyframe = {
    clock: round(clock),
    ballX: round(ballX),
    ballY: round(ballY),
    ballStatus,
    owner: ownerId ? (index.get(ownerId) ?? -1) : -1,
    target: targetId ? (index.get(targetId) ?? -1) : -1,
    players,
  };
  recording.frames.push(frame);

  if (recording.frames.length > MAX_KEYFRAMES) thin(recording);
}

/**
 * Take one sample of the engine's state.
 *
 * This is what a watched match records through: the engine calls it after every
 * fixed step (see `MatchEngine.observe`), so the afternoon is remembered at the
 * simulation's own cadence rather than at the screen's. The `clock` is football
 * seconds since kick-off — the same unit the replay and the events use — so the
 * recording lines up with the record exactly, whatever speed it was watched at.
 *
 * A sent-off man is not placed: he is off the pitch, and the replay must not
 * draw him standing on it. He stays on the roster, with no position in the later
 * frames, which is exactly how a man who has left the pitch should read.
 */
export function recordEngineKeyframe(match: Match, state: MatchEngineState): void {
  const nodes: RecordedNode[] = [];
  for (const player of state.players) {
    if (player.sentOff) continue;
    nodes.push({ playerId: player.playerId, x: player.x, y: player.y });
  }
  const ball = state.ball;
  writeKeyframe(
    ensureRecording(match),
    state.clock,
    ball.x,
    ball.y,
    ball.status,
    ball.ownerId,
    ball.targetId,
    nodes,
  );
}

/**
 * Halve the resolution of the older part, keeping the whole match.
 *
 * Throwing away the tail would lose the ending — the one part of an afternoon
 * worth keeping most — so nothing recent is ever dropped. Only the samples older
 * than the newest {@link RECENT_SHARE} are decimated, which halves the past
 * while the movement the manager has just watched stays at the rate it was
 * sampled at. The whole match is kept, read more coarsely the further back it
 * goes.
 *
 * `interval` is the floor on the gap between samples, not the gap itself, so it
 * does not change: the newest movement is still sampled at the pace the match
 * was watched at.
 */
function thin(recording: MatchRecording): void {
  const frames = recording.frames;
  const recentCount = Math.max(1, Math.floor(frames.length * RECENT_SHARE));
  const olderCount = frames.length - recentCount;
  const kept: ReplayKeyframe[] = [];
  for (let i = 0; i < olderCount; i += 2) kept.push(frames[i]!);
  for (let i = olderCount; i < frames.length; i += 1) kept.push(frames[i]!);
  recording.frames = kept;
}
