import { defineConfig } from 'vitest/config';

import { baseTestConfig } from './vitest.shared.mts';

/** Integration tests: these need a real PostgreSQL database. */
export default defineConfig({
  ...baseTestConfig,
  test: {
    ...baseTestConfig.test,
    include: ['tests/integration/**/*.test.ts'],
  },
});
