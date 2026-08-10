import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/data/**', '**/dist/**', '**/*.config.ts', '**/*.d.ts'],
      thresholds: { branches: 70, functions: 95, lines: 95, statements: 95 },
    },
  },
});
