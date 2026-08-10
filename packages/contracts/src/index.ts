import { z } from 'zod';

export const TaskStatusSchema = z.enum(['draft', 'published', 'archived']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const RunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const CheckStatusSchema = z.enum(['passed', 'failed', 'error']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const FileMapSchema = z.record(z.string(), z.string());
export type FileMap = z.infer<typeof FileMapSchema>;

export const ToolchainSchema = z.object({
  image: z.string().min(1),
  workdir: z.string().default('/workspace'),
});
export type Toolchain = z.infer<typeof ToolchainSchema>;

export const LimitSchema = z.object({
  maxTurns: z.number().int().positive().max(100).default(12),
  maxRuntimeMs: z
    .number()
    .int()
    .positive()
    .max(15 * 60 * 1000)
    .default(120_000),
  memoryMb: z.number().int().positive().max(4096).default(512),
  pids: z.number().int().positive().max(512).default(128),
  outputBytes: z.number().int().positive().max(5_000_000).default(500_000),
});
export type EvaluationLimits = z.infer<typeof LimitSchema>;

export const VerifierCheckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  label: z.string().min(1).max(120),
  command: z.string().min(1).max(500),
  weight: z.number().positive().max(100),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
});
export type VerifierCheck = z.infer<typeof VerifierCheckSchema>;

export const TaskSpecSchema = z.object({
  title: z.string().min(3).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  summary: z.string().min(20).max(500),
  instructions: z.string().min(50).max(20_000),
  starterFiles: FileMapSchema,
  verifierFiles: FileMapSchema,
  toolchain: ToolchainSchema,
  limits: LimitSchema,
  checks: z.array(VerifierCheckSchema).min(1).max(20),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const CreateTaskInputSchema = TaskSpecSchema.pick({
  title: true,
  slug: true,
  summary: true,
  instructions: true,
}).extend({
  starterFiles: FileMapSchema.optional(),
  verifierFiles: FileMapSchema.optional(),
  toolchain: ToolchainSchema.partial().optional(),
  limits: LimitSchema.partial().optional(),
  checks: z.array(VerifierCheckSchema).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read_file'), path: z.string().min(1).max(240) }),
  z.object({
    type: z.literal('write_file'),
    path: z.string().min(1).max(240),
    content: z.string().max(500_000),
  }),
  z.object({ type: z.literal('run_command'), command: z.string().min(1).max(500) }),
  z.object({ type: z.literal('finish'), message: z.string().min(1).max(500) }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const AgentTurnInputSchema = z.object({
  runId: z.string(),
  task: TaskSpecSchema,
  turn: z.number().int().nonnegative(),
  workspaceTree: z.array(z.string()),
  lastObservation: z.string().max(20_000).optional(),
});
export type AgentTurnInput = z.infer<typeof AgentTurnInputSchema>;

export const AgentTurnOutputSchema = z.object({
  action: AgentActionSchema,
  publicMessage: z.string().max(500).default(''),
});
export type AgentTurnOutput = z.infer<typeof AgentTurnOutputSchema>;

export const VerifierCheckResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: CheckStatusSchema,
  score: z.number().min(0).max(100),
  weight: z.number().positive(),
  message: z.string().max(2_000),
});
export type VerifierCheckResult = z.infer<typeof VerifierCheckResultSchema>;

export const VerifierResultSchema = z.object({
  schemaVersion: z.literal(1),
  checks: z.array(VerifierCheckResultSchema),
  totalScore: z.number().min(0).max(100),
  passed: z.boolean(),
});
export type VerifierResult = z.infer<typeof VerifierResultSchema>;

export const ModelProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  model: z.string(),
  available: z.boolean(),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const OperatorSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type Operator = z.infer<typeof OperatorSchema>;

export const TaskVersionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  version: z.number().int().positive(),
  spec: TaskSpecSchema,
  digest: z.string().length(64),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
});
export type TaskVersion = z.infer<typeof TaskVersionSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  status: TaskStatusSchema,
  currentVersionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const RunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskVersionId: z.string(),
  taskVersionDigest: z.string(),
  modelProfileId: z.string(),
  modelLabel: z.string(),
  status: RunStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  verifier: VerifierResultSchema.nullable(),
  turnCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type EvaluationRun = z.infer<typeof RunSchema>;

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int().positive(),
  type: z.enum([
    'evaluation.requested',
    'evaluation.started',
    'agent.turn',
    'sandbox.command',
    'verifier.completed',
    'evaluation.completed',
    'evaluation.failed',
    'evaluation.cancelled',
  ]),
  message: z.string(),
  data: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const CreateRunInputSchema = z.object({
  taskId: z.string().min(1),
  modelProfileId: z.string().min(1),
});
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

export const ComparisonRowSchema = z.object({
  modelProfileId: z.string(),
  modelLabel: z.string(),
  runCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  averageScore: z.number().min(0).max(100).nullable(),
  bestScore: z.number().min(0).max(100).nullable(),
  averageDurationMs: z.number().nonnegative().nullable(),
});
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export function calculateWeightedScore(results: VerifierCheckResult[]): number {
  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0);
  if (totalWeight === 0) return 0;
  const score =
    results.reduce((sum, result) => sum + result.score * result.weight, 0) / totalWeight;
  return Math.round(score * 100) / 100;
}
