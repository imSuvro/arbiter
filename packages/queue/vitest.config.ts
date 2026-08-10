import { defineConfig } from 'vitest/config';

const serviceBacked = Boolean(process.env.SQS_ENDPOINT);

export default defineConfig({
  test: {
    coverage: {
      ...(serviceBacked
        ? { thresholds: { branches: 60, functions: 85, lines: 90, statements: 90 } }
        : {}),
    },
  },
});
