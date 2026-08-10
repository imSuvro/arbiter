# ADR 0003: Provider adapter with Gemma default

## Decision

Use a provider interface with Google AI Studio Gemma 4 `gemma-4-26b-a4b-it` as the hosted development provider and a deterministic provider for tests and offline local validation. The 26B A4B variant is the default because Google documents it as requiring fewer resources than the 31B dense variant while keeping the same free Gemma API pricing.

## Why

The hosted model is available without requiring a local GPU. The provider boundary keeps the evaluator independent from one vendor and prevents test suites from depending on external inference.
