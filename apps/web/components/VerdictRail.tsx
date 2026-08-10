import type { EvaluationRun, RunEvent } from '@arbiter/contracts';
import { ScoreRing } from './ScoreRing';
import { StatusPill } from './StatusPill';

function duration(run: EvaluationRun): string {
  if (run.durationMs === null) return '—';
  return run.durationMs < 1_000
    ? `${run.durationMs} ms`
    : `${(run.durationMs / 1_000).toFixed(1)} s`;
}

export function VerdictRail({ run, events }: Readonly<{ run: EvaluationRun; events: RunEvent[] }>) {
  const passed = run.verifier?.checks.filter((check) => check.status === 'passed').length ?? 0;
  const checks = run.verifier?.checks.length ?? 0;
  return (
    <aside className="verdict-rail">
      <div className="verdict-rail__topline">
        <span className="eyebrow">Verdict rail</span>
        <StatusPill status={run.status} />
      </div>
      <ScoreRing score={run.score} />
      <div className="verdict-rail__stats">
        <div>
          <span>Checks</span>
          <strong>{checks ? `${passed}/${checks}` : 'Pending'}</strong>
        </div>
        <div>
          <span>Runtime</span>
          <strong>{duration(run)}</strong>
        </div>
        <div>
          <span>Turns</span>
          <strong>{run.turnCount}</strong>
        </div>
      </div>
      <div className="rail-progress" aria-label={`${events.length} evaluation events recorded`}>
        {events.slice(-8).map((event) => (
          <span key={event.id} className="rail-progress__dot" title={event.message} />
        ))}
      </div>
      <p className="muted">
        Evidence is tied to task version <code>{run.taskVersionDigest.slice(0, 12)}</code>.
      </p>
    </aside>
  );
}
