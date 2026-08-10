import type {
  ComparisonRow,
  EvaluationRun,
  ModelProfile,
  RunEvent,
  Task,
  TaskVersion,
} from '@arbiter/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
      title?: string;
    } | null;
    throw new ApiError(
      response.status,
      payload?.detail ?? payload?.title ?? `Request failed with HTTP ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export type TaskListResponse = { tasks: Task[] };
export type TaskDetailResponse = { task: Task; versions: TaskVersion[] };
export type RunResponse = { run: EvaluationRun; events: RunEvent[] };
export type RunListResponse = { runs: EvaluationRun[] };
export type ModelsResponse = { models: ModelProfile[] };
export type ComparisonResponse = { rows: ComparisonRow[] };
