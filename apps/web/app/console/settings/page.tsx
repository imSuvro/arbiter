import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="console-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Runtime settings</span>
          <h1 style={{ marginTop: 9 }}>Know what is running.</h1>
          <p>
            Provider keys and infrastructure secrets stay server-side. This page exposes the active
            operating model without revealing credentials.
          </p>
        </div>
        <Link className="secondary-button" href="/console">
          Overview
        </Link>
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <span className="eyebrow">Model adapters</span>
          <h2 style={{ marginTop: 9 }}>Explicit provider selection</h2>
          <p>
            Deterministic fixtures are used by CI and local development. Hosted Gemma runs are
            opt-in and quota failures are visible.
          </p>
          <div className="settings-list">
            <div className="settings-row">
              <span>Default fixture</span>
              <strong>deterministic / fixture-v1</strong>
            </div>
            <div className="settings-row">
              <span>Hosted adapter</span>
              <strong>Google Gemma 4 31B</strong>
            </div>
            <div className="settings-row">
              <span>Temperature</span>
              <strong>0.0</strong>
            </div>
            <div className="settings-row">
              <span>Secrets</span>
              <strong>server-side only</strong>
            </div>
          </div>
        </section>
        <section className="settings-card">
          <span className="eyebrow">Execution boundary</span>
          <h2 style={{ marginTop: 9 }}>Sandbox policy</h2>
          <p>
            Candidate commands run with no network, a read-only root, dropped capabilities, process
            and memory limits, and a verifier mount that is not writable.
          </p>
          <div className="settings-list">
            <div className="settings-row">
              <span>Local backend</span>
              <strong>Docker per run</strong>
            </div>
            <div className="settings-row">
              <span>Production boundary</span>
              <strong>Fargate task</strong>
            </div>
            <div className="settings-row">
              <span>Artifacts</span>
              <strong>digest-addressed</strong>
            </div>
            <div className="settings-row">
              <span>Operator model</span>
              <strong>single operator</strong>
            </div>
          </div>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel__head">
          <h2>Operational documentation</h2>
        </div>
        <div className="panel__body">
          <p className="muted">
            Deployment, rollback, incident response, and cost-control steps live in the repository
            runbooks. Keep the AWS path disabled until billing alerts, secrets, image digests, and
            the sandbox review are complete.
          </p>
          <div className="page-heading__actions" style={{ marginTop: 18 }}>
            <a
              className="secondary-button"
              href="https://github.com/imSuvro/arbiter"
              target="_blank"
              rel="noreferrer"
            >
              Open repository ↗
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
