import { defineConfig } from 'vitest/config';

import { baseTestConfig } from './vitest.shared.mts';

/**
 * Unit tests: no database, no network.
 *
 * The integration suite is excluded here rather than on the command line —
 * a glob passed as a CLI argument is expanded by the shell before Vitest sees
 * it, which silently turns extra matches into positional filters.
 */
export default defineConfig({
  ...baseTestConfig,
  test: {
    ...baseTestConfig.test,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
  },
});
