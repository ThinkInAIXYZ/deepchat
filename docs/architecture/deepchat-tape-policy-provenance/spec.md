# DeepChat Tape Policy Provenance - Spec

Status: implemented SDD. This goal records the active Tape view policy in every ViewManifest.

## Problem

`TapeViewAssembler` returns `policyId` and `policyVersion`, but `ViewManifest.policy` still stores
the older shadow labels such as `legacy_context_shadow` and `resume_shadow`. This weakens the Tape
audit trail because the persisted manifest does not identify the actual `TapeViewPolicy` that
selected the initial chat or resume context.

## Goals

1. Store the active `TapeViewPolicy` id in `ViewManifest.policy` for initial chat and resume
   requests.
2. Store the active policy version in `ViewManifest.policyVersion`.
3. Preserve existing `tool_loop_shadow`, `context_pressure_recovery_shadow`, and legacy shadow
   policy labels for compatibility.
4. Show policy version in TraceDialog when present.
5. Keep replay export and manifest lookup compatible with old manifest records.

## Non-Goals

- Changing the default policy away from `legacy_context_v1`.
- Adding user-facing policy selection.
- Changing token-budget selection.
- Rewriting tool-loop or context-pressure recovery selection.

## Acceptance Criteria

1. Normal chat manifests use `policy = "legacy_context_v1"` and `policyVersion = 1`.
2. Resume manifests use `policy = "legacy_context_v1"` and `policyVersion = 1`.
3. Tool-loop manifests keep `policy = "tool_loop_shadow"` and `policyVersion = null`.
4. Context-pressure recovery manifests keep `policy = "context_pressure_recovery_shadow"` and
   `policyVersion = null`.
5. Existing shadow policy values remain valid manifest values.
6. TraceDialog displays policy version when the manifest includes one.
7. Manifest, runtime, trace UI, replay, lint, typecheck, and targeted tests pass.

## Contract

```ts
export type DeepChatTapeViewPolicy =
  | 'legacy_context_v1'
  | 'legacy_context_shadow'
  | 'resume_shadow'
  | 'tool_loop_shadow'
  | 'context_pressure_recovery_shadow'

export interface DeepChatTapeViewManifest {
  policy: DeepChatTapeViewPolicy
  policyVersion: number | null
}
```

`legacy_context_shadow` and `resume_shadow` are accepted for older persisted manifests only.
