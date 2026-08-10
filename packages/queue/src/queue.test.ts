import { describe, expect, it } from 'vitest';
import { MemoryQueue } from './index.js';

describe('MemoryQueue', () => {
  it('delivers enqueued run IDs to its handler', async () => {
    const queue = new MemoryQueue();
    const received: string[] = [];
    await queue.start(async (runId) => {
      received.push(runId);
    });
    await queue.enqueue('run-1');
    await queue.enqueue('run-2');
    expect(received).toEqual(['run-1', 'run-2']);
  });
});
