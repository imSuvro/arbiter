import { describe, expect, it } from 'vitest';
import type { AgentTurnInput, AgentTurnOutput, EvaluationRun, TaskSpec } from '@arbiter/contracts';
import type { SandboxRunner, SandboxSession } from '@arbiter/sandbox';
import { InMemoryStore } from '@arbiter/storage';
import { EvaluationEngine, makeEventDataId, type ModelProvider } from './index.js';

const spec: TaskSpec = {
  title: 'Deterministic unit task',
  slug: 'deterministic-unit-task',
  summary: 'A small task used to verify evaluator lifecycle behavior.',
  instructions:
    'Return the finish action and allow the protected verifier to score the workspace deterministically.',
  starterFiles: { 'src/index.js': 'export {};' },
  verifierFiles: { 'check.mjs': 'verifier' },
  toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
  limits: { maxTurns: 2, maxRuntimeMs: 10_000, memoryMb: 128, pids: 16, outputBytes: 10_000 },
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

function setup() {
  const store = new InMemoryStore();
  const now = new Date().toISOString();
  return { store, now };
}

function session(): SandboxSession {
  return {
    readFile: async () => '',
    writeFile: async () => undefined,
    listFiles: async () => ['src/index.js'],
    runCommand: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        id: 'acceptance',
        status: 'passed',
        score: 100,
        message: 'Accepted.',
      }),
      stderr: '',
      durationMs: 1,
      timedOut: false,
    }),
    destroy: async () => undefined,
  };
}

function provider(turn: (input: AgentTurnInput) => Promise<AgentTurnOutput>): ModelProvider {
  return {
    profile: {
      id: 'test-provider',
      label: 'Test provider',
      provider: 'test',
      model: 'fixture',
      available: true,
    },
    runTurn: turn,
  };
}

function runner(fakeSession: SandboxSession): SandboxRunner {
  return { create: async () => fakeSession };
}

class CancellationStore extends InMemoryStore {
  private reads = 0;

  public constructor(private readonly cancelAtRead: number) {
    super();
  }

  public override async getRun(runId: string) {
    this.reads += 1;
    if (this.reads === this.cancelAtRead) await super.updateRun(runId, { status: 'cancelled' });
    return super.getRun(runId);
  }
}

async function createRun(
  store: InMemoryStore,
  now: string,
  status: EvaluationRun['status'] = 'queued',
  taskSpec: TaskSpec = spec,
) {
  await store.createTask({
    id: 'task-1',
    slug: taskSpec.slug,
    title: taskSpec.title,
    summary: taskSpec.summary,
    status: 'published',
    currentVersionId: 'version-1',
    createdAt: now,
    updatedAt: now,
  });
  await store.createTaskVersion({
    id: 'version-1',
    taskId: 'task-1',
    version: 1,
    spec: taskSpec,
    digest: 'a'.repeat(64),
    createdAt: now,
    publishedAt: now,
  });
  await store.createRun({
    id: 'run-1',
    taskId: 'task-1',
    taskVersionId: 'version-1',
    taskVersionDigest: 'a'.repeat(64),
    modelProfileId: 'test-provider',
    modelLabel: 'Test provider',
    status,
    score: null,
    verifier: null,
    turnCount: 0,
    durationMs: null,
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  });
}

describe('EvaluationEngine', () => {
  it('records a completed deterministic verifier result', async () => {
    const { store, now } = setup();
    await createRun(store, now);
    const engine = new EvaluationEngine(store, runner(session()));
    await engine.process(
      'run-1',
      provider(async () => ({
        publicMessage: 'Done.',
        action: { type: 'finish', message: 'Done.' },
      })),
      'unit-worker',
    );
    const run = await store.getRun('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.score).toBe(100);
    expect((await store.listEvents('run-1')).map((event) => event.type)).toContain(
      'evaluation.completed',
    );
  });

  it('stops before verifier execution when a provider-triggered cancellation is observed', async () => {
    const { store, now } = setup();
    await createRun(store, now);
    let verifierCalls = 0;
    const guardedSession = session();
    guardedSession.runCommand = async () => {
      verifierCalls += 1;
      return { exitCode: 0, stdout: '{}', stderr: '', durationMs: 1, timedOut: false };
    };
    const engine = new EvaluationEngine(store, runner(guardedSession));
    await engine.process(
      'run-1',
      provider(async () => {
        await store.updateRun('run-1', { status: 'cancelled' });
        return { publicMessage: 'Cancelled.', action: { type: 'finish', message: 'Cancelled.' } };
      }),
      'unit-worker',
    );
    expect((await store.getRun('run-1'))?.status).toBe('cancelled');
    expect(verifierCalls).toBe(0);
  });

  it('executes every candidate action and normalizes fallback verifier output', async () => {
    const { store, now } = setup();
    const taskSpec: TaskSpec = {
      ...spec,
      limits: { ...spec.limits, maxTurns: 4 },
      checks: [
        ...spec.checks,
        {
          id: 'secondary',
          label: 'Secondary',
          command: 'node /verifier/secondary.mjs',
          weight: 2,
          timeoutMs: 1_000,
        },
      ],
    };
    await createRun(store, now, 'queued', taskSpec);
    const writes: string[] = [];
    const fakeSession = session();
    fakeSession.readFile = async () => 'r'.repeat(9_000);
    fakeSession.writeFile = async (filePath) => {
      writes.push(filePath);
    };
    fakeSession.runCommand = async (_command, role) =>
      role === 'candidate'
        ? { exitCode: 0, stdout: 'c'.repeat(9_000), stderr: '', durationMs: 1, timedOut: false }
        : {
            exitCode: 0,
            stdout: role === 'verifier' ? 'not-json' : '',
            stderr: '',
            durationMs: 1,
            timedOut: false,
          };
    let turn = 0;
    const actions = [
      { type: 'read_file' as const, path: 'src/index.js' },
      { type: 'write_file' as const, path: 'src/updated.js', content: 'updated' },
      { type: 'run_command' as const, command: 'node -p 7' },
      { type: 'finish' as const, message: 'Finished.' },
    ];
    const engine = new EvaluationEngine(store, runner(fakeSession));
    const nextAction = () => actions[Math.min(turn++, actions.length - 1)]!;
    await engine.process(
      'run-1',
      provider(async () => ({ publicMessage: '', action: nextAction() })),
      'unit-worker',
    );

    const run = await store.getRun('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.turnCount).toBe(4);
    expect(writes).toEqual(['src/updated.js']);
    expect(run?.verifier?.checks[0]?.status).toBe('passed');
    expect(run?.verifier?.checks[1]?.status).toBe('passed');
    expect(
      (await store.listEvents('run-1')).some((event) => event.type === 'sandbox.command'),
    ).toBe(true);
  });

  it('records provider and sandbox failures without losing the run audit trail', async () => {
    const { store, now } = setup();
    await createRun(store, now);
    const providerFailure = new EvaluationEngine(store, {
      create: async () => {
        throw new Error('sandbox image unavailable');
      },
    });
    await providerFailure.process(
      'run-1',
      provider(async () => ({ publicMessage: 'bad', action: { type: 'invalid' } as never })),
      'unit-worker',
    );
    const run = await store.getRun('run-1');
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('sandbox image unavailable');
    expect((await store.listEvents('run-1')).at(-1)?.type).toBe('evaluation.failed');

    const { store: invalidStore, now: invalidNow } = setup();
    await createRun(invalidStore, invalidNow);
    const invalidActionEngine = new EvaluationEngine(invalidStore, runner(session()));
    await invalidActionEngine.process(
      'run-1',
      provider(async () => ({ publicMessage: 'invalid', action: { type: 'unknown' } as never })),
      'unit-worker',
    );
    expect((await invalidStore.getRun('run-1'))?.status).toBe('failed');

    const { store: stringFailureStore, now: stringFailureNow } = setup();
    await createRun(stringFailureStore, stringFailureNow);
    const stringFailureEngine = new EvaluationEngine(stringFailureStore, runner(session()));
    await stringFailureEngine.process(
      'run-1',
      provider(async () => Promise.reject('non-error provider failure')),
      'unit-worker',
    );
    expect((await stringFailureStore.getRun('run-1'))?.error).toBe('Evaluation failed.');
  });

  it('ignores terminal runs before touching the provider or sandbox', async () => {
    const { store, now } = setup();
    await createRun(store, now, 'completed');
    let providerCalls = 0;
    const engine = new EvaluationEngine(store, {
      create: async () => {
        throw new Error('should not create a session');
      },
    });
    await engine.process(
      'run-1',
      provider(async () => {
        providerCalls += 1;
        return { publicMessage: 'done', action: { type: 'finish', message: 'done' } };
      }),
      'unit-worker',
    );
    expect(providerCalls).toBe(0);
  });

  it('observes cancellation before a turn and before verifier execution', async () => {
    const firstStore = new CancellationStore(2);
    const firstNow = new Date().toISOString();
    await createRun(firstStore, firstNow);
    const firstEngine = new EvaluationEngine(firstStore, runner(session()));
    await firstEngine.process(
      'run-1',
      provider(async () => ({
        publicMessage: 'never',
        action: { type: 'finish', message: 'never' },
      })),
      'unit-worker',
    );
    expect((await firstStore.getRun('run-1'))?.status).toBe('cancelled');

    const secondStore = new CancellationStore(4);
    const secondNow = new Date().toISOString();
    await createRun(secondStore, secondNow);
    let verifierCalls = 0;
    const guardedSession = session();
    guardedSession.runCommand = async () => {
      verifierCalls += 1;
      return { exitCode: 0, stdout: '{}', stderr: '', durationMs: 1, timedOut: false };
    };
    const secondEngine = new EvaluationEngine(secondStore, runner(guardedSession));
    await secondEngine.process(
      'run-1',
      provider(async () => ({
        publicMessage: 'done',
        action: { type: 'finish', message: 'done' },
      })),
      'unit-worker',
    );
    expect((await secondStore.getRun('run-1'))?.status).toBe('cancelled');
    expect(verifierCalls).toBe(0);
  });

  it('accepts structured verifier results and records failed checks deterministically', async () => {
    const { store, now } = setup();
    const taskSpec: TaskSpec = {
      ...spec,
      checks: [
        ...spec.checks,
        {
          id: 'secondary',
          label: 'Secondary',
          command: 'node /verifier/secondary.mjs',
          weight: 2,
          timeoutMs: 1_000,
        },
        {
          id: 'tertiary',
          label: 'Tertiary',
          command: 'node /verifier/tertiary.mjs',
          weight: 3,
          timeoutMs: 1_000,
        },
      ],
    };
    await createRun(store, now, 'queued', taskSpec);
    let verifierCall = 0;
    const structuredSession = session();
    structuredSession.runCommand = async (_command, role) => {
      if (role !== 'verifier')
        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
      verifierCall += 1;
      if (verifierCall === 1)
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            checks: [{ id: 'acceptance', status: 'passed', score: 100, message: 'Matched.' }],
          }),
          stderr: '',
          durationMs: 1,
          timedOut: false,
        };
      if (verifierCall === 2)
        return {
          exitCode: 0,
          stdout: JSON.stringify({ status: 'passed', score: 80 }),
          stderr: '',
          durationMs: 1,
          timedOut: false,
        };
      return { exitCode: 2, stdout: 'not-json', stderr: 'failed', durationMs: 1, timedOut: false };
    };
    const engine = new EvaluationEngine(store, runner(structuredSession));
    await engine.process(
      'run-1',
      provider(async () => ({
        publicMessage: 'done',
        action: { type: 'finish', message: 'done' },
      })),
      'unit-worker',
    );
    const run = await store.getRun('run-1');
    expect(run?.verifier?.checks.map((check) => check.status)).toEqual([
      'passed',
      'passed',
      'failed',
    ]);
    expect(run?.verifier?.passed).toBe(false);
  });

  it('fails a run whose immutable task version is missing', async () => {
    const { store, now } = setup();
    await store.createRun({
      id: 'missing-version-run',
      taskId: 'task-1',
      taskVersionId: 'missing-version',
      taskVersionDigest: 'c'.repeat(64),
      modelProfileId: 'test-provider',
      modelLabel: 'Test provider',
      status: 'queued',
      score: null,
      verifier: null,
      turnCount: 0,
      durationMs: null,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });
    const engine = new EvaluationEngine(store, runner(session()));
    await engine.process(
      'missing-version-run',
      provider(async () => ({
        publicMessage: 'never',
        action: { type: 'finish', message: 'never' },
      })),
      'unit-worker',
    );
    expect((await store.getRun('missing-version-run'))?.status).toBe('failed');
  });

  it('creates trace identifiers for event metadata', () => {
    expect(makeEventDataId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
