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

The seeded `Normalize webhook events` task is a real deterministic benchmark. Sign in with the operator credentials from `.env`, open the console, and run it to see candidate actions, protected verifier checks, a score, and the live event stream.

## Workspace map

- `apps/web` — Next.js public surface and authenticated operator console.
- `services/api` — Express API, session authentication, task/run routes, and SSE events.
- `services/worker` — SQS consumer for production queue-backed evaluations.
- `packages/contracts` — Zod schemas and shared domain types.
- `packages/evaluator` — provider loop, verifier execution, and weighted scoring.
- `packages/sandbox` — constrained local/Docker execution boundary.
- `packages/storage` — MongoDB repository and deterministic in-memory test store.
- `packages/queue` — in-memory, LocalStack, and Amazon SQS queue adapters.
- `infra/aws` — CDK topology for opt-in production preparation.

Local development uses the deterministic provider and does not require a hosted model key. Set `GOOGLE_GEMINI_API_KEY` only when you explicitly want to run the Gemma adapter. AWS infrastructure is never created by `pnpm`, CI, or the local Compose workflow.

Run the complete local validation suite with:

```powershell
pnpm validate
```

Coverage is collected with the V8 provider by `pnpm test:coverage`; the CI validation job runs it alongside the unit and service-backed integration suites. Coverage reports are written to each package's ignored `coverage/` directory for local inspection.

## Repository workflow

`main` is the production branch and `develop` is the integration branch. Work belongs on short-lived `codex/feature/...`, `codex/fix/...`, or `codex/chore/...` branches and enters protected branches through pull requests.

Commits use the repository's ticketed Conventional Commit format:

```text
ARB-0001: feat(api): A published task needs stable input. Added immutable task versions. Runs now execute against a content digest.
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [docs/architecture.md](docs/architecture.md) for operating details.
