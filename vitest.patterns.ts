/**
 * The slow half of the test suite, named once.
 *
 * `npm test` has to stay a fast check a person will actually run: the full
 * suite is minutes long, dominated by two things — the match engine's batches,
 * which simulate whole matches, and the season-loop suites, which play whole
 * seasons. Neither is a commit tax; both matter before a release or a
 * recalibration.
 *
 * The patterns live here so the two configs cannot drift: `vite.config.ts`
 * excludes them from the default run, and `vitest.slow.config.ts` includes
 * exactly them. A file is added to one list, not two.
 */
export const SLOW_TEST_PATTERNS = [
  // The match engine and its batches: whole matches, one after another.
  'src/simulation/match/**/*.test.ts',
  'src/simulation/fastMatch/**/*.test.ts',
  'src/presentation/matchEngine*.test.ts',

  // The season loop: the soak smoke test and every suite that plays one or
  // more full seasons (or enough weeks to be one in all but name).
  'src/simulation/soak.test.ts',
  'src/simulation/progression.test.ts',
  'src/simulation/training.test.ts',
  'src/simulation/recruitment.test.ts',
  'src/simulation/relationships.test.ts',
  'src/simulation/sponsorship.test.ts',
  'src/simulation/finance.audit.test.ts',
  'src/simulation/tables.test.ts',
  'src/simulation/preseason.test.ts',
  'src/simulation/managerProfile.test.ts',
  'src/simulation/engineMigration.test.ts',
  'src/simulation/forfeit.test.ts',
  'src/simulation/treasurer.test.ts',
  'src/simulation/communication/**/*.test.ts',

  // Long-running state and calendar suites.
  'src/state/gameStore.test.ts',
  'src/state/persistence.test.ts',
  'src/ui/inboxState.test.ts',
];
