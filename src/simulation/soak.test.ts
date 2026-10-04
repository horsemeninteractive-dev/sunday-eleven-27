import { describe, expect, it } from 'vitest';
import { firstSnapshotDifference, runSoak, type SoakSnapshot } from './soak';

/**
 * The soak, in miniature.
 *
 * The full harness is deliberately outside the test suite. This is the smaller
 * check that goes with it: two seasons, from a fixed seed, with the invariants
 * the soak checks. It is the smoke alarm for the season loop, the layer that
 * single-fixture and single-season tests never exercise together — and it is
 * gated (see below) because a season on the new engine is minutes of football,
 * not seconds.
 *
 * The interesting failure it exists for is a season that will not close. One seed
 * bounced a single fixture through twenty-one rearrangements, ran five months
 * past its own calendar and never archived a champion — at which point the *next*
 * season is damaged too, because the world has stopped having seasons. `runSoak`
 * treats a season that outlives its limit as a failure, so a length check here is
 * a real assertion rather than a formality.
 *
 * Two seasons rather than one because the interesting state is the one that
 * crosses a boundary: ageing, retirements, top-ups, the calendar reset, the
 * honours and the archive. And two *runs* because the whole simulation promises
 * that the same seed is the same career.
 *
 * **It is gated, and skipped by default.** Now that every fixture runs on the
 * new engine a headless season is minutes rather than seconds, so this file
 * would otherwise block the whole suite every time it ran. It runs only when
 * asked for — by the `test:soak` script, or when `SOAK` is set:
 *
 *     npm run test:soak
 *     SOAK=1 npx vitest run src/simulation/soak.test.ts
 *
 * The `npm_lifecycle_event` check is what makes `npm run test:soak` work
 * without `SOAK=… ` shell syntax, which is not portable to a Windows shell.
 * Unset, the suite stays fast and the season loop is still covered by the
 * one-fixture and one-season tests; set, this is the same deliberate check it
 * always was, on demand.
 */

const SOAK_ENABLED = Boolean(process.env.SOAK) || process.env.npm_lifecycle_event === 'test:soak';
const SEASONS = 2;
const RUN_TIMEOUT = 120_000;

/** A run's snapshots with the one field that is a clock rather than the world removed. */
function comparable(snapshots: readonly SoakSnapshot[]): SoakSnapshot[] {
  return snapshots.map((snapshot) => ({ ...snapshot, seconds: 0 }));
}

describe.skipIf(!SOAK_ENABLED)('multi-season soak', () => {
  it(
    'plays two seasons from a fixed seed and the world holds up',
    () => {
      const result = runSoak({ seed: 'soak-smoke', seasons: SEASONS });

      // Both seasons closed: a snapshot is only taken at the moment a season ends.
      expect(result.snapshots).toHaveLength(SEASONS);
      expect(result.snapshots[0]!.seasonId).not.toBe(result.snapshots[1]!.seasonId);

      // The clock only moves forward, and the second season is a year after the first.
      expect(result.snapshots[1]!.endDate > result.snapshots[0]!.endDate).toBe(true);

      // A season is a season, not a slow-motion decade.
      for (const snapshot of result.snapshots) {
        expect(snapshot.days).toBeLessThan(400);
      }

      // No squad has been eaten, and nobody is playing at fifty.
      for (const snapshot of result.snapshots) {
        expect(snapshot.squadMin).toBeGreaterThanOrEqual(20);
        expect(snapshot.ageMax).toBeLessThanOrEqual(42);
      }

      // The archive holds one record a season, and a champion was crowned.
      for (const snapshot of result.snapshots) {
        expect(snapshot.seasonRecordsMax).toBeGreaterThanOrEqual(1);
      }

      const failures = result.violations.filter((item) => item.severity === 'fail');
      expect(
        failures.map((item) => `${item.invariant}: ${item.detail}`),
      ).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  it(
    'the same seed is the same career',
    () => {
      const first = runSoak({ seed: 'soak-determinism', seasons: 1 });
      const second = runSoak({ seed: 'soak-determinism', seasons: 1 });

      // Two independent runs of the same seed have to agree to the last decimal.
      // Wall-clock seconds are the one thing that cannot, so they are zeroed
      // before the comparison.
      expect(firstSnapshotDifference(comparable(first.snapshots), comparable(second.snapshots))).toBeNull();
    },
    RUN_TIMEOUT,
  );
});
