import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['src/**/*.int.test.ts'],
    testTimeout: 120_000, // Testcontainers can take time on first pull
    hookTimeout: 120_000,
    sequence: {
      concurrent: false, // Integration tests run serially to avoid port conflicts
    },
  },
});
