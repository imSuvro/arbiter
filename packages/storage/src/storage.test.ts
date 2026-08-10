import { describe, expect, it } from 'vitest';
import type { EvaluationRun, Task, TaskVersion } from '@arbiter/contracts';
import { InMemoryStore } from './index.js';

describe('InMemoryStore', () => {
  it('publishes a version without changing its immutable specification', async () => {
    const store = new InMemoryStore();
    const task: Task = {
      id: 'task-1',
      slug: 'task-one',
      title: 'Task one',
      summary: 'A deterministic task.',
      status: 'draft',
      currentVersionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const version: TaskVersion = {
      id: 'version-1',
      taskId: task.id,
      version: 1,
      spec: {
        title: task.title,
        slug: task.slug,
        summary: task.summary,
        instructions: 'Implement the task.',
        starterFiles: { 'src/index.js': 'export {};' },
        verifierFiles: { 'check.mjs': 'console.log("ok");' },
        toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
        limits: { maxTurns: 4, maxRuntimeMs: 30_000, memoryMb: 128, pids: 32, outputBytes: 10_000 },
        checks: [
          {
            id: 'check',
            label: 'Check',
            command: 'node /verifier/check.mjs',
            weight: 1,
            timeoutMs: 5_000,
          },
        ],
      },
      digest: 'digest-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      publishedAt: null,
    };

    await store.createTask(task);
    await store.createTaskVersion(version);
    const published = await store.updateTaskVersion(version.id, {
      publishedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(published?.spec).toEqual(version.spec);
    expect(published?.publishedAt).toBe('2026-01-02T00:00:00.000Z');
    expect((await store.getTaskVersion(version.id))?.digest).toBe('digest-1');
  });

  it('keeps event cursors ordered and compares completed runs by model', async () => {
    const store = new InMemoryStore();
    const base: EvaluationRun = {
      id: 'run-1',
      taskId: 'task-1',
      taskVersionId: 'version-1',
      taskVersionDigest: 'digest-1',
      modelProfileId: 'deterministic',
      modelLabel: 'Deterministic CI fixture',
      status: 'completed',
      score: 100,
      verifier: null,
      turnCount: 2,
      durationMs: 30,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:01.000Z',
      completedAt: '2026-01-01T00:00:02.000Z',
    };
    await store.createRun(base);
    await store.createRun({
      ...base,
      id: 'run-2',
      modelProfileId: 'other',
      modelLabel: 'Other model',
      score: 75,
    });
    await store.appendEvent({
      runId: base.id,
      type: 'evaluation.requested',
      message: 'Queued.',
      data: {},
    });
    await store.appendEvent({
      runId: base.id,
      type: 'evaluation.completed',
      message: 'Complete.',
      data: {},
    });

    expect((await store.listEvents(base.id))[1]?.sequence).toBe(2);
    expect((await store.listEvents(base.id, 1)).map((event) => event.type)).toEqual([
      'evaluation.completed',
    ]);
    expect((await store.compare('version-1')).map((row) => row.modelProfileId)).toEqual([
      'deterministic',
      'other',
    ]);
  });
});
