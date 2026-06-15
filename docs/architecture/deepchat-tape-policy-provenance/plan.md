# DeepChat Tape Policy Provenance - Plan

## Architecture Decision

Use the existing `TapeViewAssemblerResult.policyId` and `policyVersion` as the source of truth for
initial chat and resume manifests. Keep request-level tool-loop and context-pressure recovery
manifests as shadow policies because they are post-assembly request transformations.

## Flow

```text
TapeViewAssembler.buildTapeChatView()
  -> result.policyId = legacy_context_v1
  -> runStreamForMessage(viewContext.policy = result.policyId)
  -> ViewManifest.policy = legacy_context_v1
  -> ViewManifest.policyVersion = 1

Tool loop / context pressure recovery
  -> request-level ViewManifest
  -> shadow policy label
  -> policyVersion = null
```

## Module Changes

| Module | Change |
| --- | --- |
| `src/shared/types/tape-view-manifest.ts` | Add `legacy_context_v1` and `policyVersion`. |
| `src/main/presenter/agentRuntimePresenter/tapeViewManifest.ts` | Persist policy version in manifest. |
| `src/main/presenter/agentRuntimePresenter/index.ts` | Pass assembler policy id/version into view context. |
| `src/main/presenter/agentRuntimePresenter/tapeService.ts` | Store policy version in event metadata. |
| `src/renderer/src/components/trace/TraceDialog.vue` | Show policy version when present. |
| Tests | Update manifest, service, and trace expectations. |

## Compatibility

- Existing shadow policy strings remain accepted by shared types and UI.
- Old manifests without `policyVersion` continue to render; the field is treated as absent/null.
- Replay slice export keeps its current lookup behavior.

## Verification

```bash
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewManifest.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeService.test.ts
pnpm vitest run test/renderer/components/trace/TraceDialog.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck:node
pnpm run typecheck:web
```
