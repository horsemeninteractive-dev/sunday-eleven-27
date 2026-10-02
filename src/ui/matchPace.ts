import { SPATIAL_SECONDS_PER_MINUTE } from '@/simulation/match/spatial';

/**
 * How fast a match is watched.
 *
 * This is presentation and only presentation: the football is decided a minute
 * at a time by the engine, and this says how much real time that minute is given
 * on the way past. It is kept here, out of the screens, because two of them need
 * the same answer — the clock that pumps the match and the commentary bar that
 * paces its lines against it — and because it is the one number that decides
 * whether an afternoon is followable.
 *
 * The base is deliberately `SPATIAL_SECONDS_PER_MINUTE`: a minute of football is
 * played out over six seconds of movement, so six seconds of real time for that
 * minute is the pace at which the pitch runs at true speed. A player's legs move
 * at the speed the simulation gives them, the ball is struck at the speed a ball
 * is struck, and the move can be watched rather than decoded. Turning the speed
 * up divides that same minute rather than changing it: the engine is handed
 * exactly the same football at 8x as at 1x.
 */
export const BASE_MINUTE_MS = SPATIAL_SECONDS_PER_MINUTE * 1000;

/** How long one match minute lasts on screen, in milliseconds, at this speed. */
export function matchMinuteMs(speed: number): number {
  const multiplier = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return BASE_MINUTE_MS / multiplier;
}

/**
 * How much match movement one real second is worth at this speed.
 *
 * At 1x it is exactly one. It is expressed as the ratio rather than as the
 * multiplier so that it always agrees with {@link matchMinuteMs}: change the base
 * and the pitch changes with it, instead of the two drifting apart.
 */
export function spatialSecondsPerRealSecond(speed: number): number {
  return (SPATIAL_SECONDS_PER_MINUTE * 1000) / matchMinuteMs(speed);
}
