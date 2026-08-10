'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  apiFetch,
  type ComparisonResponse,
  type TaskDetailResponse,
  type TaskListResponse,
} from '../../../lib/api';
import type { ComparisonRow, Task } from '@arbiter/contracts';

export default function ComparePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiFetch<TaskListResponse>('/api/tasks')
      .then(async (result) => {
        setTasks(result.tasks);
        const published = result.tasks.find(
          (task) => task.status === 'published' && task.currentVersionId,
        );
        if (published?.currentVersionId) setSelectedVersionId(published.currentVersionId);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load comparison data.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedVersionId)
      void apiFetch<ComparisonResponse>(
        `/api/comparisons?taskVersionId=${encodeURIComponent(selectedVersionId)}`,
      )
        .then((result) => setRows(result.rows))
        .catch((reason) =>
          setError(reason instanceof Error ? reason.message : 'Unable to load comparison results.'),
        );
  }, [selectedVersionId]);

  async function setTask(taskId: string) {
    try {
      const detail = await apiFetch<TaskDetailResponse>(`/api/tasks/${taskId}`);
      const published =
        detail.versions.find((version) => version.publishedAt) ?? detail.versions[0];
      setSelectedVersionId(published?.id ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load task versions.');
    }
  }

  if (loading)
    return (
      <div className="route-loading">
        <span className="pulse-dot" /> Assembling model comparison…
      </div>
    );
  const selectedTask = tasks.find((task) => task.currentVersionId === selectedVersionId);
  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Model comparison</span>
          <h1 style={{ marginTop: 9 }}>Put verdicts side by side.</h1>
          <p>
            Compare completed runs against the same immutable task version. Every row links back to
            the run evidence.
          </p>
        </div>
        <div className="page-heading__actions">
          <Link className="secondary-button" href="/console">
            Overview
          </Link>
        </div>
      </div>
      {error ? (
        <div className="form-error" style={{ marginTop: 22 }}>
          {error}
        </div>
      ) : null}
      <section className="panel" style={{ marginTop: 30 }}>
        <div className="panel__body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="comparison-task">Task</label>
              <select
                id="comparison-task"
                value={selectedTask?.id ?? ''}
                onChange={(event) => void setTask(event.target.value)}
              >
                <option value="">Select a published task</option>
                {tasks
                  .filter((task) => task.status === 'published')
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="comparison-version">Version digest</label>
              <select
                id="comparison-version"
                value={selectedVersionId}
                onChange={(event) => setSelectedVersionId(event.target.value)}
              >
                <option value="">Select a version</option>
                {selectedTask?.currentVersionId ? (
                  <option value={selectedTask.currentVersionId}>
                    {selectedTask.currentVersionId.slice(0, 16)}… / current
                  </option>
                ) : null}
              </select>
            </div>
          </div>
        </div>
      </section>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel__head">
          <h2>{selectedTask?.title ?? 'Comparison results'}</h2>
          <span className="eyebrow">
            {rows.length} model profile{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Runs</th>
                  <th>Completed</th>
                  <th>Average score</th>
                  <th>Best score</th>
                  <th>Avg. runtime</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.modelProfileId}>
                    <td>
                      <strong>{row.modelLabel}</strong>
                      <small className="muted" style={{ display: 'block' }}>
                        {row.modelProfileId}
                      </small>
                    </td>
                    <td className="mono">{row.runCount}</td>
                    <td className="mono">{row.completedCount}</td>
                    <td className="score-text">{row.averageScore ?? '—'}</td>
                    <td className="score-text">{row.bestScore ?? '—'}</td>
                    <td className="mono">
                      {row.averageDurationMs === null
                        ? '—'
                        : `${Math.round(row.averageDurationMs)} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>No comparable runs yet.</strong>
            <p>Run the seeded benchmark with an available model to populate this instrument.</p>
            <Link className="primary-button" style={{ marginTop: 17 }} href="/console">
              Go to overview
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
