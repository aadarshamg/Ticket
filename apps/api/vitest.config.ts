import { defineConfig } from 'vitest/config';

// Unit tests: no database needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
  },
});
