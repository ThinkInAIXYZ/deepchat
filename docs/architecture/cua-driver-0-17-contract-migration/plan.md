# CUA Driver Contract Validation Plan

## Scope

The maintained contract is [CUA Driver Contract](./spec.md). The current source pin is
`0.19.2/0.6.0`; every validation artifact must identify the binary and metadata it actually exercised.
Adapter implementation does not close the native cross-platform or release-signing gates.

## Pin and Package Consistency

Verify the upstream tag/commit, checksums, archive inventory, embedded handshake, target-local
catalog, and platform-scoped closed policy as one unit. Preserve the five supported targets,
Linux arm64 exclusion, direct embedded daemon/proxy lifecycle, and denied clipboard reads.

## Adapter Regression Boundaries

Use the focused adapter, ToolManager, plugin/runtime, catalog, integrity, build-runtime, and packaging
suites to protect these contracts:

- Reject a bare native `element_index` before dispatch; preserve an opaque token or exact
  index-plus-snapshot pair, pixel addressing, zero values, and unrelated fields.
- Remove only empty optional tokens and retain one-refresh/one-retry handling for stale handles.
- Keep `ActionResult` and `verify_state` projections closed and bounded; exclude `observed_json`
  and preserve window-handle, browser-chrome, and structured-refusal behavior.
- Keep the Computer Use Skill's delivery/effect/completion distinction and supported window/native
  predicate limits aligned with the adapter.

## Outstanding Native Evidence

Run native action and verification scenarios on macOS x64, Windows x64/arm64, and Linux x64 in their
matching desktop environments. Run signed/notarized macOS validation and retain the platform gates
for TCC, capture, input, restart, crash/recovery, and supported cursor themes. A host-only or unsigned
result cannot stand in for another platform or the release-signing gate.

For the current host artifact, build, validate, and verify the CUA plugin and record its exact pin.
Run formatting, i18n, lint, Node/Web type checks, and the relevant focused/broader suites for any
implementation change. Resolve confirmed failures before accepting the corresponding gate.
