# DeepChat Tape View Policy - Spec

Status: implemented SDD. This goal extracts the current legacy context-selection algorithm behind a
Tape view policy interface.

## Problem

`TapeViewAssembler` is now the production context assembly entry. Tape context policy work needs a
typed policy boundary so new selection strategies can be introduced without changing runtime call
sites.

## Goals

1. Introduce a `TapeViewPolicy` interface for chat and resume assembly.
2. Implement `legacy_context_v1` as the first policy.
3. Keep provider-bound `ChatMessage[]` and metadata identical to the current assembler output.
4. Record policy id/version in `TapeViewAssemblerResult`.
5. Keep ViewManifest and replay slice behavior compatible.
6. Support registry-backed default policy resolution.

## Non-Goals

- Introducing a new context-selection algorithm.
- Changing compaction, preflight, or context-pressure recovery.
- Adding user-facing policy selection.
- Adding memory graph or embedding retrieval.

## Acceptance Criteria

1. `TapeViewAssembler` no longer imports `buildContextWithMetadata()` directly.
2. `TapeViewAssembler` no longer imports `buildResumeContextWithMetadata()` directly.
3. `legacy_context_v1` policy delegates to the current context builder.
4. Assembler results include `policyId = "legacy_context_v1"` and `policyVersion = 1`.
5. Tests prove policy output matches the legacy builder for chat and resume.
6. Tests prove assembler output still matches policy output.
7. Existing ViewManifest, replay, trace, lint, typecheck, and full test suites pass.

## Contract

```ts
export interface TapeViewPolicy {
  id: 'legacy_context_v1'
  version: 1
  buildChat(input: TapeChatViewPolicyInput): ContextBuildResult
  buildResume(input: TapeResumeViewPolicyInput): ContextBuildResult
}
```

`legacy_context_v1` is the default policy for all DeepChat sessions in this increment.
