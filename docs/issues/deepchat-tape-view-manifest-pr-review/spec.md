# Tape ViewManifest PR Review Fixes - Spec

Status: implemented issue-fix SDD for PR #1768 review follow-up.

## Problem

PR review identified correctness and localization issues in the Tape ViewManifest flow. Some diagnostics can fail hard instead of degrading gracefully, request/manifest diagnostics can show mismatched request sequences, manifest provenance can record stale summary cursors after context-pressure recovery, resume view assembly can use stale tape history after compaction, request sequence generation can repeat after resume, replay hashes can include wall-clock time, manifest snapshots can alias caller arrays, and newly added TraceDialog labels are not properly localized.

## Goals

1. Fix still-valid CodeRabbit review findings for PR #1768 with minimal changes.
2. Preserve Tape ViewManifest and replay-slice contracts while correcting provenance and diagnostics behavior.
3. Ensure TraceDialog diagnostic strings are localized for every supported non-English locale touched by the PR.
4. Keep route-contract literal key inference intact.
5. Commit and push the fixes to the existing PR branch.

## Acceptance Criteria

1. Resume context assembly refreshes tape history after compaction resolution.
2. Context-pressure recovery returns and records the recovered summary cursor in appended manifests.
3. Excluded context metadata cannot classify the same resume record as both `empty_after_formatting` and `out_of_budget`.
4. Message view-manifest listing and replay-slice export return `[]`/`null` when agent resolution fails.
5. Renderer session client always returns an array for manifest diagnostics.
6. TraceDialog returns `null` instead of falling back to another request when a selected request sequence is missing from either traces or manifests.
7. `DEEPCHAT_ROUTE_CATALOG` uses `satisfies Record<string, RouteContract>` so route names remain a literal union.
8. TraceDialog diagnostic labels are translated in supported non-English locale files, including Traditional Chinese variants.
9. Review nitpicks that are small and local are addressed without broad refactors.
10. Emergency history truncation preserves per-turn metadata associations.
11. Replay slice hashes are deterministic across exports of the same manifest.
12. Manifest included/excluded snapshots are detached from caller-owned arrays.
13. `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` pass or any blocker is documented.

## Constraints

- Do not weaken authentication, authorization, or validation.
- Avoid unrelated refactors and preserve existing presenter boundaries.
- Keep ViewManifest schema compatible.

## Non-Goals

- Redesigning Tape ViewManifest or replay contracts.
- Adding new context-selection policies.
- Reworking the full i18n pipeline beyond the reviewed TraceDialog keys.

## Open Questions

None.
