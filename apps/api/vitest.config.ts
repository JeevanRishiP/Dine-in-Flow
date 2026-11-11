import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'unit',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['src/**/*.int.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.module.ts', 'src/db/run-migrations.ts'],
      thresholds: {
        // Coverage gates per ARCH §26 — will be enforced once Phase 5+ modules are added
        lines: 80,
        functions: 80,
      },
    },
  },
});
