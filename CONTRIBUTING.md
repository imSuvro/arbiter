# Contributing to Arbiter

## Branches

- `main`: production history and semantic-version releases.
- `develop`: integration history.
- `codex/feature/ARB-####-description`: scoped feature work.
- `codex/fix/ARB-####-description`: scoped repairs.
- `codex/chore/ARB-####-description`: tooling and documentation work.

Do not commit directly to `main` or `develop`. Open a pull request with a focused diff and link the relevant ticket ID.

## Commit messages

Every commit must follow:

```text
ARB-####: type(scope): problem. Fix. Expected behavior.
```

The commit must describe one reviewable unit. Avoid combining UI, persistence, deployment, and unrelated cleanup in one commit.

## Pull requests

Pull requests must explain the behavior change, security impact, validation performed, and any deployment or migration requirement. CI must pass before merge.
