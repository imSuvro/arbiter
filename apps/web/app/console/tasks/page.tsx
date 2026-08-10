'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusPill } from '../../../components/StatusPill';
import { apiFetch, type TaskListResponse } from '../../../lib/api';
import type { Task } from '@arbiter/contracts';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiFetch<TaskListResponse>('/api/tasks')
      .then((result) => setTasks(result.tasks))
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load tasks.'),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="route-loading">
        <span className="pulse-dot" /> Reading task library…
      </div>
    );
  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Task library</span>
          <h1 style={{ marginTop: 9 }}>Evaluation contracts.</h1>
          <p>
            Each published version is immutable. Runs point to the exact contract that produced
            their verdict.
          </p>
        </div>
        <div className="page-heading__actions">
          <Link className="primary-button" href="/console/tasks/new">
            Author a task <span aria-hidden="true">＋</span>
          </Link>
        </div>
      </div>
      {error ? (
        <div className="form-error" style={{ marginTop: 22 }}>
          {error}
        </div>
      ) : null}
      <div className="task-grid">
        {tasks.map((task) => (
          <article className="task-card" key={task.id}>
            <div>
              <div className="task-card__head">
                <h2>{task.title}</h2>
                <StatusPill status={task.status} />
              </div>
              <p>{task.summary}</p>
            </div>
            <div className="task-card__footer">
              <span>{task.slug}</span>
              <Link href={`/console/tasks/${task.id}`}>Inspect contract →</Link>
            </div>
          </article>
        ))}
        {!tasks.length ? (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <div className="empty-state">
              <strong>Your library is ready for its first contract.</strong>
              <p>Define the candidate workspace and deterministic acceptance checks.</p>
              <Link className="primary-button" style={{ marginTop: 17 }} href="/console/tasks/new">
                Author a task
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
