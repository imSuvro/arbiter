# Arbiter architecture

Arbiter is a single-operator evaluation console with a public product surface and a protected execution console.

```mermaid
flowchart LR
  Browser["Browser"] --> Web["Next.js web"]
  Web --> Api["Express API"]
  Api --> Mongo["MongoDB"]
  Api --> Queue["Queue adapter"]
  Queue --> Worker["Evaluation worker"]
  Worker --> Provider["Model provider"]
  Worker --> Sandbox["Sandbox adapter"]
  Worker --> Mongo
  Worker --> Events["Run events"]
  Events --> Api
```

## Boundaries

- `apps/web` owns presentation, route protection, and live event consumption.
- `services/api` owns authentication, validation, persistence, and public HTTP contracts.
- `services/worker` owns asynchronous run execution and retry policy.
- `packages/contracts` owns schemas shared by the web, API, worker, and tests.
- `packages/evaluator` owns agent turns, verifier execution, and scoring.
- `packages/sandbox` owns local/Docker execution policies; `infra/aws` defines the separate Fargate task boundary.
- `infra/aws` contains deployable infrastructure definitions but is never applied automatically by CI.

The implemented local adapter runs verifier commands from a separate protected working directory and candidate commands from the writable workspace. It resolves all supplied paths to an absolute workspace root, rejects parent traversal, and removes both directories after the run. The Docker command adds network isolation, a read-only root, dropped capabilities, `no-new-privileges`, a non-root runtime, and CPU/memory/PID/output/time limits.

Production uses the CDK sandbox task definition as a separate Fargate boundary. The interactive task bridge is an explicit deployment gate: it must carry task-version digests and bounded action messages through an internal channel, never share a Docker socket, and be enabled only after an operator security review.

## Immutable evaluation inputs

Publishing a task creates a content-addressed task version. A run stores the version ID and digest. The worker reconstructs the starter workspace and read-only verifier from that version, so later edits cannot change an in-flight or historical evaluation.
