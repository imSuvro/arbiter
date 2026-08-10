# ADR 0002: Isolated task execution

## Decision

Use constrained Docker containers for local runs and one isolated Fargate task per production evaluation. The application never receives a Docker socket. The local filesystem backend is an explicitly enabled development/test adapter only; production configuration requires the isolated backend.

## Why

Candidate code is untrusted. Isolation, resource limits, no credentials, no host mounts, no privilege, and no network access are mandatory controls. Fargate provides a stronger production task boundary than colocated containers.

Candidate containers receive only the writable workspace mount. Verifier containers receive the candidate workspace read-only plus a separate read-only verifier mount and use the verifier directory as their working directory. Candidate containers never receive the verifier mount or `ARBITER_VERIFIER_DIR`; local development commands receive a minimal allowlisted environment rather than inherited process secrets.
