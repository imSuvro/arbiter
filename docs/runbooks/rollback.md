# Rollback runbook

1. Identify the last known-good semantic-version tag.
2. Redeploy the previous immutable image digests.
3. Stop new evaluation intake if the worker or verifier is unhealthy.
4. Allow in-flight runs to finish or cancel them explicitly.
5. Verify `/health`, `/ready`, login, task loading, and one deterministic evaluation.
6. Record the incident and restore the queue only after the verifier path is healthy.
