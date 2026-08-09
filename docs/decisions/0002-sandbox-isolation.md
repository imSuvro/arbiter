# ADR 0002: Isolated task execution

## Decision

Use constrained Docker containers for local runs and one isolated Fargate task per production evaluation. The application never receives a Docker socket.

## Why

Candidate code is untrusted. Isolation, resource limits, no credentials, no host mounts, no privilege, and no network access are mandatory controls. Fargate provides a stronger production task boundary than colocated containers.
