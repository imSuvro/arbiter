import { describe, expect, it } from 'vitest';
import type { Task, TaskVersion } from '@arbiter/contracts';
import { MongoStore } from '@arbiter/storage';

const uri = process.env.MONGODB_URI;

describe.skipIf(!uri)('MongoStore', () => {
  it('persists version, event, and run state through MongoDB', async () => {
    const store = await MongoStore.connect(uri ?? '', `arbiter_ci_${process.pid}`);
    const task: Task = {
      id: `task-${Date.now()}`,
      slug: `mongo-${Date.now()}`,
      title: 'Mongo integration task',
      summary: 'A persisted task for the integration boundary.',
      status: 'draft',
      currentVersionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const version: TaskVersion = {
      id: `version-${Date.now()}`,
      taskId: task.id,
      version: 1,
      spec: {
        title: task.title,
        slug: task.slug,
        summary: task.summary,
        instructions: 'Persist this task through the MongoDB repository boundary.',
        starterFiles: {},
        verifierFiles: { 'check.mjs': 'console.log("ok")' },
        toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
        limits: { maxTurns: 2, maxRuntimeMs: 10_000, memoryMb: 128, pids: 16, outputBytes: 10_000 },
        checks: [
          {
            id: 'check',
            label: 'Check',
            command: 'node /verifier/check.mjs',
            weight: 1,
            timeoutMs: 3_000,
          },
        ],
      },
      digest: 'a'.repeat(64),
      createdAt: new Date().toISOString(),
      publishedAt: null,
    };
    await store.createTask(task);
    await store.createTaskVersion(version);
    await store.updateTaskVersion(version.id, { publishedAt: new Date().toISOString() });
    await store.appendEvent({
      runId: task.id,
      type: 'evaluation.requested',
      message: 'Queued.',
      data: {},
    });
    expect((await store.getTaskVersion(version.id))?.publishedAt).not.toBeNull();
    expect((await store.listEvents(task.id)).length).toBe(1);
    await store.close();
  });
});
