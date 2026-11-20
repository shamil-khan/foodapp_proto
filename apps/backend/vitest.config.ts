import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/smoke/**/*.smoke.test.ts',
    ],
    environment: 'node',
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    reporters: [
      'verbose',
    ],
  },
});
