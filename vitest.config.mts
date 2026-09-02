import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Values the server env schema requires. No real credentials: tests never
    // reach the network.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-abcdef',
      DATAFORSEO_LOGIN: '',
      DATAFORSEO_PASSWORD: '',
      SERP_CONCURRENCY: '3',
      MAX_KEYWORDS_PER_CHECK: '500',
      SERP_RESULTS: '100',
      SERP_CACHE_MINUTES: '30',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      // `server-only` throws on import outside a Server Component.
      'server-only': path.resolve(root, './tests/stubs/server-only.ts'),
    },
  },
});
