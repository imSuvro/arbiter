import { randomUUID } from 'node:crypto';
import {
  AgentActionSchema,
  calculateWeightedScore,
  type AgentTurnInput,
  type CheckStatus,
  type RunEvent,
  type VerifierCheckResult,
  type VerifierResult,
} from '@arbiter/contracts';
import type { Store } from '@arbiter/storage';
import type { SandboxRunner } from '@arbiter/sandbox';
import type { ModelProvider } from './provider.js';

function observationLimit(value: string): string {
  return value.length > 8_000 ? `${value.slice(0, 7_900)}\n...[observation truncated]` : value;
}

function parseVerifierOutput(
  stdout: string,
  check: { id: string; label: string; weight: number },
  exitCode: number,
  stderr: string,
): VerifierCheckResult {
  try {
    const parsed = JSON.parse(stdout.trim()) as Partial<VerifierResult> & {
      id?: string;
      status?: CheckStatus;
      score?: number;
      message?: string;
    };
    const nested = parsed.checks?.find((result) => result.id === check.id) ?? parsed.checks?.[0];
    if (nested) return { ...nested, id: check.id, label: check.label, weight: check.weight };
    if (parsed.status && typeof parsed.score === 'number') {
      return {
        id: check.id,
        label: check.label,
        status: parsed.status,
        score: parsed.score,
        weight: check.weight,
        message: parsed.message ?? '',
      };
    }
  } catch {
    // Non-JSON verifier output is converted into a deterministic error result below.
  }
  return {
    id: check.id,
    label: check.label,
    status: exitCode === 0 ? 'passed' : 'failed',
    score: exitCode === 0 ? 100 : 0,
    weight: check.weight,
    message: exitCode === 0 ? stderr || 'Verifier passed.' : stderr || 'Verifier command failed.',
  };
}

export class EvaluationEngine {
  public constructor(
    private readonly store: Store,
    private readonly sandboxRunner: SandboxRunner,
  ) {}

  public async process(runId: string, provider: ModelProvider, workerId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')
      return;
    const startedAt = run.startedAt ?? new Date().toISOString();
    await this.store.updateRun(runId, { status: 'running', startedAt });
    if (!run.startedAt) {
      await this.emit(
        runId,
        'evaluation.started',
        `Worker ${workerId} started the evaluation.`,
        {},
      );
    }
    const version = await this.store.getTaskVersion(run.taskVersionId);
    if (!version) return this.fail(runId, 'The referenced task version no longer exists.');

    let session: Awaited<ReturnType<SandboxRunner['create']>> | null = null;
    let turnCount = 0;
    let lastObservation = '';
    try {
      session = await this.sandboxRunner.create(version.spec);
      let finished = false;
      for (let turn = 0; turn < version.spec.limits.maxTurns && !finished; turn += 1) {
        const current = await this.store.getRun(runId);
        if (!current || current.status === 'cancelled') {
          await this.emit(runId, 'evaluation.cancelled', 'The evaluation was cancelled.', {});
          return;
        }
        const input: AgentTurnInput = {
          runId,
          task: version.spec,
          turn,
          workspaceTree: await session.listFiles(),
          lastObservation: lastObservation || undefined,
        };
        const output = await provider.runTurn(input);
        const action = AgentActionSchema.parse(output.action);
        const afterTurn = await this.store.getRun(runId);
        if (!afterTurn || afterTurn.status === 'cancelled') {
          await this.emit(runId, 'evaluation.cancelled', 'The evaluation was cancelled.', {});
          return;
        }
        turnCount = turn + 1;
        await this.emit(runId, 'agent.turn', output.publicMessage || `Agent turn ${turn + 1}.`, {
          turn: turn + 1,
          action: action.type,
          path: 'path' in action ? action.path : undefined,
        });
        if (action.type === 'read_file') {
          lastObservation = observationLimit(await session.readFile(action.path));
        } else if (action.type === 'write_file') {
          await session.writeFile(action.path, action.content);
          lastObservation = `Wrote ${action.path}.`;
        } else if (action.type === 'run_command') {
          const result = await session.runCommand(
            action.command,
            'candidate',
            version.spec.limits.maxRuntimeMs,
          );
          lastObservation = observationLimit(
            [`exitCode=${result.exitCode}`, result.stdout, result.stderr]
              .filter(Boolean)
              .join('\n'),
          );
          await this.emit(runId, 'sandbox.command', `Ran ${action.command}.`, {
            command: action.command,
            ...result,
          });
        } else {
          finished = true;
          lastObservation = action.message;
        }
      }

      const checks: VerifierCheckResult[] = [];
      for (const check of version.spec.checks) {
        const beforeCheck = await this.store.getRun(runId);
        if (!beforeCheck || beforeCheck.status === 'cancelled') {
          await this.emit(runId, 'evaluation.cancelled', 'The evaluation was cancelled.', {});
          return;
        }
        const result = await session.runCommand(check.command, 'verifier', check.timeoutMs);
        checks.push(parseVerifierOutput(result.stdout, check, result.exitCode, result.stderr));
      }
      const verifier: VerifierResult = {
        schemaVersion: 1,
        checks,
        totalScore: calculateWeightedScore(checks),
        passed: checks.every((check) => check.status === 'passed'),
      };
      await this.store.updateRun(runId, {
        status: 'completed',
        score: verifier.totalScore,
        verifier,
        turnCount,
        durationMs: Date.now() - Date.parse(startedAt),
        completedAt: new Date().toISOString(),
      });
      await this.emit(runId, 'verifier.completed', `Verifier score ${verifier.totalScore}.`, {
        verifier,
      });
      await this.emit(runId, 'evaluation.completed', 'Evaluation completed.', {
        score: verifier.totalScore,
      });
    } catch (error) {
      await this.fail(
        runId,
        error instanceof Error ? error.message : 'Evaluation failed.',
        turnCount,
        startedAt,
      );
    } finally {
      await session?.destroy();
    }
  }

  private async fail(
    runId: string,
    message: string,
    turnCount = 0,
    startedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.store.updateRun(runId, {
      status: 'failed',
      error: message,
      turnCount,
      durationMs: Date.now() - Date.parse(startedAt),
      completedAt: new Date().toISOString(),
    });
    await this.emit(runId, 'evaluation.failed', message, { error: message });
  }

  private async emit(
    runId: string,
    type: RunEvent['type'],
    message: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.store.appendEvent({ runId, type, message, data });
  }
}

export function makeEventDataId(): string {
  return randomUUID();
}
