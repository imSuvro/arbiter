import { createHash, randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import {
  CreateRunInputSchema,
  CreateTaskInputSchema,
  TaskSpecSchema,
  type EvaluationRun,
  type Task,
  type TaskSpec,
  type TaskVersion,
} from '@arbiter/contracts';
import { getProvider, type EvaluationEngine, type ModelProvider } from '@arbiter/evaluator';
import type { Queue } from '@arbiter/queue';
import type { Store } from '@arbiter/storage';
import type { ApiConfig } from './config.js';
import {
  clearSessionCookie,
  createSession,
  requireAuth,
  setSessionCookie,
  tokenHash,
  verifyPassword,
} from './auth.js';

export interface ApiDependencies {
  store: Store;
  queue: Queue;
  engine: EvaluationEngine;
  providers: ModelProvider[];
  config: ApiConfig;
}

const TaskPatchSchema = CreateTaskInputSchema.pick({ title: true, summary: true }).partial();
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(256) });
const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

function problem(response: Response, status: number, title: string, detail?: string): void {
  response.status(status).json({
    type: `https://arbiter.dev/problems/${title.toLowerCase().replaceAll(' ', '-')}`,
    title,
    status,
    ...(detail ? { detail } : {}),
  });
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function originGuard(origin: string, requireOrigin: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const requestOrigin = request.headers.origin;
    if (!requestOrigin && requireOrigin) return problem(response, 403, 'Origin required');
    if (requestOrigin && requestOrigin !== origin) return problem(response, 403, 'Origin rejected');
    next();
  };
}

function rateLimiter() {
  const requests = new Map<string, { count: number; resetAt: number }>();
  return (request: Request, response: Response, next: NextFunction): void => {
    const key = request.ip || 'unknown';
    const now = Date.now();
    const existing = requests.get(key);
    if (!existing || existing.resetAt <= now) {
      requests.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    existing.count += 1;
    if (existing.count > 240) return problem(response, 429, 'Rate limit exceeded');
    next();
  };
}

function makeTaskVersion(
  taskId: string,
  versionNumber: number,
  spec: TaskSpec,
  publishedAt: string | null,
): TaskVersion {
  const createdAt = new Date().toISOString();
  const digest = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
  return { id: randomUUID(), taskId, version: versionNumber, spec, digest, createdAt, publishedAt };
}

export function createApp(dependencies: ApiDependencies): express.Express {
  const { store, queue, providers, config } = dependencies;
  const app = express();
  const secure = config.NODE_ENV === 'production';

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(rateLimiter());
  app.use(originGuard(config.WEB_ORIGIN, secure));

  app.get('/health', (_request, response) =>
    response.json({ status: 'ok', service: 'arbiter-api' }),
  );
  app.get(
    '/ready',
    asyncRoute(async (_request, response) => {
      const tasks = await store.listTasks();
      response.json({ status: 'ready', taskCount: tasks.length });
    }),
  );

  app.post(
    '/api/auth/login',
    asyncRoute(async (request, response) => {
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success) return problem(response, 400, 'Invalid login request');
      const operator = await store.findOperator(parsed.data.email.toLowerCase());
      if (!operator || !(await verifyPassword(parsed.data.password, operator.passwordHash)))
        return problem(response, 401, 'Invalid credentials');
      const token = await createSession(store, operator.id);
      setSessionCookie(response, token, secure);
      response.json({ authenticated: true, operator: { id: operator.id, email: operator.email } });
    }),
  );

  app.post(
    '/api/auth/logout',
    asyncRoute(async (request, response) => {
      const token = request.cookies?.arbiter_session as string | undefined;
      if (token) await store.deleteSession(tokenHash(token));
      clearSessionCookie(response, secure);
      response.status(204).end();
    }),
  );

  app.get('/api/auth/session', (request, response) => {
    void requireAuth(store, request, response, () =>
      response.json({ authenticated: true, operatorId: response.locals.operatorId }),
    );
  });

  const authenticated = (request: Request, response: Response, next: NextFunction): void => {
    void requireAuth(store, request, response, next);
  };

  app.get('/api/models', authenticated, (_request, response) =>
    response.json({ models: providers.map((provider) => provider.profile) }),
  );

  app.get(
    '/api/tasks',
    authenticated,
    asyncRoute(async (_request, response) => {
      response.json({ tasks: await store.listTasks() });
    }),
  );

  app.post(
    '/api/tasks',
    authenticated,
    asyncRoute(async (request, response) => {
      const parsed = CreateTaskInputSchema.safeParse(request.body);
      if (!parsed.success)
        return problem(
          response,
          400,
          'Invalid task',
          parsed.error.issues.map((issue) => issue.message).join('; '),
        );
      if (!parsed.data.starterFiles || !parsed.data.verifierFiles || !parsed.data.checks?.length)
        return problem(response, 400, 'Task requires executable files and checks');
      const existing = (await store.listTasks()).find((task) => task.slug === parsed.data.slug);
      if (existing) return problem(response, 409, 'Task slug already exists');
      const specResult = TaskSpecSchema.safeParse({
        ...parsed.data,
        starterFiles: parsed.data.starterFiles,
        verifierFiles: parsed.data.verifierFiles,
        toolchain: {
          image: 'node:22-bookworm-slim',
          workdir: '/workspace',
          ...parsed.data.toolchain,
        },
        limits: {
          maxTurns: 12,
          maxRuntimeMs: 120_000,
          memoryMb: 512,
          pids: 128,
          outputBytes: 500_000,
          ...parsed.data.limits,
        },
        checks: parsed.data.checks,
      });
      if (!specResult.success)
        return problem(
          response,
          400,
          'Invalid task specification',
          specResult.error.issues.map((issue) => issue.message).join('; '),
        );
      const taskId = randomUUID();
      const now = new Date().toISOString();
      const task: Task = {
        id: taskId,
        slug: specResult.data.slug,
        title: specResult.data.title,
        summary: specResult.data.summary,
        status: 'draft',
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      };
      const version = makeTaskVersion(taskId, 1, specResult.data, null);
      await store.createTask(task);
      await store.createTaskVersion(version);
      response.status(201).json({ task, version });
    }),
  );

  app.get(
    '/api/tasks/:taskId',
    authenticated,
    asyncRoute(async (request, response) => {
      const task = await store.getTask(routeParam(request, 'taskId'));
      if (!task) return problem(response, 404, 'Task not found');
      response.json({ task, versions: await store.listTaskVersions(task.id) });
    }),
  );

  app.patch(
    '/api/tasks/:taskId',
    authenticated,
    asyncRoute(async (request, response) => {
      const parsed = TaskPatchSchema.safeParse(request.body);
      if (!parsed.success) return problem(response, 400, 'Invalid task update');
      const task = await store.updateTask(routeParam(request, 'taskId'), parsed.data);
      if (!task) return problem(response, 404, 'Task not found');
      response.json({ task });
    }),
  );

  app.post(
    '/api/tasks/:taskId/versions',
    authenticated,
    asyncRoute(async (request, response) => {
      const task = await store.getTask(routeParam(request, 'taskId'));
      if (!task) return problem(response, 404, 'Task not found');
      if (task.status === 'archived')
        return problem(response, 409, 'Archived tasks cannot be edited');
      const parsed = TaskSpecSchema.safeParse(request.body);
      if (!parsed.success)
        return problem(
          response,
          400,
          'Invalid task version',
          parsed.error.issues.map((issue) => issue.message).join('; '),
        );
      if (parsed.data.slug !== task.slug)
        return problem(response, 409, 'Task slug cannot change after creation');
      const versions = await store.listTaskVersions(task.id);
      const version = makeTaskVersion(task.id, (versions[0]?.version ?? 0) + 1, parsed.data, null);
      await store.createTaskVersion(version);
      const updatedTask = await store.updateTask(task.id, {
        title: parsed.data.title,
        summary: parsed.data.summary,
      });
      response.status(201).json({ task: updatedTask, version });
    }),
  );

  app.post(
    '/api/tasks/:taskId/publish',
    authenticated,
    asyncRoute(async (request, response) => {
      const task = await store.getTask(routeParam(request, 'taskId'));
      if (!task) return problem(response, 404, 'Task not found');
      const latest = (await store.listTaskVersions(task.id))[0];
      if (!latest) return problem(response, 409, 'Task has no version');
      const publishedAt = new Date().toISOString();
      const version = await store.updateTaskVersion(latest.id, { publishedAt });
      if (!version) return problem(response, 404, 'Task version not found');
      const published = await store.updateTask(task.id, {
        status: 'published',
        currentVersionId: latest.id,
      });
      response.json({ task: published, version });
    }),
  );

  app.post(
    '/api/tasks/:taskId/archive',
    authenticated,
    asyncRoute(async (request, response) => {
      const task = await store.getTask(routeParam(request, 'taskId'));
      if (!task) return problem(response, 404, 'Task not found');
      const archived = await store.updateTask(task.id, { status: 'archived' });
      response.json({ task: archived });
    }),
  );

  app.post(
    '/api/runs',
    authenticated,
    asyncRoute(async (request, response) => {
      const parsed = CreateRunInputSchema.safeParse(request.body);
      if (!parsed.success) return problem(response, 400, 'Invalid run request');
      const rawIdempotencyKey = request.header('Idempotency-Key');
      const idempotencyResult = IdempotencyKeySchema.optional().safeParse(rawIdempotencyKey);
      if (!idempotencyResult.success) return problem(response, 400, 'Invalid idempotency key');
      const idempotencyKey = idempotencyResult.data;
      if (idempotencyKey) {
        const existing = (await store.listRuns(10_000)).find(
          (run) => run.idempotencyKey === idempotencyKey,
        );
        if (existing) return response.status(200).json({ run: existing, replayed: true });
      }
      const task = await store.getTask(parsed.data.taskId);
      if (!task || task.status !== 'published' || !task.currentVersionId)
        return problem(response, 409, 'Task must be published before running');
      const version = await store.getTaskVersion(task.currentVersionId);
      const provider = getProvider(providers, parsed.data.modelProfileId);
      if (!version || !provider) return problem(response, 404, 'Task version or model not found');
      const run: EvaluationRun = {
        id: randomUUID(),
        taskId: task.id,
        taskVersionId: version.id,
        taskVersionDigest: version.digest,
        modelProfileId: provider.profile.id,
        modelLabel: provider.profile.label,
        status: 'queued',
        score: null,
        verifier: null,
        turnCount: 0,
        durationMs: null,
        error: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        idempotencyKey,
      };
      await store.createRun(run);
      await store.appendEvent({
        runId: run.id,
        type: 'evaluation.requested',
        message: 'Evaluation queued.',
        data: { model: provider.profile.label, task: task.title },
      });
      await queue.enqueue(run.id);
      response.status(202).json({ run });
    }),
  );

  app.get(
    '/api/runs',
    authenticated,
    asyncRoute(async (_request, response) => {
      response.json({ runs: await store.listRuns(100) });
    }),
  );

  app.get(
    '/api/runs/:runId',
    authenticated,
    asyncRoute(async (request, response) => {
      const run = await store.getRun(routeParam(request, 'runId'));
      if (!run) return problem(response, 404, 'Run not found');
      response.json({ run, events: await store.listEvents(run.id) });
    }),
  );

  app.post(
    '/api/runs/:runId/cancel',
    authenticated,
    asyncRoute(async (request, response) => {
      const run = await store.getRun(routeParam(request, 'runId'));
      if (!run) return problem(response, 404, 'Run not found');
      if (!['queued', 'running'].includes(run.status)) return response.json({ run });
      const cancelled = await store.updateRun(run.id, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
      await store.appendEvent({
        runId: run.id,
        type: 'evaluation.cancelled',
        message: 'Evaluation cancelled by the operator.',
        data: {},
      });
      response.json({ run: cancelled });
    }),
  );

  app.get(
    '/api/runs/:runId/events',
    authenticated,
    asyncRoute(async (request, response) => {
      const run = await store.getRun(routeParam(request, 'runId'));
      if (!run) return problem(response, 404, 'Run not found');
      response.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      let after = Number(request.query.after ?? 0);
      const send = async (): Promise<void> => {
        const events = await store.listEvents(run.id, Number.isFinite(after) ? after : 0);
        for (const event of events) {
          response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
          after = event.sequence;
        }
        response.write(': keep-alive\n\n');
      };
      await send();
      const interval = setInterval(() => void send(), 700);
      request.on('close', () => clearInterval(interval));
    }),
  );

  app.get(
    '/api/comparisons',
    authenticated,
    asyncRoute(async (request, response) => {
      const taskVersionId =
        typeof request.query.taskVersionId === 'string' ? request.query.taskVersionId : '';
      if (!taskVersionId) return problem(response, 400, 'Task version is required');
      response.json({ rows: await store.compare(taskVersionId) });
    }),
  );

  app.use((_request, response) => problem(response, 404, 'Route not found'));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    response.status(500).json({
      type: 'https://arbiter.dev/problems/internal-error',
      title: 'Internal server error',
      status: 500,
      detail: config.NODE_ENV === 'production' ? undefined : message,
    });
  });
  return app;
}
