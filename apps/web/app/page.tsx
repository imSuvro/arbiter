import Link from 'next/link';

export default function LandingPage() {
  return (
    <main>
      <nav className="public-nav" aria-label="Public navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">A</span>
          <span>Arbiter</span>
        </Link>
        <div className="public-nav__links">
          <a href="#method">Method</a>
          <a href="#control">Control surface</a>
          <Link className="nav-cta" href="/login">
            Open console <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">Agent evaluation, made observable</span>
          <h1>
            Turn agent behavior into <em>evidence.</em>
          </h1>
          <p className="hero__lede">
            Arbiter gives evaluation engineers one precise instrument for authoring tasks, running
            agents in isolated workspaces, and comparing deterministic verdicts across models.
          </p>
          <div className="hero__actions">
            <Link className="primary-button" href="/login">
              Enter the console <span aria-hidden="true">→</span>
            </Link>
            <a className="secondary-button" href="#method">
              See how it works
            </a>
          </div>
          <div className="hero__meta">
            <span>
              <i /> Immutable task versions
            </span>
            <span>
              <i /> Sandbox-first execution
            </span>
            <span>
              <i /> Audit-ready events
            </span>
          </div>
        </div>
        <div className="instrument" aria-label="Arbiter verdict instrument overview">
          <div className="instrument-card">
            <div className="instrument-card__head">
              <strong>VERDICT RAIL / EVIDENCE</strong>
              <span className="instrument-card__status">instrumented</span>
            </div>
            <div className="instrument-card__score">
              <div className="mini-score" />
              <div className="instrument-card__details">
                <strong>Deterministic evidence</strong>
                <span>Task input, sandbox boundary, and checker output remain linked.</span>
              </div>
            </div>
            <div className="instrument-checks">
              <div>
                <span>Immutable task version</span>
                <b>LOCKED</b>
              </div>
              <div>
                <span>Protected verifier</span>
                <b>READ-ONLY</b>
              </div>
              <div>
                <span>Run event trail</span>
                <b>APPEND-ONLY</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="public-section" id="method">
        <div className="public-section__heading">
          <span className="eyebrow">A tighter evaluation loop</span>
          <h2>Observe the work, not just the answer.</h2>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <span className="feature-card__number">01 / AUTHOR</span>
            <h3>Make the contract explicit.</h3>
            <p>
              Version candidate instructions, starter files, protected verifier files, limits, and
              weighted checks as one immutable task specification.
            </p>
          </article>
          <article className="feature-card">
            <span className="feature-card__number">02 / EXECUTE</span>
            <h3>Give agents a bounded workspace.</h3>
            <p>
              Every run begins from a clean task version. Actions, commands, timings, and
              observations become a legible event stream.
            </p>
          </article>
          <article className="feature-card">
            <span className="feature-card__number">03 / DECIDE</span>
            <h3>Let deterministic checks speak.</h3>
            <p>
              Score outputs with verifier code that candidates cannot edit, then compare model runs
              without losing the underlying evidence.
            </p>
          </article>
        </div>
      </section>

      <section className="public-section" id="control">
        <div className="public-section__heading">
          <span className="eyebrow">Built for model-quality teams</span>
          <h2>One console for the questions that matter.</h2>
        </div>
        <div className="section-grid" style={{ marginTop: 40 }}>
          <div className="panel">
            <div className="panel__body">
              <div className="eyebrow">Operational clarity</div>
              <h3 style={{ marginTop: 12, fontFamily: 'Sora, sans-serif', fontSize: 24 }}>
                Which model solved the task, and what did it do along the way?
              </h3>
              <p className="muted" style={{ marginTop: 12, maxWidth: 640 }}>
                Arbiter keeps the score, run duration, action count, version digest, verifier
                messages, and event timeline in the same place. That makes a pass explainable and a
                failure actionable.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel__body">
              <div className="eyebrow">Local by default</div>
              <h3 style={{ marginTop: 12, fontFamily: 'Sora, sans-serif', fontSize: 24 }}>
                Start free. Choose your provider.
              </h3>
              <p className="muted" style={{ marginTop: 12 }}>
                A deterministic fixture keeps CI reproducible. Google Gemma is an explicit optional
                adapter for hosted experiments; production never silently substitutes a fake result.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="public-footer">
        <span>Arbiter / precision infrastructure for agent evaluation</span>
        <span>Single-operator v0.1 · Designed for accountable experiments</span>
      </footer>
    </main>
  );
}
