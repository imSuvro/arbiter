import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
  },
});
