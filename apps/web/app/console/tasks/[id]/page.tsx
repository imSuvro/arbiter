'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusPill } from '../../../../components/StatusPill';
import { apiFetch, type ModelsResponse, type TaskDetailResponse } from '../../../../lib/api';
import type { ModelProfile, Task, TaskVersion } from '@arbiter/contracts';

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [versions, setVersions] = useState<TaskVersion[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [detail, modelResult] = await Promise.all([
        apiFetch<TaskDetailResponse>(`/api/tasks/${params.id}`),
        apiFetch<ModelsResponse>('/api/models'),
      ]);
      setTask(detail.task);
      setVersions(detail.versions);
      setModels(modelResult.models);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the task.');
    }
  }
  useEffect(() => {
    void load();
  }, [params.id]);

  async function publish() {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/tasks/${params.id}/publish`, { method: 'POST', body: '{}' });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to publish the version.');
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<{ run: { id: string } }>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({
          taskId: params.id,
          modelProfileId: models[0]?.id ?? 'deterministic',
        }),
      });
      router.push(`/console/runs/${result.run.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start the run.');
      setBusy(false);
    }
  }

  if (!task)
    return (
      <div className="route-loading">
        <span className="pulse-dot" /> Loading task contract…
      </div>
    );
  const latest = versions[0];
  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Task contract</span>
          <div className="run-title" style={{ marginTop: 9 }}>
            <h1>{task.title}</h1>
            <StatusPill status={task.status} />
          </div>
          <p>{task.summary}</p>
        </div>
        <div className="page-heading__actions">
          <Link className="secondary-button" href="/console/tasks">
            Task library
          </Link>
          {task.status === 'draft' ? (
            <button className="primary-button" onClick={() => void publish()} disabled={busy}>
              Publish version →
            </button>
          ) : (
            <button className="primary-button" onClick={() => void run()} disabled={busy}>
              Run evaluation →
            </button>
          )}
        </div>
      </div>
      {error ? (
        <div className="form-error" style={{ marginTop: 22 }} role="alert">
          {error}
        </div>
      ) : null}
      <div className="section-grid">
        <div className="panel">
          <div className="panel__head">
            <h2>Version history</h2>
            <span className="eyebrow">
              {versions.length} version{versions.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Digest</th>
                  <th>Created</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td>
                      <strong>v{version.version}</strong>
                    </td>
                    <td>
                      <code>{version.digest.slice(0, 16)}…</code>
                    </td>
                    <td className="muted mono">{new Date(version.createdAt).toLocaleString()}</td>
                    <td>
                      {version.publishedAt ? (
                        <StatusPill status="published" />
                      ) : (
                        <StatusPill status="draft" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel__head">
            <h2>Contract shape</h2>
          </div>
          <div className="panel__body">
            <div className="settings-list">
              <div className="settings-row">
                <span>Slug</span>
                <strong>{task.slug}</strong>
              </div>
              <div className="settings-row">
                <span>Toolchain</span>
                <strong>{latest?.spec.toolchain.image ?? '—'}</strong>
              </div>
              <div className="settings-row">
                <span>Checks</span>
                <strong>{latest?.spec.checks.length ?? 0}</strong>
              </div>
              <div className="settings-row">
                <span>Max turns</span>
                <strong>{latest?.spec.limits.maxTurns ?? '—'}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel__head">
          <h2>Candidate instructions</h2>
          <code>version {latest?.version ?? '—'}</code>
        </div>
        <div className="panel__body">
          <p style={{ whiteSpace: 'pre-wrap', color: '#536776', fontSize: 13 }}>
            {latest?.spec.instructions ?? 'No version specification is available.'}
          </p>
        </div>
      </section>
    </div>
  );
}
