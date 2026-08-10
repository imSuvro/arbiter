'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { StatusPill } from '../../components/StatusPill';
import {
  apiFetch,
  type ModelsResponse,
  type RunListResponse,
  type TaskListResponse,
} from '../../lib/api';
import type { EvaluationRun, ModelProfile, Task } from '@arbiter/contracts';

function relativeDate(value: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export default function ConsoleOverview() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);

  async function load() {
    try {
      const [taskResult, runResult, modelResult] = await Promise.all([
        apiFetch<TaskListResponse>('/api/tasks'),
        apiFetch<RunListResponse>('/api/runs'),
        apiFetch<ModelsResponse>('/api/models'),
      ]);
      setTasks(taskResult.tasks);
      setRuns(runResult.runs);
      setModels(modelResult.models);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the console.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const publishedTask = useMemo(
    () =>
      tasks.find(
        (task) => task.slug === 'normalize-webhook-events' && task.status === 'published',
      ) ?? tasks.find((task) => task.status === 'published'),
    [tasks],
  );
  const completedRuns = runs.filter((run) => run.status === 'completed');
  const averageScore = completedRuns.length
    ? Math.round(
        (completedRuns.reduce((sum, run) => sum + (run.score ?? 0), 0) / completedRuns.length) * 10,
      ) / 10
    : null;

  async function launchBenchmark() {
    if (!publishedTask) return;
    setLaunching(true);
    try {
      const result = await apiFetch<{ run: EvaluationRun }>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({
          taskId: publishedTask.id,
          modelProfileId: models[0]?.id ?? 'deterministic',
        }),
      });
      window.location.href = `/console/runs/${result.run.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start an evaluation.');
      setLaunching(false);
    }
  }

  if (loading)
    return (
      <div className="route-loading">
        <span className="pulse-dot" /> Loading evaluation workspace…
      </div>
    );

  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Operator workspace</span>
          <h1 style={{ marginTop: 9 }}>Good experiments leave a trail.</h1>
          <p>
            Author task contracts, run agents inside bounded workspaces, and make every verdict
            inspectable.
          </p>
        </div>
        <div className="page-heading__actions">
          <Link className="secondary-button" href="/console/tasks">
            Browse tasks
          </Link>
          <Link className="primary-button" href="/console/tasks/new">
            Author a task <span aria-hidden="true">＋</span>
          </Link>
        </div>
      </div>
      {error ? (
        <div className="form-error" style={{ marginTop: 22 }} role="alert">
          {error}
        </div>
      ) : null}
      <div className="metric-grid">
        <div className="metric-card">
          <span>Published tasks</span>
          <strong>{tasks.filter((task) => task.status === 'published').length}</strong>
          <p>Versioned evaluation contracts</p>
        </div>
        <div className="metric-card">
          <span>Runs observed</span>
          <strong>{runs.length}</strong>
          <p>Across all configured models</p>
        </div>
        <div className="metric-card">
          <span>Average score</span>
          <strong>{averageScore === null ? '—' : averageScore}</strong>
          <p>{completedRuns.length ? 'Completed runs only' : 'No completed runs yet'}</p>
        </div>
      </div>
      {publishedTask ? (
        <section className="panel benchmark-card" style={{ marginTop: 18 }}>
          <div className="panel__body">
            <span className="eyebrow">Seeded benchmark / deterministic acceptance</span>
            <h2>{publishedTask.title}</h2>
            <p>{publishedTask.summary}</p>
            <div className="benchmark-card__footer">
              <div className="benchmark-card__facts">
                <span>
                  status <b>{publishedTask.status}</b>
                </span>
                <span>
                  slug <b>{publishedTask.slug}</b>
                </span>
              </div>
              <button
                className="primary-button"
                onClick={() => void launchBenchmark()}
                disabled={launching}
              >
                {launching ? 'Starting run…' : 'Run benchmark →'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="empty-state">
            <strong>Publish your first task contract.</strong>
            <p>Once a task is published, the benchmark launcher and evidence stream appear here.</p>
            <Link className="primary-button" style={{ marginTop: 17 }} href="/console/tasks/new">
              Author a task
            </Link>
          </div>
        </section>
      )}
      <section className="section-grid">
        <div className="panel">
          <div className="panel__head">
            <h2>Recent evaluations</h2>
            <Link className="table-link" href="/console/compare">
              Compare all
            </Link>
          </div>
          {runs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 7).map((run) => (
                    <tr key={run.id}>
                      <td>
                        <Link className="table-link mono" href={`/console/runs/${run.id}`}>
                          {run.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td>{run.modelLabel}</td>
                      <td>
                        <StatusPill status={run.status} />
                      </td>
                      <td className="score-text">{run.score === null ? '—' : run.score}</td>
                      <td className="muted mono">{relativeDate(run.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No evaluations yet.</strong>
              <p>Run the seeded benchmark to create your first observable result.</p>
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel__head">
            <h2>Activity signal</h2>
            <span className="eyebrow">Live</span>
          </div>
          <div className="panel__body">
            <div className="activity-list">
              {runs.slice(0, 5).map((run) => (
                <div className="activity-row" key={run.id}>
                  <span className="activity-dot" />
                  <div>
                    <strong>{run.modelLabel} evaluation</strong>
                    <small>
                      {run.status === 'completed'
                        ? `Scored ${run.score ?? 0} against ${run.taskVersionDigest.slice(0, 8)}`
                        : `Run is ${run.status}.`}
                    </small>
                  </div>
                  <time>{relativeDate(run.createdAt)}</time>
                </div>
              ))}
              {!runs.length ? (
                <div className="empty-state">
                  <strong>The event log is quiet.</strong>
                  <p>Run activity will appear here.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
