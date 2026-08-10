'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiFetch } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.replace('/console');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-page__story">
        <Link className="brand" href="/">
          <span className="brand-mark">A</span>
          <span>Arbiter</span>
        </Link>
        <div>
          <h1>A clear verdict starts with a controlled experiment.</h1>
          <p>
            Sign in to author tasks, run your evaluation loop, and inspect the evidence that
            supports every score.
          </p>
        </div>
        <small>Private operator console / v0.1</small>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">Operator access</span>
          <h2>Welcome back.</h2>
          <p>Use the operator credentials configured for this environment.</p>
          <div className="form-stack">
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? 'Checking credentials…' : 'Sign in to Arbiter'}
            </button>
          </div>
          <p className="login-note">
            Authentication is single-operator by design in this release. Sessions are stored
            server-side and expire automatically.
          </p>
        </form>
      </section>
    </main>
  );
}
