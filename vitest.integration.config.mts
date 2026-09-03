import { defineConfig } from 'vitest/config';

import { baseTestConfig } from './vitest.shared.mts';

/** Integration tests: these need a real PostgreSQL database. */
export default defineConfig({
  ...baseTestConfig,
  test: {
    ...baseTestConfig.test,
    include: ['tests/integration/**/*.test.ts'],
    // Every file shares one database, so they must not run at the same time.
    // Counts and cleanups that are correct in isolation become flaky when a
    // sibling file creates or deletes rows underneath them.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
