# Tape ViewManifest PR Review Fixes - Plan

## Approach

Apply the PR review fixes in place, keeping the existing Tape architecture and presenter boundaries intact.

## Changes

| Area | Plan |
| --- | --- |
| `contextBuilder.ts` | Make resume `out_of_budget` exclusions only include emitted records that were not selected. |
| `agentRuntimePresenter/index.ts` | Carry recovered `summaryCursorOrderSeq` into manifest append; refresh tape history after resume compaction before building the resume view. |
| `agentSessionPresenter/index.ts` | Wrap optional manifest/replay delegation in `try/catch`, log warnings, and return graceful fallbacks. |
| `SessionClient.ts` | Normalize `result.manifests` to an array before returning diagnostics. |
| `TraceDialog.vue` | When a request sequence is selected, only show matching trace/manifest data. |
| `routes.ts` | Replace broad route catalog annotation with `satisfies Record<string, RouteContract>`. |
| i18n `traceDialog.json` | Translate new diagnostic keys for non-English locales and convert Traditional Chinese files. |
| `contextBuilder.ts` | Preserve turn boundaries during emergency truncation. |
| `tapeService.ts` | Exclude replay export timestamps from slice hash inputs. |
| `tapeViewManifest.ts` | Copy included/excluded ref arrays into manifest snapshots. |
| SDD docs | Keep this issue SDD current and address small doc nitpicks. |

## Compatibility

- No database or IPC schema changes.
- ViewManifest remains schema version 1.
- Existing sessions without manifests continue to return empty diagnostics.

## Test Strategy

Run required project checks:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
```

Run focused checks where practical:

```bash
pnpm run typecheck
pnpm vitest run test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewAssembler.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeViewManifest.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeService.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/contextBuilder.test.ts
pnpm vitest run test/renderer/components/trace/TraceDialog.test.ts
```
