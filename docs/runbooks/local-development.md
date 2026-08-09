# Local development runbook

1. Install Node.js 22, pnpm 11, and Docker Desktop.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env` and set the operator credentials.
4. Start MongoDB with `docker compose up -d mongo`.
5. Start the API and web app with `pnpm dev`.
6. Use the seeded task to verify a complete local run.

No AWS credentials or hosted model key is needed for the deterministic local provider.
