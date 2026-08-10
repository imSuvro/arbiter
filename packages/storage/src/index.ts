import { randomUUID } from 'node:crypto';
import { MongoClient, type Collection, type Db } from 'mongodb';
import type {
  ComparisonRow,
  EvaluationRun,
  Operator,
  RunEvent,
  Task,
  TaskVersion,
} from '@arbiter/contracts';

export interface OperatorRecord extends Operator {
  passwordHash: string;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  operatorId: string;
  createdAt: string;
  expiresAt: string;
}

export type RunPatch = Partial<
  Pick<
    EvaluationRun,
    | 'status'
    | 'score'
    | 'verifier'
    | 'turnCount'
    | 'durationMs'
    | 'error'
    | 'startedAt'
    | 'completedAt'
  >
>;

export interface Store {
  ensureOperator(record: OperatorRecord): Promise<void>;
  findOperator(email: string): Promise<OperatorRecord | null>;
  createSession(record: SessionRecord): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(task: Task): Promise<void>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task | null>;
  createTaskVersion(version: TaskVersion): Promise<void>;
  updateTaskVersion(id: string, patch: Partial<TaskVersion>): Promise<TaskVersion | null>;
  listTaskVersions(taskId: string): Promise<TaskVersion[]>;
  getTaskVersion(id: string): Promise<TaskVersion | null>;
  createRun(run: EvaluationRun): Promise<void>;
  getRun(id: string): Promise<EvaluationRun | null>;
  listRuns(limit?: number): Promise<EvaluationRun[]>;
  claimQueuedRun(workerId: string): Promise<EvaluationRun | null>;
  updateRun(id: string, patch: RunPatch): Promise<EvaluationRun | null>;
  appendEvent(input: Omit<RunEvent, 'id' | 'sequence' | 'createdAt'>): Promise<RunEvent>;
  listEvents(runId: string, afterSequence?: number): Promise<RunEvent[]>;
  compare(taskVersionId: string): Promise<ComparisonRow[]>;
  close(): Promise<void>;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function compareRuns(runs: EvaluationRun[], taskVersionId: string): ComparisonRow[] {
  const selected = runs.filter((run) => run.taskVersionId === taskVersionId);
  const profiles = new Map<string, EvaluationRun[]>();
  for (const run of selected) {
    const group = profiles.get(run.modelProfileId) ?? [];
    group.push(run);
    profiles.set(run.modelProfileId, group);
  }
  return [...profiles.entries()].map(([modelProfileId, group]) => {
    const completed = group.filter((run) => run.status === 'completed' && run.score !== null);
    const scores = completed.flatMap((run) => (run.score === null ? [] : [run.score]));
    const durations = completed.flatMap((run) => (run.durationMs === null ? [] : [run.durationMs]));
    return {
      modelProfileId,
      modelLabel: group[0]?.modelLabel ?? modelProfileId,
      runCount: group.length,
      completedCount: completed.length,
      averageScore: average(scores),
      bestScore: scores.length > 0 ? Math.max(...scores) : null,
      averageDurationMs: average(durations),
    };
  });
}

export class InMemoryStore implements Store {
  private readonly operators = new Map<string, OperatorRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tasks = new Map<string, Task>();
  private readonly versions = new Map<string, TaskVersion>();
  private readonly runs = new Map<string, EvaluationRun>();
  private readonly events = new Map<string, RunEvent[]>();

  public async ensureOperator(record: OperatorRecord): Promise<void> {
    if (!this.operators.has(record.email)) this.operators.set(record.email, record);
  }

  public async findOperator(email: string): Promise<OperatorRecord | null> {
    return this.operators.get(email) ?? null;
  }

  public async createSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.tokenHash, record);
  }

  public async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash) ?? null;
    if (session && Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return session;
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  public async listTasks(): Promise<Task[]> {
    return [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async getTask(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  public async createTask(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  public async updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (!task) return null;
    const updated = { ...task, ...patch, updatedAt: new Date().toISOString() };
    this.tasks.set(id, updated);
    return updated;
  }

  public async createTaskVersion(version: TaskVersion): Promise<void> {
    this.versions.set(version.id, version);
  }

  public async updateTaskVersion(
    id: string,
    patch: Partial<TaskVersion>,
  ): Promise<TaskVersion | null> {
    const version = this.versions.get(id);
    if (!version) return null;
    const updated = { ...version, ...patch };
    this.versions.set(id, updated);
    return updated;
  }

  public async listTaskVersions(taskId: string): Promise<TaskVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.taskId === taskId)
      .sort((a, b) => b.version - a.version);
  }

  public async getTaskVersion(id: string): Promise<TaskVersion | null> {
    return this.versions.get(id) ?? null;
  }

  public async createRun(run: EvaluationRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  public async getRun(id: string): Promise<EvaluationRun | null> {
    return this.runs.get(id) ?? null;
  }

  public async listRuns(limit = 50): Promise<EvaluationRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  public async claimQueuedRun(workerId: string): Promise<EvaluationRun | null> {
    const queued = [...this.runs.values()]
      .filter((run) => run.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!queued) return null;
    const startedAt = new Date().toISOString();
    const claimed: EvaluationRun = { ...queued, status: 'running', startedAt };
    this.runs.set(queued.id, claimed);
    await this.appendEvent({
      runId: queued.id,
      type: 'evaluation.started',
      message: `Worker ${workerId} claimed the run.`,
      data: {},
    });
    return claimed;
  }

  public async updateRun(id: string, patch: RunPatch): Promise<EvaluationRun | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    const updated = { ...run, ...patch };
    this.runs.set(id, updated);
    return updated;
  }

  public async appendEvent(
    input: Omit<RunEvent, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<RunEvent> {
    const events = this.events.get(input.runId) ?? [];
    const event: RunEvent = {
      ...input,
      id: randomUUID(),
      sequence: events.length + 1,
      createdAt: new Date().toISOString(),
    };
    events.push(event);
    this.events.set(input.runId, events);
    return event;
  }

  public async listEvents(runId: string, afterSequence = 0): Promise<RunEvent[]> {
    return (this.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence);
  }

  public async compare(taskVersionId: string): Promise<ComparisonRow[]> {
    return compareRuns(await this.listRuns(10_000), taskVersionId);
  }

  public async close(): Promise<void> {}
}

type MongoDocument = Record<string, unknown>;

export class MongoStore implements Store {
  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly operators: Collection<MongoDocument>,
    private readonly sessions: Collection<MongoDocument>,
    private readonly tasks: Collection<MongoDocument>,
    private readonly versions: Collection<MongoDocument>,
    private readonly runs: Collection<MongoDocument>,
    private readonly events: Collection<MongoDocument>,
  ) {}

  public static async connect(uri: string, databaseName: string): Promise<MongoStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(databaseName);
    const store = new MongoStore(
      client,
      db,
      db.collection('operators'),
      db.collection('sessions'),
      db.collection('tasks'),
      db.collection('task_versions'),
      db.collection('runs'),
      db.collection('run_events'),
    );
    await store.createIndexes();
    return store;
  }

  private async createIndexes(): Promise<void> {
    await Promise.all([
      this.operators.createIndex({ email: 1 }, { unique: true }),
      this.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.tasks.createIndex({ slug: 1 }, { unique: true }),
      this.versions.createIndex({ taskId: 1, version: 1 }, { unique: true }),
      this.runs.createIndex({ status: 1, createdAt: 1 }),
      this.runs.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true }),
      this.events.createIndex({ runId: 1, sequence: 1 }, { unique: true }),
    ]);
  }

  public async ensureOperator(record: OperatorRecord): Promise<void> {
    await this.operators.updateOne(
      { email: record.email },
      { $setOnInsert: record as unknown as MongoDocument },
      { upsert: true },
    );
  }

  public async findOperator(email: string): Promise<OperatorRecord | null> {
    return (await this.operators.findOne(
      { email },
      { projection: { _id: 0 } },
    )) as OperatorRecord | null;
  }

  public async createSession(record: SessionRecord): Promise<void> {
    await this.sessions.insertOne(record as unknown as MongoDocument);
  }

  public async findSession(tokenHash: string): Promise<SessionRecord | null> {
    return (await this.sessions.findOne(
      { tokenHash },
      { projection: { _id: 0 } },
    )) as SessionRecord | null;
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.sessions.deleteOne({ tokenHash });
  }

  public async listTasks(): Promise<Task[]> {
    return (await this.tasks
      .find({}, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray()) as unknown as Task[];
  }

  public async getTask(id: string): Promise<Task | null> {
    return (await this.tasks.findOne({ id }, { projection: { _id: 0 } })) as Task | null;
  }

  public async createTask(task: Task): Promise<void> {
    await this.tasks.insertOne(task);
  }

  public async updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    return (await this.tasks.findOneAndUpdate(
      { id },
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    )) as Task | null;
  }

  public async createTaskVersion(version: TaskVersion): Promise<void> {
    await this.versions.insertOne(version);
  }

  public async updateTaskVersion(
    id: string,
    patch: Partial<TaskVersion>,
  ): Promise<TaskVersion | null> {
    return (await this.versions.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after', projection: { _id: 0 } },
    )) as TaskVersion | null;
  }

  public async listTaskVersions(taskId: string): Promise<TaskVersion[]> {
    return (await this.versions
      .find({ taskId }, { projection: { _id: 0 } })
      .sort({ version: -1 })
      .toArray()) as unknown as TaskVersion[];
  }

  public async getTaskVersion(id: string): Promise<TaskVersion | null> {
    return (await this.versions.findOne({ id }, { projection: { _id: 0 } })) as TaskVersion | null;
  }

  public async createRun(run: EvaluationRun): Promise<void> {
    await this.runs.insertOne(run);
  }

  public async getRun(id: string): Promise<EvaluationRun | null> {
    return (await this.runs.findOne({ id }, { projection: { _id: 0 } })) as EvaluationRun | null;
  }

  public async listRuns(limit = 50): Promise<EvaluationRun[]> {
    return (await this.runs
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()) as unknown as EvaluationRun[];
  }

  public async claimQueuedRun(workerId: string): Promise<EvaluationRun | null> {
    const startedAt = new Date().toISOString();
    const run = await this.runs.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'running', startedAt, workerId } },
      { sort: { createdAt: 1 }, returnDocument: 'after', projection: { _id: 0 } },
    );
    const claimed = run as EvaluationRun | null;
    if (claimed) {
      await this.appendEvent({
        runId: claimed.id,
        type: 'evaluation.started',
        message: `Worker ${workerId} claimed the run.`,
        data: {},
      });
    }
    return claimed;
  }

  public async updateRun(id: string, patch: RunPatch): Promise<EvaluationRun | null> {
    return (await this.runs.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after', projection: { _id: 0 } },
    )) as EvaluationRun | null;
  }

  public async appendEvent(
    input: Omit<RunEvent, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<RunEvent> {
    const previous = await this.events.findOne({ runId: input.runId }, { sort: { sequence: -1 } });
    const event: RunEvent = {
      ...input,
      id: randomUUID(),
      sequence: Number(previous?.sequence ?? 0) + 1,
      createdAt: new Date().toISOString(),
    };
    await this.events.insertOne(event);
    return event;
  }

  public async listEvents(runId: string, afterSequence = 0): Promise<RunEvent[]> {
    return (await this.events
      .find({ runId, sequence: { $gt: afterSequence } }, { projection: { _id: 0 } })
      .sort({ sequence: 1 })
      .toArray()) as unknown as RunEvent[];
  }

  public async compare(taskVersionId: string): Promise<ComparisonRow[]> {
    return compareRuns(await this.listRuns(10_000), taskVersionId);
  }

  public async close(): Promise<void> {
    await this.client.close();
  }
}

export async function createStore(options: {
  mongoUri?: string;
  databaseName: string;
}): Promise<Store> {
  if (options.mongoUri) return MongoStore.connect(options.mongoUri, options.databaseName);
  return new InMemoryStore();
}
