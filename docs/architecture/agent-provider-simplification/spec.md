# Agent Provider Simplification (ACP-only)

## Background

DeepChat currently distinguishes between:

- **LLM providers**: network-backed providers that implement `BaseLLMProvider` (OpenAI/Anthropic/etc).
- **Agent providers**: providers that manage local agent sessions/processes (currently only `acp` via `AcpProvider`).

The codebase implements this distinction via a dedicated base class (`BaseAgentProvider`) and a runtime/type-detection API (`isAgentProvider`), which is then consumed from the renderer via IPC.

## Problem

- `BaseAgentProvider` is only used by `AcpProvider`, so the abstraction adds indirection without real reuse.
- Provider type detection is over-engineered (`isAgentConstructor` + prototype checks) and duplicates existing ACP-specific branching.
- The renderer calls `llmproviderPresenter.isAgentProvider(providerId)` over IPC, but the only “agent provider” is `providerId === 'acp'`. This creates unnecessary main↔renderer coupling and call complexity.

## Goals

- Treat **ACP as the only agent provider** and identify it **only by `providerId === 'acp'`**.
- Remove the generic “agent provider type detection” path and the renderer IPC dependency for this decision.
- Keep user-visible behavior unchanged:
  - ACP agents still appear as selectable models when ACP is enabled.
  - Non-ACP providers keep the standard model/custom-model refresh behavior.
  - Shutdown and provider disable still clean up ACP resources.

## Non-goals

- Supporting multiple agent providers beyond ACP.
- Redesigning ACP model derivation (agents-as-models) or session/workspace semantics.
- Changing persisted provider IDs or stored settings schemas.

## Acceptance Criteria

- Renderer no longer calls `llmproviderPresenter.isAgentProvider(...)`; ACP decision is local (`providerId === 'acp'`).
- Main process no longer needs `isAgentConstructor` / prototype-based provider classification.
- No remaining runtime dependency on `BaseAgentProvider` for correctness (ACP cleanup remains correct).
- `pnpm run typecheck`, `pnpm test`, `pnpm run lint` pass.

## Open Questions

- None.

