# ADR 0005: Single operator for v1

## Decision

Use one authenticated operator account with secure sessions. Do not add public self-signup, organizations, roles, or billing in v1.

## Why

The product is intended to demonstrate evaluation workflow quality first. The persistence model keeps task versions and run ownership explicit so multi-tenant scoping can be added later without exposing an unsafe public authoring surface now.
