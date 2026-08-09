# ADR 0001: TypeScript monorepo

## Decision

Use a pnpm workspace containing the Next.js application, Express API, worker, shared contracts, evaluator, sandbox, and test utilities.

## Why

The browser, API, and worker must share exact request, event, task, and result schemas. A workspace keeps those contracts versioned together while allowing each deployable service to have an independent runtime.
