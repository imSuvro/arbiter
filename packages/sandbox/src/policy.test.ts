import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TaskSpec } from '@arbiter/contracts';
import { FilesystemSandboxRunner, isSafeWorkspacePath } from './index.js';

describe('sandbox path policy', () => {
  it('accepts normal relative workspace files', () => {
    expect(isSafeWorkspacePath('src/index.js')).toBe(true);
  });

  it('rejects traversal, absolute, and verifier paths', () => {
    expect(isSafeWorkspacePath('../secret')).toBe(false);
    expect(isSafeWorkspacePath('/etc/passwd')).toBe(false);
    expect(isSafeWorkspacePath('.arbiter-verifier/check.mjs')).toBe(false);
    expect(isSafeWorkspacePath('')).toBe(false);
    expect(isSafeWorkspacePath('C:/Windows/system32')).toBe(false);
    expect(isSafeWorkspacePath('src//index.js')).toBe(false);
    expect(isSafeWorkspacePath('src/\0index.js')).toBe(false);
  });

  it('creates an isolated local workspace and keeps verifier files separate', async () => {
    const spec: TaskSpec = {
      title: 'Sandbox exercise',
      slug: 'sandbox-exercise',
      summary: 'Exercise the local sandbox lifecycle in a controlled test.',
      instructions: 'Write a file and return a deterministic verifier result.',
      starterFiles: { 'src/index.js': 'export const ready = true;' },
      verifierFiles: {
        'check.mjs':
          "console.log(JSON.stringify({ status: 'passed', score: 100, message: 'ok' }));",
      },
      toolchain: { image: 'node:22-bookworm-slim', workdir: '/workspace' },
      limits: { maxTurns: 2, maxRuntimeMs: 10_000, memoryMb: 128, pids: 32, outputBytes: 100_000 },
      checks: [
        {
          id: 'check',
          label: 'Check',
          command: 'node /verifier/check.mjs',
          weight: 1,
          timeoutMs: 5_000,
        },
      ],
    };
    await expect(
      new FilesystemSandboxRunner({
        backend: 'local',
        baseDir: path.join(tmpdir(), 'arbiter-sandbox-disabled-tests'),
      }).create(spec),
    ).rejects.toThrow('disabled');

    const runner = new FilesystemSandboxRunner({
      backend: 'local',
      allowLocalBackend: true,
      baseDir: path.join(tmpdir(), 'arbiter-sandbox-policy-tests'),
    });
    const session = await runner.create(spec);
    expect(await session.listFiles()).toEqual(['src/index.js']);
    expect(await session.readFile('src/index.js')).toContain('ready');
    await session.writeFile('src/updated.js', 'export const updated = true;');
    expect(await session.listFiles()).toEqual(['src/index.js', 'src/updated.js']);

    const candidate = await session.runCommand('node -p 7');
    expect(candidate.exitCode).toBe(0);
    expect(candidate.stdout.trim()).toBe('7');
    const verifier = await session.runCommand('node /verifier/check.mjs', 'verifier');
    expect(verifier.exitCode).toBe(0);
    expect(verifier.stdout).toContain('passed');
    const failed = await session.runCommand('node -e process.exitCode=3');
    expect(failed.exitCode).toBe(3);

    await expect(session.readFile('../outside')).rejects.toThrow('Unsafe workspace path');
    await session.destroy();

    const dockerCalls: string[][] = [];
    const dockerRunner = new FilesystemSandboxRunner({
      backend: 'docker',
      baseDir: path.join(tmpdir(), 'arbiter-sandbox-docker-tests'),
      executeFile: async (file, args) => {
        dockerCalls.push([file, ...args]);
        return { stdout: 'x'.repeat(1_000), stderr: '' };
      },
    });
    const dockerSession = await dockerRunner.create({
      ...spec,
      limits: { ...spec.limits, outputBytes: 30 },
    });
    const dockerResult = await dockerSession.runCommand('node -p 7');
    expect(dockerResult.exitCode).toBe(0);
    expect(dockerResult.stdout).toContain('[output truncated]');
    const candidateDockerCall = dockerCalls[0] ?? [];
    expect(candidateDockerCall).toContain('--network');
    expect(candidateDockerCall).toContain('none');
    expect(candidateDockerCall.some((argument) => argument.includes('/verifier'))).toBe(false);
    expect(candidateDockerCall).not.toContain('ARBITER_VERIFIER_DIR=/verifier');
    const verifierDockerResult = await dockerSession.runCommand(
      'node /verifier/check.mjs',
      'verifier',
    );
    expect(verifierDockerResult.exitCode).toBe(0);
    const verifierDockerCall = dockerCalls[1] ?? [];
    expect(
      verifierDockerCall.some((argument) => argument.includes('target=/workspace,readonly')),
    ).toBe(true);
    expect(
      verifierDockerCall.some((argument) => argument.includes('target=/verifier,readonly')),
    ).toBe(true);
    expect(verifierDockerCall).toContain('ARBITER_VERIFIER_DIR=/verifier');
    expect(verifierDockerCall).toContain('/verifier');
    await dockerSession.destroy();

    const localEnvironments: NodeJS.ProcessEnv[] = [];
    const safeLocalRunner = new FilesystemSandboxRunner({
      backend: 'local',
      allowLocalBackend: true,
      baseDir: path.join(tmpdir(), 'arbiter-sandbox-local-env-tests'),
      executeFile: async (_file, _args, options) => {
        localEnvironments.push(options.env ?? {});
        return { stdout: '', stderr: '' };
      },
    });
    const safeLocalSession = await safeLocalRunner.create(spec);
    await safeLocalSession.runCommand('node -p 7');
    expect(localEnvironments[0]?.ARBITER_VERIFIER_DIR).toBeUndefined();
    expect(localEnvironments[0]?.GOOGLE_GEMINI_API_KEY).toBeUndefined();
    await safeLocalSession.destroy();

    const timeoutRunner = new FilesystemSandboxRunner({
      backend: 'docker',
      baseDir: path.join(tmpdir(), 'arbiter-sandbox-timeout-tests'),
      executeFile: async () => {
        const error = Object.assign(new Error('timed out'), {
          code: 'ETIMEDOUT',
          killed: true,
          stdout: 'partial',
          stderr: 'timeout',
        });
        throw error;
      },
    });
    const timeoutSession = await timeoutRunner.create(spec);
    const timeoutResult = await timeoutSession.runCommand('node -p 7');
    expect(timeoutResult.timedOut).toBe(true);
    expect(timeoutResult.stderr).toBe('timeout');
    await timeoutSession.destroy();
  });
});
