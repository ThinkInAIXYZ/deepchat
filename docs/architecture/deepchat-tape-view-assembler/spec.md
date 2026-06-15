# DeepChat Tape View Assembler - Spec

Status: implemented SDD. This goal replaces direct runtime context-builder calls with a Tape-owned
assembler boundary while preserving provider-bound message parity.

## Problem

ViewManifest and replay slices now make context decisions auditable. The runtime still calls
`buildContextWithMetadata()` and `buildResumeContextWithMetadata()` directly, so Tape remains an
observer around the production context path. The next architecture step needs a production
`TapeViewAssembler` boundary that owns context assembly inputs from the effective tape view.

## Goals

1. Route normal chat and resume context assembly through `TapeViewAssembler`.
2. Keep provider-bound `ChatMessage[]` identical to the existing context-builder output.
3. Keep `DeepChatTapeService` as the Tape boundary and use `ensureSessionTapeReady()` history
   records as the assembly source.
4. Preserve ViewManifest shadow event behavior and replay export behavior.
5. Add parity tests proving assembler output matches the legacy context builder for chat and resume.

## Non-Goals

- Context selection policy changes.
- Compaction policy updates.
- Provider preflight or context-pressure recovery modifications.
- Adding embedding memory or cross-session recall.
- Removing the legacy `contextBuilder.ts` implementation.

## Acceptance Criteria

1. Runtime normal chat no longer calls `buildContextWithMetadata()` directly.
2. Runtime resume no longer calls `buildResumeContextWithMetadata()` directly.
3. `TapeViewAssembler` exposes chat and resume assembly methods with typed metadata.
4. The assembler uses tape-ready history records supplied by `DeepChatTapeService`.
5. Tests prove chat parity against `buildContextWithMetadata()`.
6. Tests prove resume parity against `buildResumeContextWithMetadata()`.
7. Existing ViewManifest, replay slice, trace, lint, typecheck, and full test suites pass.

## Contract

```ts
export interface TapeViewAssemblerResult {
  messages: ChatMessage[]
  metadata: ContextBuildMetadata
  assemblerVersion: 'tape-view-assembler-v1'
  historySource: 'tape_effective_view'
  historyRecords: ChatMessageRecord[]
  policyId: 'legacy_context_v1'
  policyVersion: 1
  policySelectionReason: 'default' | 'requested' | 'fallback_default' | 'injected'
}
```

`contextBuilderVersion` in ViewManifest remains `legacy-v1` for this increment because the
underlying selection algorithm stays unchanged.
