import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import type { EvaluationRun, Task, TaskVersion } from '@arbiter/contracts';
import { MongoStore } from './index.js';

const uri = process.env.MONGODB_URI;

describe.skipIf(!uri)('MongoStore integration', () => {
  it('persists the operator, task, run, and event lifecycle', async () => {
    const databaseName = `arbiter_storage_${process.pid}_${Date.now()}`;
    const store = await MongoStore.connect(uri ?? '', databaseName);
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${Date.now()}`,
      slug: `storage-${Date.now()}`,
      title: 'Storage integration task',
      summary: 'A repository boundary task used by the integration suite.',
      status: 'draft',
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    const spec = {
      title: task.title,
      slug: task.slug,
      summary: task.summary,
      instructions: 'Persist this contract and prove its event lifecycle through MongoDB.',
      starterFiles: { 'src/index.js': 'export {};' },
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
    };
    const version: TaskVersion = {
      id: `version-${Date.now()}`,
      taskId: task.id,
      version: 1,
      spec,
      digest: 'b'.repeat(64),
      createdAt: now,
      publishedAt: null,
    };
    const run: EvaluationRun = {
      id: `run-${Date.now()}`,
      taskId: task.id,
      taskVersionId: version.id,
      taskVersionDigest: version.digest,
      modelProfileId: 'deterministic',
      modelLabel: 'Deterministic CI fixture',
      status: 'queued',
      score: null,
      verifier: null,
      turnCount: 0,
      durationMs: null,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      idempotencyKey: `storage-run-${Date.now()}`,
    };

    await store.ensureOperator({
      id: 'operator-1',
      email: 'mongo-operator@arbiter.local',
      passwordHash: 'hash',
      createdAt: now,
      lastLoginAt: null,
    });
    expect((await store.findOperator('mongo-operator@arbiter.local'))?.id).toBe('operator-1');
    await store.createSession({
      id: 'session-1',
      tokenHash: 'token-1',
      operatorId: 'operator-1',
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((await store.findSession('token-1'))?.operatorId).toBe('operator-1');
    await store.deleteSession('token-1');
    expect(await store.findSession('token-1')).toBeNull();

    await store.createTask(task);
    expect((await store.getTask(task.id))?.slug).toBe(task.slug);
    expect((await store.listTasks()).length).toBe(1);
    expect((await store.updateTask(task.id, { status: 'published' }))?.status).toBe('published');
    await store.createTaskVersion(version);
    expect((await store.listTaskVersions(task.id))[0]?.id).toBe(version.id);
    expect((await store.updateTaskVersion(version.id, { publishedAt: now }))?.publishedAt).toBe(
      now,
    );
    expect((await store.getTaskVersion(version.id))?.digest).toBe(version.digest);

    await store.createRun(run);
    expect((await store.getRun(run.id))?.idempotencyKey).toBe(run.idempotencyKey);
    expect((await store.listRuns()).length).toBe(1);
    expect((await store.claimQueuedRun('mongo-worker'))?.status).toBe('running');
    await store.appendEvent({
      runId: run.id,
      type: 'evaluation.requested',
      message: 'Queued.',
      data: {},
    });
    await store.appendEvent({
      runId: run.id,
      type: 'evaluation.completed',
      message: 'Complete.',
      data: {},
    });
    expect((await store.listEvents(run.id)).map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect((await store.listEvents(run.id, 1)).length).toBe(2);
    expect((await store.updateRun(run.id, { status: 'completed', score: 92 }))?.score).toBe(92);
    expect((await store.compare(version.id))[0]?.bestScore).toBe(92);

    await store.close();
    const cleanup = new MongoClient(uri ?? '');
    await cleanup.connect();
    await cleanup.db(databaseName).dropDatabase();
    await cleanup.close();
  });
});
