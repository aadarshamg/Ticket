import { defineConfig } from 'vitest/config';

// Integration tests: run against the real database, in the <DB_SCHEMA>_test schema.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    // All files share one schema, so they must not run at the same time.
    fileParallelism: false,
    // Generous: every query is a network round trip to the managed database.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
