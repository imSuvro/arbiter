import { describe, expect, it, vi } from 'vitest';
import type { AgentTurnInput } from '@arbiter/contracts';
import {
  DeterministicProvider,
  GoogleGemmaProvider,
  createProviders,
  getProvider,
  taskSummary,
} from './provider.js';

function gemmaInput(runId = 'run-1'): AgentTurnInput {
  return {
    runId,
    turn: 0,
    workspaceTree: ['src/index.js'],
    task: {
      title: 'Gemma task',
      slug: 'gemma-task',
      summary: 'A summary that is long enough for the task contract.',
      instructions: 'Instructions that are long enough for the task contract to validate.',
      starterFiles: {},
      verifierFiles: {},
      toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
      limits: { maxTurns: 1, maxRuntimeMs: 1000, memoryMb: 64, pids: 8, outputBytes: 1000 },
      checks: [{ id: 'check', label: 'Check', command: 'true', weight: 1, timeoutMs: 1000 }],
    },
  };
}

function gemmaResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: '{"action":{"type":"finish","message":"Done"},"publicMessage":"Done"}' },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('DeterministicProvider', () => {
  it('produces a real implementation turn for the seeded task', async () => {
    const provider = new DeterministicProvider();
    const output = await provider.runTurn({
      runId: 'run-1',
      turn: 0,
      workspaceTree: ['src/normalize.js'],
      task: {
        title: 'Normalize webhook events',
        slug: 'normalize-webhook-events',
        summary: 'Make incoming webhook payloads stable and idempotent.',
        instructions: 'Implement a stable normalizer and a duplicate guard for webhook events.',
        starterFiles: {},
        verifierFiles: {},
        toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
        limits: {
          maxTurns: 5,
          maxRuntimeMs: 60_000,
          memoryMb: 256,
          pids: 64,
          outputBytes: 100_000,
        },
        checks: [
          {
            id: 'identity',
            label: 'Identity',
            command: 'node check.mjs',
            weight: 1,
            timeoutMs: 10_000,
          },
        ],
      },
    });
    expect(output.action.type).toBe('write_file');
    expect(
      (
        await provider.runTurn({
          runId: 'run-1',
          turn: 1,
          workspaceTree: ['src/normalize.js'],
          task: {
            title: 'Normalize webhook events',
            slug: 'normalize-webhook-events',
            summary: 'Make incoming webhook payloads stable and idempotent.',
            instructions: 'Implement a stable normalizer and a duplicate guard for webhook events.',
            starterFiles: {},
            verifierFiles: {},
            toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
            limits: {
              maxTurns: 5,
              maxRuntimeMs: 60_000,
              memoryMb: 256,
              pids: 64,
              outputBytes: 100_000,
            },
            checks: [],
          },
        })
      ).action.type,
    ).toBe('run_command');
    expect(
      (
        await provider.runTurn({
          runId: 'run-1',
          turn: 2,
          workspaceTree: [],
          task: {
            title: 'Normalize webhook events',
            slug: 'normalize-webhook-events',
            summary: 'Make incoming webhook payloads stable and idempotent.',
            instructions: 'Implement a stable normalizer and a duplicate guard for webhook events.',
            starterFiles: {},
            verifierFiles: {},
            toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
            limits: {
              maxTurns: 5,
              maxRuntimeMs: 60_000,
              memoryMb: 256,
              pids: 64,
              outputBytes: 100_000,
            },
            checks: [],
          },
        })
      ).action.type,
    ).toBe('finish');
  });

  it('selects providers without exposing an unconfigured hosted model', () => {
    const deterministicOnly = createProviders({});
    expect(deterministicOnly).toHaveLength(1);
    expect(getProvider(deterministicOnly, 'missing')).toBeNull();
    const configured = createProviders({ googleApiKey: 'test-key', googleModel: 'gemma-test' });
    expect(configured).toHaveLength(2);
    expect(getProvider(configured, 'google-gemma-4-26b-a4b')?.profile.model).toBe('gemma-test');
    expect(
      taskSummary({
        title: 'Example task',
        slug: 'example-task',
        summary: 'A summary that is long enough for the task contract.',
        instructions: 'Instructions that are long enough for the task contract to validate.',
        starterFiles: {},
        verifierFiles: {},
        toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
        limits: { maxTurns: 1, maxRuntimeMs: 1000, memoryMb: 64, pids: 8, outputBytes: 1000 },
        checks: [{ id: 'check', label: 'Check', command: 'true', weight: 1, timeoutMs: 1000 }],
      }),
    ).toContain('Example task');
  });

  it('normalizes a JSON response from the Gemma adapter', async () => {
    const responseBody = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '```json\n{"action":{"type":"finish","message":"Done"},"publicMessage":"Done"}\n```',
              },
            ],
          },
        },
      ],
    });
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(responseBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = new GoogleGemmaProvider('secret', 'gemma-test');
      const result = await provider.runTurn({
        runId: 'run-1',
        turn: 0,
        workspaceTree: ['src/index.js'],
        task: {
          title: 'Gemma task',
          slug: 'gemma-task',
          summary: 'A summary that is long enough for the task contract.',
          instructions: 'Instructions that are long enough for the task contract to validate.',
          starterFiles: {},
          verifierFiles: {},
          toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
          limits: { maxTurns: 1, maxRuntimeMs: 1000, memoryMb: 64, pids: 8, outputBytes: 1000 },
          checks: [{ id: 'check', label: 'Check', command: 'true', weight: 1, timeoutMs: 1000 }],
        },
        lastObservation: 'The previous command completed successfully.',
      });
      expect(result.action.type).toBe('finish');
      await provider.runTurn({
        runId: 'run-2',
        turn: 1,
        workspaceTree: [],
        task: {
          title: 'Gemma task',
          slug: 'gemma-task',
          summary: 'A summary that is long enough for the task contract.',
          instructions: 'Instructions that are long enough for the task contract to validate.',
          starterFiles: {},
          verifierFiles: {},
          toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
          limits: { maxTurns: 1, maxRuntimeMs: 1000, memoryMb: 64, pids: 8, outputBytes: 1000 },
          checks: [{ id: 'check', label: 'Check', command: 'true', weight: 1, timeoutMs: 1000 }],
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retries transient responses and bounds the hosted model output', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(gemmaResponse());
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = new GoogleGemmaProvider('secret', 'gemma-test');
      await expect(provider.runTurn(gemmaInput())).resolves.toMatchObject({
        action: { type: 'finish' },
      });
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(request.body)) as {
        generationConfig: { maxOutputTokens: number; thinkingConfig: { thinkingLevel: string } };
      };
      expect(body.generationConfig.maxOutputTokens).toBe(2048);
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
      expect(request.signal).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens a circuit after repeated permanent provider failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('invalid key', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = new GoogleGemmaProvider('secret', 'gemma-test');
      await expect(provider.runTurn(gemmaInput('run-1'))).rejects.toThrow('HTTP 400');
      await expect(provider.runTurn(gemmaInput('run-2'))).rejects.toThrow('HTTP 400');
      await expect(provider.runTurn(gemmaInput('run-3'))).rejects.toThrow('HTTP 400');
      await expect(provider.runTurn(gemmaInput('run-4'))).rejects.toThrow('circuit is open');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
