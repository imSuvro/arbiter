import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { EvaluationRun } from '@arbiter/contracts';
import { createApp } from '../src/app.js';
import { EvaluationEngine, DeterministicProvider } from '@arbiter/evaluator';
import { MemoryQueue } from '@arbiter/queue';
import { FilesystemSandboxRunner } from '@arbiter/sandbox';
import { InMemoryStore } from '@arbiter/storage';
import { ensureSeedData, seededTaskSpec } from '../src/seed.js';

describe('Arbiter API', () => {
  const config = {
    NODE_ENV: 'test' as const,
    API_PORT: 4000,
    WEB_ORIGIN: 'http://localhost:3000',
    MONGODB_DB_NAME: 'arbiter',
    SESSION_SECRET: 'test-session-secret-123456',
    ARBITER_OPERATOR_EMAIL: 'operator@arbiter.local',
    ARBITER_OPERATOR_PASSWORD: 'local-password-123',
    GOOGLE_GEMINI_MODEL: 'gemma-4-26b-a4b-it',
    QUEUE_BACKEND: 'memory' as const,
    AWS_REGION: 'ap-south-1',
    SANDBOX_BACKEND: 'local' as const,
    MAX_CONCURRENT_RUNS: 1,
  };
  let store: InMemoryStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    store = new InMemoryStore();
    await ensureSeedData(store, config.ARBITER_OPERATOR_EMAIL, config.ARBITER_OPERATOR_PASSWORD);
    const provider = new DeterministicProvider();
    const queue = new MemoryQueue();
    const engine = new EvaluationEngine(
      store,
      new FilesystemSandboxRunner({ backend: 'local', baseDir: 'data/test-sandboxes' }),
    );
    await queue.start(async (runId) => engine.process(runId, provider, 'test-worker'));
    app = createApp({ store, queue, engine, providers: [provider], config });
  });

  it('requires authentication for console data', async () => {
    const response = await request(app).get('/api/tasks');
    expect(response.status).toBe(401);
  });

  it('rejects a cross-origin mutation', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://attacker.example')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    expect(response.status).toBe(403);
  });

  it('serves health, readiness, model, session, and logout boundaries', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/ready')).body.status).toBe('ready');
    expect((await request(app).get('/api/auth/session')).status).toBe(401);

    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    expect((await agent.get('/api/auth/session')).body.authenticated).toBe(true);
    expect((await agent.get('/api/models')).body.models[0].id).toBe('deterministic');
    expect((await agent.get('/api/runs')).status).toBe(200);
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(204);
    expect((await agent.get('/api/auth/session')).status).toBe(401);
  });

  it('logs in and exposes the seeded task', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    expect(login.status).toBe(200);
    const tasks = await agent.get('/api/tasks');
    expect(tasks.status).toBe(200);
    expect(tasks.body.tasks[0].slug).toBe('normalize-webhook-events');
  });

  it('queues a run and returns a deterministic score after processing', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    const runResponse = await agent
      .post('/api/runs')
      .send({ taskId: 'task-normalize-webhook-events', modelProfileId: 'deterministic' });
    expect(runResponse.status).toBe(202);
    const runId = runResponse.body.run.id as string;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await agent.get(`/api/runs/${runId}`);
    expect(result.body.run.status).toBe('completed');
    expect(result.body.run.score).toBe(100);
  });

  it('replays a run for a repeated idempotency key', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    const headers = { 'Idempotency-Key': 'run-replay-2026-08-10' };
    const first = await agent
      .post('/api/runs')
      .set(headers)
      .send({ taskId: 'task-normalize-webhook-events', modelProfileId: 'deterministic' });
    const second = await agent
      .post('/api/runs')
      .set(headers)
      .send({ taskId: 'task-normalize-webhook-events', modelProfileId: 'deterministic' });

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.run.id).toBe(first.body.run.id);
  });

  it('rejects malformed idempotency keys', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    const response = await agent
      .post('/api/runs')
      .set('Idempotency-Key', 'bad key')
      .send({ taskId: 'task-normalize-webhook-events', modelProfileId: 'deterministic' });
    expect(response.status).toBe(400);
  });

  it('does not accept a bad password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: 'wrong-password' });
    expect(response.status).toBe(401);
  });

  it('validates task lifecycle and rejected run boundaries', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    const taskInput = {
      title: 'A custom webhook contract',
      slug: 'custom-webhook-contract',
      summary: 'A custom contract with a deterministic acceptance check.',
      instructions: 'Implement the contract and keep its behavior stable across retries.',
      starterFiles: { 'src/index.js': 'export const ready = true;' },
      verifierFiles: {
        'check.mjs': 'console.log(JSON.stringify({ status: "passed", score: 100 }));',
      },
      checks: [
        {
          id: 'acceptance',
          label: 'Acceptance',
          command: 'node /verifier/check.mjs',
          weight: 1,
          timeoutMs: 1_000,
        },
      ],
    };
    expect((await agent.post('/api/tasks').send({})).status).toBe(400);
    const created = await agent.post('/api/tasks').send(taskInput);
    expect(created.status).toBe(201);
    expect((await agent.post('/api/tasks').send(taskInput)).status).toBe(409);
    expect((await agent.get('/api/tasks/missing-task')).status).toBe(404);
    expect(
      (
        await agent
          .patch(`/api/tasks/${created.body.task.id}`)
          .send({ title: 'A revised webhook contract' })
      ).status,
    ).toBe(200);
    expect((await agent.patch('/api/tasks/missing-task').send({ title: 'Missing' })).status).toBe(
      404,
    );
    expect((await agent.post(`/api/tasks/${created.body.task.id}/versions`).send({})).status).toBe(
      400,
    );
    expect(
      (
        await agent.post(`/api/tasks/${created.body.task.id}/versions`).send({
          ...taskInput,
          slug: 'a-different-slug',
          toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
          limits: {
            maxTurns: 2,
            maxRuntimeMs: 10_000,
            memoryMb: 128,
            pids: 16,
            outputBytes: 10_000,
          },
        })
      ).status,
    ).toBe(409);
    const published = await agent.post(`/api/tasks/${created.body.task.id}/publish`).send({});
    expect(published.status).toBe(200);
    const versionId = published.body.version.id as string;
    expect((await agent.get(`/api/comparisons?taskVersionId=${versionId}`)).status).toBe(200);
    expect((await agent.get('/api/comparisons')).status).toBe(400);
    expect((await agent.post('/api/runs').send({})).status).toBe(400);
    expect(
      (
        await agent
          .post('/api/runs')
          .send({ taskId: created.body.task.id, modelProfileId: 'missing' })
      ).status,
    ).toBe(404);
    expect((await agent.get('/api/runs/missing-run')).status).toBe(404);
    expect((await agent.post('/api/runs/missing-run/cancel').send({})).status).toBe(404);
    expect((await agent.get('/api/runs/missing-run/events')).status).toBe(404);
    expect(
      (await agent.post(`/api/tasks/${created.body.task.id}/archive`).send({})).body.task.status,
    ).toBe('archived');
    expect(
      (
        await agent
          .post('/api/runs')
          .send({ taskId: created.body.task.id, modelProfileId: 'deterministic' })
      ).status,
    ).toBe(409);
  });

  it('creates a new task version and archives the task explicitly', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });

    const versionResponse = await agent
      .post('/api/tasks/task-normalize-webhook-events/versions')
      .send({ ...seededTaskSpec, title: 'Normalize webhook events, revision' });
    expect(versionResponse.status).toBe(201);
    expect(versionResponse.body.version.version).toBe(2);
    expect(versionResponse.body.version.publishedAt).toBeNull();

    const publishResponse = await agent
      .post('/api/tasks/task-normalize-webhook-events/publish')
      .send({});
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.task.currentVersionId).toBe(versionResponse.body.version.id);

    const archiveResponse = await agent
      .post('/api/tasks/task-normalize-webhook-events/archive')
      .send({});
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body.task.status).toBe('archived');
  });

  it('cancels a queued run and records the cancellation event', async () => {
    const task = await store.getTask('task-normalize-webhook-events');
    expect(task?.currentVersionId).toBeTruthy();
    const version = await store.getTaskVersion(task?.currentVersionId ?? '');
    expect(version).not.toBeNull();
    const run: EvaluationRun = {
      id: 'queued-cancellation-run',
      taskId: task?.id ?? '',
      taskVersionId: version?.id ?? '',
      taskVersionDigest: version?.digest ?? '',
      modelProfileId: 'deterministic',
      modelLabel: 'Deterministic fixture',
      status: 'queued',
      score: null,
      verifier: null,
      turnCount: 0,
      durationMs: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    await store.createRun(run);

    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: config.ARBITER_OPERATOR_EMAIL, password: config.ARBITER_OPERATOR_PASSWORD });
    const response = await agent.post(`/api/runs/${run.id}/cancel`).send({});

    expect(response.status).toBe(200);
    expect(response.body.run.status).toBe('cancelled');
    expect((await store.listEvents(run.id)).at(-1)?.type).toBe('evaluation.cancelled');
  });
});
