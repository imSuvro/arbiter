'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../../../lib/api';

export default function NewTaskPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    slug: '',
    summary: '',
    instructions: '',
    starterFiles: '',
    verifierFiles: '',
    checkLabel: 'Acceptance check',
    checkCommand: 'node /verifier/check.mjs',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const starterFiles = form.starterFiles
      .split('\n')
      .filter(Boolean)
      .reduce<Record<string, string>>((files, line) => {
        const [path, ...content] = line.split('=');
        if (path && content.length) files[path.trim()] = content.join('=').trim();
        return files;
      }, {});
    const verifierFiles = form.verifierFiles
      .split('\n')
      .filter(Boolean)
      .reduce<Record<string, string>>((files, line) => {
        const [path, ...content] = line.split('=');
        if (path && content.length) files[path.trim()] = content.join('=').trim();
        return files;
      }, {});
    try {
      const result = await apiFetch<{ task: { id: string } }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          slug: form.slug,
          summary: form.summary,
          instructions: form.instructions,
          starterFiles,
          verifierFiles,
          checks: [
            {
              id: 'acceptance',
              label: form.checkLabel,
              command: form.checkCommand,
              weight: 1,
              timeoutMs: 30_000,
            },
          ],
        }),
      });
      router.replace(`/console/tasks/${result.task.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the task.');
      setSaving(false);
    }
  }

  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Task authoring</span>
          <h1 style={{ marginTop: 9 }}>Define the contract.</h1>
          <p>
            Keep candidate-editable files and verifier-only files separate. Publish only when the
            acceptance path is reviewable.
          </p>
        </div>
        <Link className="secondary-button" href="/console/tasks">
          Back to library
        </Link>
      </div>
      <form className="panel form-panel" onSubmit={submit}>
        <div className="form-panel__body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="title">Task title</label>
              <input
                id="title"
                value={form.title}
                onChange={(event) => update('title', event.target.value)}
                required
                minLength={3}
              />
            </div>
            <div className="field">
              <label htmlFor="slug">Stable slug</label>
              <input
                id="slug"
                value={form.slug}
                onChange={(event) => update('slug', event.target.value)}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              />
              <small>Lowercase words joined with hyphens.</small>
            </div>
          </div>
          <div className="field">
            <label htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              value={form.summary}
              onChange={(event) => update('summary', event.target.value)}
              required
              minLength={20}
            />
            <small>Describe the behavior the agent must produce.</small>
          </div>
          <div className="field">
            <label htmlFor="instructions">Candidate instructions</label>
            <textarea
              id="instructions"
              value={form.instructions}
              onChange={(event) => update('instructions', event.target.value)}
              required
              minLength={50}
            />
            <small>These instructions become part of the immutable version digest.</small>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="starter">Starter workspace files</label>
              <textarea
                id="starter"
                value={form.starterFiles}
                onChange={(event) => update('starterFiles', event.target.value)}
              />
              <small>One file per line: path=content. Keep verifier code out.</small>
            </div>
            <div className="field">
              <label htmlFor="verifier">Verifier-only files</label>
              <textarea
                id="verifier"
                value={form.verifierFiles}
                onChange={(event) => update('verifierFiles', event.target.value)}
              />
              <small>
                Mounted read-only at <code>/verifier</code> during checks.
              </small>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="check-label">Acceptance check label</label>
              <input
                id="check-label"
                value={form.checkLabel}
                onChange={(event) => update('checkLabel', event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="check-command">Verifier command</label>
              <input
                id="check-command"
                className="mono"
                value={form.checkCommand}
                onChange={(event) => update('checkCommand', event.target.value)}
                required
              />
            </div>
          </div>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="form-actions">
            <Link className="secondary-button" href="/console/tasks">
              Cancel
            </Link>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving contract…' : 'Create draft version →'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
