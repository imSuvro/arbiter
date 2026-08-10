import { createHash } from 'node:crypto';
import type { Task, TaskSpec, TaskVersion } from '@arbiter/contracts';
import type { OperatorRecord, Store } from '@arbiter/storage';
import { hashPassword } from './auth.js';

const starterNormalize = `export function normalizeWebhookEvent(event) {
  throw new Error('Implement normalizeWebhookEvent');
}

export function acceptWebhookEvent(event, seenKeys = new Set()) {
  throw new Error('Implement acceptWebhookEvent');
}
`;

const starterTest = `import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptWebhookEvent, normalizeWebhookEvent } from '../src/normalize.js';

test('normalizes provider and event identity', () => {
  const result = normalizeWebhookEvent({ provider: ' Stripe ', event_id: ' evt-7 ', type: ' PAYMENT ', timestamp: '2026-01-01T00:00:00Z' });
  assert.deepEqual(result, { key: 'stripe:evt-7', source: 'stripe', id: 'evt-7', type: 'payment', receivedAt: '2026-01-01T00:00:00Z' });
});

test('rejects a duplicate identity without mutating the event', () => {
  const seen = new Set();
  const first = acceptWebhookEvent({ source: 'Stripe', id: 'evt-7', type: 'payment', receivedAt: '2026-01-01T00:00:00Z' }, seen);
  const second = acceptWebhookEvent({ source: 'stripe', id: 'evt-7', type: 'payment', receivedAt: '2026-01-01T00:00:00Z' }, seen);
  assert.equal(first.accepted, true);
  assert.equal(second.duplicate, true);
});
`;

const verifier = [
  "import assert from 'node:assert/strict';",
  "import { pathToFileURL } from 'node:url';",
  "import path from 'node:path';",
  'const workspace = process.env.ARBITER_WORKSPACE ?? process.cwd();',
  "const module = await import(pathToFileURL(path.join(workspace, 'src', 'normalize.js')).href);",
  'const checks = [];',
  'try {',
  "  const normalized = module.normalizeWebhookEvent({ provider: ' Stripe ', event_id: ' evt-7 ', type: ' PAYMENT ', timestamp: '2026-01-01T00:00:00Z' });",
  "  assert.deepEqual(normalized, { key: 'stripe:evt-7', source: 'stripe', id: 'evt-7', type: 'payment', receivedAt: '2026-01-01T00:00:00Z' });",
  "  checks.push({ id: 'normalization', label: 'Canonical event identity', status: 'passed', score: 100, weight: 2, message: 'Provider, event ID, type, and timestamp are normalized.' });",
  '} catch (error) {',
  "  checks.push({ id: 'normalization', label: 'Canonical event identity', status: 'failed', score: 0, weight: 2, message: error instanceof Error ? error.message : 'Normalization failed.' });",
  '}',
  'try {',
  '  const seen = new Set();',
  "  const first = module.acceptWebhookEvent({ source: 'Stripe', id: 'evt-7', type: 'payment', receivedAt: '2026-01-01T00:00:00Z' }, seen);",
  "  const second = module.acceptWebhookEvent({ source: 'stripe', id: 'evt-7', type: 'payment', receivedAt: '2026-01-01T00:00:00Z' }, seen);",
  '  assert.equal(first.accepted, true);',
  '  assert.equal(second.duplicate, true);',
  "  checks.push({ id: 'idempotency', label: 'Duplicate protection', status: 'passed', score: 100, weight: 2, message: 'Repeated event identities are rejected after the first acceptance.' });",
  '} catch (error) {',
  "  checks.push({ id: 'idempotency', label: 'Duplicate protection', status: 'failed', score: 0, weight: 2, message: error instanceof Error ? error.message : 'Idempotency failed.' });",
  '}',
  'const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);',
  'const totalScore = checks.reduce((sum, check) => sum + check.score * check.weight, 0) / totalWeight;',
  "console.log(JSON.stringify({ schemaVersion: 1, checks, totalScore, passed: checks.every((check) => check.status === 'passed') }));",
].join('\n');

export const seededTaskSpec: TaskSpec = {
  title: 'Normalize webhook events',
  slug: 'normalize-webhook-events',
  summary: 'Build a canonical webhook normalizer with a duplicate guard for retry-safe ingestion.',
  instructions:
    'Implement normalizeWebhookEvent and acceptWebhookEvent in src/normalize.js. Normalize provider and event identity fields by trimming whitespace and lowercasing source and type. Accept id, event_id, or eventId as the identity field. Accept receivedAt, received_at, or timestamp as the timestamp field. Reject payloads without an identity or timestamp. The duplicate guard must return accepted=true for a new identity, then return duplicate=true for the same canonical identity without adding a second entry.',
  starterFiles: {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
    'src/normalize.js': starterNormalize,
    'test/normalize.test.js': starterTest,
  },
  verifierFiles: { 'check.mjs': verifier },
  toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
  limits: { maxTurns: 8, maxRuntimeMs: 120_000, memoryMb: 512, pids: 128, outputBytes: 500_000 },
  checks: [
    {
      id: 'normalization',
      label: 'Canonical event identity',
      command: 'node /verifier/check.mjs',
      weight: 2,
      timeoutMs: 30_000,
    },
    {
      id: 'idempotency',
      label: 'Duplicate protection',
      command: 'node /verifier/check.mjs',
      weight: 2,
      timeoutMs: 30_000,
    },
  ],
};

export async function ensureSeedData(store: Store, email: string, password: string): Promise<void> {
  const existingOperator = await store.findOperator(email);
  if (!existingOperator) {
    const operator: OperatorRecord = {
      id: 'operator-primary',
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    await store.ensureOperator(operator);
  }
  const tasks = await store.listTasks();
  if (tasks.some((task) => task.slug === seededTaskSpec.slug)) return;
  const taskId = 'task-normalize-webhook-events';
  const versionId = 'version-normalize-webhook-events-1';
  const now = new Date().toISOString();
  const task: Task = {
    id: taskId,
    slug: seededTaskSpec.slug,
    title: seededTaskSpec.title,
    summary: seededTaskSpec.summary,
    status: 'published',
    currentVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  };
  const digest = createHash('sha256').update(JSON.stringify(seededTaskSpec)).digest('hex');
  const version: TaskVersion = {
    id: versionId,
    taskId,
    version: 1,
    spec: seededTaskSpec,
    digest,
    createdAt: now,
    publishedAt: now,
  };
  await store.createTask(task);
  await store.createTaskVersion(version);
}
