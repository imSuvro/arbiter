import { defineConfig } from 'vitest/config';

const serviceBacked = Boolean(process.env.MONGODB_URI);

export default defineConfig({
  test: {
    coverage: {
      ...(serviceBacked
        ? { thresholds: { branches: 85, functions: 70, lines: 80, statements: 80 } }
        : {}),
    },
  },
});
