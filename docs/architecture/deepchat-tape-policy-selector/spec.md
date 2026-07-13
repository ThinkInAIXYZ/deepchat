# DeepChat Tape Policy Selector - Spec

Status: implemented SDD. This goal adds a policy registry and default selector for Tape view
assembly.

## Problem

`TapeViewAssembler` can accept an injected policy, but production assembly still selects the legacy
policy inline. The architecture needs a small selector boundary so future policy expansion can add
new policies without changing chat or resume assembly call sites.

## Goals

1. Add a `TapeViewPolicy` registry in the existing policy module.
2. Resolve the active policy through a selector for chat and resume assembly.
3. Keep `legacy_context_v1` as the default policy for all sessions.
4. Preserve current provider-bound message output.
5. Return policy selection reason in assembler metadata for audit/debugging.

## Non-Goals

- Introducing a new context-selection algorithm.
- Adding user-facing policy settings.
- Changing compaction, preflight, or context-pressure recovery.
- Adding a separate policy service or persistence table.

## Acceptance Criteria

1. `TapeViewAssembler` uses `resolveTapeViewPolicy()` for default policy selection.
2. `resolveTapeViewPolicy()` returns `legacy_context_v1` with reason `default` when no policy is
   requested.
3. Unknown requested policy ids fall back to `legacy_context_v1` with reason `fallback_default`.
4. Injected test policies remain supported and report reason `injected`.
5. Assembler output remains provider-message equivalent with the previous implementation.
6. Policy registry tests cover list, lookup, default selection, and fallback selection.
7. Focused Tape tests, format, i18n, lint, typecheck, and full Vitest pass.

## Contract

```ts
export type TapeViewPolicySelectionReason = 'default' | 'requested' | 'fallback_default' | 'injected'

export interface TapeViewPolicySelection {
  policy: TapeViewPolicy
  requestedPolicyId: string | null
  reason: TapeViewPolicySelectionReason
}

export function resolveTapeViewPolicy(input?: {
  requestedPolicyId?: string | null
}): TapeViewPolicySelection
```

The first registry contains only `legacy_context_v1`.
