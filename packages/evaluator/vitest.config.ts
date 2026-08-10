import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      thresholds: { branches: 90, functions: 95, lines: 95, statements: 95 },
    },
  },
});
