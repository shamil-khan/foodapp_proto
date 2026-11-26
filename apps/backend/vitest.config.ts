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
    coverage: {
      provider: 'v8',
      reporter: [
        'text',
        'text-summary',
        'html',
      ],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.ts',
      ],
      exclude: [
        'src/index.ts',
        'src/**/mocks/**',
        'src/**/*-events.ts',
        'src/**/*-port.ts',
        // have to removed them
        'src/**/*-schemas.ts',
        'src/core/application/scoped-factory.ts',
        'src/core/domain/domain-event.ts',
        'src/core/domain/memento.ts',
        'src/core/patterns/visitor.ts',
        'src/iam/domain/auth-actor.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 60, // 75,
        statements: 80,
      },
    },
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
