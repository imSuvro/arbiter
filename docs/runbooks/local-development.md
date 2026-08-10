# Local development runbook

1. Install Node.js 22, pnpm 11, and Docker Desktop.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env` and set the operator credentials.
4. Start MongoDB with `docker compose up -d mongo`.
5. Start the API and web app with `pnpm dev`.
6. Use the seeded task to verify a complete local run.

For a queue integration environment, start LocalStack with `docker compose --profile integration up -d localstack`, set `SQS_ENDPOINT=http://localhost:4566`, and run the integration suite. The ordinary local API uses the in-memory queue and embedded worker so the happy path stays free and self-contained.

Set `SANDBOX_BACKEND=local` only for a workstation that cannot run Docker. The local backend is useful for tests but is not an isolation boundary for untrusted public workloads; Docker with the restricted runner is the local default for candidate execution.

Run quality gates with `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, and the Playwright smoke journey. The browser test requires `python -m pip install -r requirements-e2e.txt` and `python -m playwright install chromium`.

No AWS credentials or hosted model key is needed for the deterministic local provider.
