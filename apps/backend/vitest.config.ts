import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
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
    projects: [
      {
        resolve: {
          alias: {
            '@': srcDir,
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'tests/unit/**/*.spec.ts',
          ],
        },
      },
      {
        resolve: {
          alias: {
            '@': srcDir,
          },
        },
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'tests/integration/**/*.int.spec.ts',
          ],
        },
      },
      {
        resolve: {
          alias: {
            '@': srcDir,
          },
        },
        test: {
          name: 'smoke',
          environment: 'node',
          include: [
            'tests/smoke/**/*.smoke.test.ts',
          ],
        },
      },
    ],
  },
});
