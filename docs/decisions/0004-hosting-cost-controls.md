# ADR 0004: Opt-in AWS production deployment

## Decision

Prepare AWS CDK and deployment workflows, but require a manual operator approval before any deployment. Local Docker Compose is the default development environment.

## Why

AWS is the best fit for event-driven orchestration and isolated execution, but cloud usage can incur charges. The repository must be deployable without silently creating billable resources.
