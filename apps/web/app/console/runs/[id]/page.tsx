'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusPill } from '../../../../components/StatusPill';
import { VerdictRail } from '../../../../components/VerdictRail';
import { apiFetch, apiUrl, type RunResponse } from '../../../../lib/api';
import type { EvaluationRun, RunEvent } from '@arbiter/contracts';

const terminal = new Set(['completed', 'failed', 'cancelled']);

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  async function refresh() {
    try {
      const result = await apiFetch<RunResponse>(`/api/runs/${params.id}`);
      setRun(result.run);
      setEvents(result.events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the evaluation.');
    }
  }

  useEffect(() => {
    let active = true;
    void refresh();
    const interval = window.setInterval(() => {
      if (active && (!run || !terminal.has(run.status))) void refresh();
    }, 1_200);
    const source = new EventSource(`${apiUrl(`/api/runs/${params.id}/events`)}`, {
      withCredentials: true,
    });
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RunEvent;
        setEvents((current) =>
          current.some((item) => item.id === event.id) ? current : [...current, event],
        );
      } catch {
        /* The polling path remains authoritative. */
      }
    };
    source.onerror = () => source.close();
    return () => {
      active = false;
      window.clearInterval(interval);
      source.close();
    };
  }, [params.id, run?.status]);

  async function cancel() {
    setCancelling(true);
    try {
      await apiFetch(`/api/runs/${params.id}/cancel`, { method: 'POST', body: '{}' });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to cancel the evaluation.');
    } finally {
      setCancelling(false);
    }
  }

  if (!run)
    return (
      <div className="route-loading">
        <span className="pulse-dot" /> Replaying evaluation evidence…
      </div>
    );
  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Evaluation run / {run.id.slice(0, 12)}</span>
          <div className="run-title" style={{ marginTop: 9 }}>
            <h1>{run.modelLabel}</h1>
            <StatusPill status={run.status} />
          </div>
          <p>
            Task version <code>{run.taskVersionDigest.slice(0, 16)}…</code> · created{' '}
            {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="page-heading__actions">
          <Link className="secondary-button" href="/console/compare">
            Compare runs
          </Link>
          {!terminal.has(run.status) ? (
            <button
              className="secondary-button danger-button"
              onClick={() => void cancel()}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel run'}
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="form-error" style={{ marginTop: 22 }} role="alert">
          {error}
        </div>
      ) : null}
      <div className="run-layout">
        <div className="panel run-event-panel">
          <div className="panel__head">
            <h2>Event timeline</h2>
            <span className="eyebrow">{events.length} recorded</span>
          </div>
          {events.length ? (
            <div className="event-list">
              {events.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className="event-number">{event.sequence}</span>
                  <div>
                    <strong>{event.message}</strong>
                    <small>{event.type}</small>
                    {event.data.command ? <code>{String(event.data.command)}</code> : null}
                  </div>
                  <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>Waiting for the first event.</strong>
              <p>The queue will publish the run lifecycle here.</p>
            </div>
          )}
        </div>
        <VerdictRail run={run} events={events} />
      </div>
      {run.error ? (
        <section className="form-error" style={{ marginTop: 18 }}>
          <strong>Evaluation failure:</strong> {run.error}
        </section>
      ) : null}
      {run.verifier ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panel__head">
            <h2>Verifier checks</h2>
            <span className="score-text">{run.verifier.totalScore} / 100</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Weight</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {run.verifier.checks.map((check) => (
                  <tr key={check.id}>
                    <td>
                      <strong>{check.label}</strong>
                    </td>
                    <td>
                      <StatusPill status={check.status === 'passed' ? 'completed' : 'failed'} />
                    </td>
                    <td className="mono">{check.weight}</td>
                    <td className="muted">{check.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
