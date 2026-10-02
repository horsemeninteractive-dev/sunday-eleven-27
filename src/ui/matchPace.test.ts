import { describe, expect, it } from 'vitest';
import { SPATIAL_SECONDS_PER_MINUTE } from '@/simulation/match/spatial';
import { MATCH_SPEED_LABEL, MATCH_SPEEDS } from '@/state/preferences';
import { BASE_MINUTE_MS, matchMinuteMs, spatialSecondsPerRealSecond } from './matchPace';

/**
 * How fast a match is watched.
 *
 * A match at 1x has to be followable — that is the whole point of a speed called
 * "normal" — and the only way to be sure of that is to make the pitch run at true
 * speed. These pin the property rather than the number: at 1x, one real second
 * buys exactly one second of football, and every other setting is a division of
 * the same minute rather than a different one.
 */

describe('match pace', () => {
  it('plays the pitch at true speed at 1x', () => {
    expect(spatialSecondsPerRealSecond(1)).toBe(1);
    expect(matchMinuteMs(1)).toBe(BASE_MINUTE_MS);
    expect(BASE_MINUTE_MS).toBe(SPATIAL_SECONDS_PER_MINUTE * 1000);
  });

  it('compresses the same minute rather than changing it above 1x', () => {
    for (const speed of MATCH_SPEEDS) {
      // The rate is the setting, exactly, so a match is never watched at a pace
      // nobody asked for.
      expect(spatialSecondsPerRealSecond(speed)).toBe(speed);
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
    expect(spatialSecondsPerRealSecond(Number.NaN)).toBe(1);
  });
});
