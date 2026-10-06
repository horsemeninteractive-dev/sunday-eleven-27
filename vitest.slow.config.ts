import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { SLOW_TEST_PATTERNS } from './vitest.patterns';

/**
 * The slow suite, on demand.
 *
 * `npm run test:slow` runs exactly the files `npm test` leaves out — the engine
 * batches and the season-loop suites — so the slow set is still run the same
 * way, in CI-style, just not on every change. The patterns are shared with
 * `vite.config.ts` through `vitest.patterns.ts`, so the two halves cannot
 * disagree about which files belong to which.
 *
 * Deliberately its own config rather than a merged one: vitest concatenates
 * arrays on merge, so merging would union the two includes and run the whole
 * suite again.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: SLOW_TEST_PATTERNS,
    exclude: [...configDefaults.exclude],
  },
});
