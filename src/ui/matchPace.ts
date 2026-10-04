
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
 * The simulation's clock is now real match seconds — one spatial second is one
 * second of football — so watched at *true speed* a match would take ninety
 * minutes, exactly as it does on a Sunday morning. Nobody is going to watch that
 * on a screen, so the speed controls compress it: `MINUTE_MS_AT_ONE_X` is how
 * long sixty seconds of football is given on screen, and it is the pace a minute
 * has always been watched at. The compression is therefore ten-to-one — six
 * seconds of watching to a minute of football — and the multipliers above 1x
 * divide that further.
 *
 * The engine is handed exactly the same football at every speed. Only the rate
 * the clock is spent at changes, so nothing about the football can depend on it.
 */
const MINUTE_MS_AT_ONE_X = 6000;
export const BASE_MINUTE_MS = MINUTE_MS_AT_ONE_X;

/** Football seconds to a match minute. The engine's clock is real seconds. */
const SECONDS_PER_MINUTE = 60;

/** How long one match minute lasts on screen, in milliseconds, at this speed. */
export function matchMinuteMs(speed: number): number {
  const multiplier = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return BASE_MINUTE_MS / multiplier;
}

/**
 * How much match movement one real second is worth at this speed.
 *
 * At 1x a minute of football is watched over a few seconds, so one real second
 * carries several seconds of football — that compression is what makes a match
 * followable — and the speed multipliers push it higher still. Expressed as the
 * ratio rather than as the multiplier so it
 * always agrees with {@link matchMinuteMs}: change the base and the pitch changes
 * with it, instead of the two drifting apart.
 */
export function spatialSecondsPerRealSecond(speed: number): number {
  return (SECONDS_PER_MINUTE * 1000) / matchMinuteMs(speed);
}
