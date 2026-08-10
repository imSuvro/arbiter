import { describe, expect, it } from 'vitest';
import { AgentActionSchema, TaskSpecSchema, calculateWeightedScore } from '../src/index.js';

describe('contracts', () => {
  it('accepts a syntactically valid file action before sandbox policy checks', () => {
    expect(AgentActionSchema.safeParse({ type: 'read_file', path: 'src/index.js' }).success).toBe(
      true,
    );
  });

  it('accepts a complete task specification', () => {
    const result = TaskSpecSchema.safeParse({
      title: 'Normalize webhook events',
      slug: 'normalize-webhook-events',
      summary: 'Make incoming webhook payloads stable and idempotent.',
      instructions: 'Implement the normalizer and preserve the event identity across retries.',
      starterFiles: { 'src/index.js': 'export function normalize() {}' },
      verifierFiles: { 'check.mjs': 'console.log("ok")' },
      toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
      limits: { maxTurns: 6, maxRuntimeMs: 60_000, memoryMb: 256, pids: 64, outputBytes: 100_000 },
      checks: [
        {
          id: 'identity',
          label: 'Identity',
          command: 'node check.mjs',
          weight: 1,
          timeoutMs: 10_000,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('calculates a weighted score', () => {
    expect(
      calculateWeightedScore([
        { id: 'a', label: 'A', status: 'passed', score: 100, weight: 2, message: '' },
        { id: 'b', label: 'B', status: 'failed', score: 0, weight: 1, message: '' },
      ]),
    ).toBe(66.67);
    expect(calculateWeightedScore([])).toBe(0);
  });
});
