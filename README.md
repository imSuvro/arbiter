# Arbiter

Arbiter is a focused evaluation console for agentic coding work. It lets one operator author a versioned task, run an AI coding agent inside a constrained sandbox, score the resulting workspace with a deterministic verifier, and compare outcomes across models.

## Product principles

- The verifier is the source of truth; model confidence is not a score.
- Every run references an immutable task version.
- Candidate code runs without host mounts, credentials, or network access.
- Progress is observable through an event timeline instead of a silent spinner.
- Local development is complete without cloud credentials.

## Local development

Requirements: Node.js 22+, pnpm 11+, and Docker Desktop.

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d mongo
pnpm dev
```

The web console is served at `http://localhost:3000` and the API at `http://localhost:4000`.

Run the complete local validation suite with:

```powershell
pnpm validate
```

## Repository workflow

`main` is the production branch and `develop` is the integration branch. Work belongs on short-lived `codex/feature/...`, `codex/fix/...`, or `codex/chore/...` branches and enters protected branches through pull requests.

Commits use the repository's ticketed Conventional Commit format:

```text
ARB-0001: feat(api): A published task needs stable input. Added immutable task versions. Runs now execute against a content digest.
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [docs/architecture.md](docs/architecture.md) for operating details.
