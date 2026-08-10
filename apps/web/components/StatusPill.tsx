import type { RunStatus, TaskStatus } from '@arbiter/contracts';

type Status = RunStatus | TaskStatus;

const labels: Record<Status, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export function StatusPill({ status }: Readonly<{ status: Status }>) {
  return <span className={`status-pill status-${status}`}>{labels[status]}</span>;
}
