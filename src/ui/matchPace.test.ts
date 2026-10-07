import { describe, expect, it } from 'vitest';
import { MATCH_SPEED_LABEL, MATCH_SPEEDS } from '@/state/preferences';
import { BASE_MINUTE_MS, SECONDS_PER_MINUTE, matchMinuteMs, matchSecondsPerRealSecond } from './matchPace';

/**
 * How fast a match is watched.
 *
 * The pitch clock is the engine's own clock — one second of it is one second of
 * football — so watching it at true speed would take ninety real minutes.
 * `BASE_MINUTE_MS` is the compression that makes it followable: at 1x a minute of
 * football is watched over a few seconds, and every other setting divides that
 * same minute rather than changing it. These pin the property rather than the
 * number: whatever the base is, a whole match minute is exactly one base long at
 * 1x, the pitch covers the whole minute in that time, and faster settings only
 * ever spend less real time on the same football.
 */

describe('match pace', () => {
  it('watches a whole minute at 1x, and covers the whole pitch in it', () => {
    expect(matchMinuteMs(1)).toBe(BASE_MINUTE_MS);
    // At 1x, one minute of watching is worth exactly one minute of football.
    expect(matchSecondsPerRealSecond(1)).toBe((SECONDS_PER_MINUTE * 1000) / BASE_MINUTE_MS);
    // And that is more than true speed: the match is compressed, not stretched.
    expect(matchSecondsPerRealSecond(1)).toBeGreaterThan(1);
  });

  it('compresses the same minute rather than changing it above 1x', () => {
    const atOne = matchSecondsPerRealSecond(1);
    for (const speed of MATCH_SPEEDS) {
      // The rate is the setting times the base, exactly, so a match is never
      // watched at a pace nobody asked for.
      expect(matchSecondsPerRealSecond(speed)).toBe(atOne * speed);
      // And every speed is the base minute divided, never anything else.
      expect(matchMinuteMs(speed)).toBe(BASE_MINUTE_MS / speed);
    }
    // Faster is always less real time for the same minute of football.
    const minutes = MATCH_SPEEDS.map((speed) => matchMinuteMs(speed));
    for (let index = 1; index < minutes.length; index += 1) {
      expect(minutes[index]!).toBeLessThan(minutes[index - 1]!);
    }
  });

  it('gives every speed the controls offer a name, and survives rubbish', () => {
    for (const speed of MATCH_SPEEDS) expect(MATCH_SPEED_LABEL[speed]).toBeTruthy();
    // A speed that is not a number is watched as if it were the slowest, which
    // is the safe way to be wrong.
    expect(matchMinuteMs(0)).toBe(BASE_MINUTE_MS);
    expect(matchMinuteMs(Number.NaN)).toBe(BASE_MINUTE_MS);
    expect(matchSecondsPerRealSecond(Number.NaN)).toBe(matchSecondsPerRealSecond(1));
  });
});
