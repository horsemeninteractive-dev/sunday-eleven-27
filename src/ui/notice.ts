/**
 * How long a notice lingers before it takes itself away.
 *
 * A one-line confirmation does not need the same time as a digest of three
 * days, so the clock scales with the length of the sentence and is clamped
 * either end: long enough to read, short enough that a busy week does not leave
 * a bubble hanging about over the screen.
 */
export function noticeLifetime(text: string): number {
  return Math.min(11_000, Math.max(4_500, 2_800 + text.length * 45));
}
