# CUA Driver 0.17 Contract Migration

## Status

Implementation and host-native validation are complete. This goal upgrades the bundled CUA
runtime from `0.14.1` to `0.17.0` without changing DeepChat's supported target matrix or
external-runtime ownership model. Native cross-platform and release-signing gates remain pending.

## Context

Before this migration, DeepChat pinned `cua-driver-rs-v0.14.1` and validated an exact embedded
handshake before exposing its MCP tools. The native catalog is generated from the release binary,
and packaging requires the catalog and closed tool policy to match exactly. Model-visible tool
content is separate from raw MCP `structuredContent`, so upstream structured contract changes need
an explicit DeepChat projection.

Upstream `0.15.0` and `0.17.0` introduce two breaking contracts:

- successful action tools now return the closed `ActionResult` shape instead of legacy per-tool
  structured fields;
- native element actions reject a bare `element_index` and require either `element_token` or the
  exact `element_index` plus `snapshot_id` pair from one current window snapshot.

The `0.17.0` release also adds `verify_state`, `set_window_frame`, `invoke_menu`,
`clipboard_read`, and `clipboard_write`. Existing tools are not removed. The embedded
daemon/proxy commands, tools-list schema, capability version, MCP protocol, packaged application
layout, and minimum macOS version remain compatible with the current DeepChat architecture.

## Goals

1. Pin and attest the exact `cua-driver-rs-v0.17.0` release assets.
2. Update the exact embedded handshake from driver/contract `0.14.1/0.2.0` to `0.17.0/0.6.0`.
3. Keep catalog generation and closed policy coverage exact for every supported target.
4. Fail closed before dispatch when a native element action uses a bare `element_index`.
5. Expose bounded, typed `ActionResult` and `verify_state` facts to the model without promoting
   arbitrary runtime prose or raw application content.
6. Make the packaged Computer Use loop consume action effects and perform deterministic,
   window-scoped postcondition checks when the task has an expressible predicate.
7. Preserve current runtime supervision, integrity verification, signing, and target support.

## Non-goals

- Do not add Linux arm64 support.
- Do not change the embedded daemon/proxy lifecycle or generic MCP result contract.
- Do not persist a DeepChat-owned “latest snapshot” cache or auto-inject a snapshot id.
- Do not expose raw clipboard plaintext to the model or add a new sensitive-data persistence
  path in this migration.
- Do not make `verify_state` a desktop or visual-image interpretation engine.
- Do not infer task completion from a delivered action.
- Do not sync this SDD to a GitHub issue unless explicitly requested.

## Pinned Upstream Contract

The runtime pin is:

- tag: `cua-driver-rs-v0.17.0`;
- commit: `10279552e2bbe479e367a082f78b1b98ee85a697`;
- driver version: `0.17.0`;
- contract version: `0.6.0`;
- tools-list schema version: `1`;
- capability version: `1`;
- MCP protocol version: `2025-06-18`.

The five currently supported targets remain `darwin/arm64`, `darwin/x64`, `win32/x64`,
`win32/arm64`, and `linux/x64`. `linux/arm64` remains explicitly unsupported even if upstream
publishes an asset.

## Tool Policy

Every target-local catalog tool must have one explicit policy entry after platform scoping. The
five new cross-platform tools use these reviewed defaults:

| Tool | Policy | Reason |
| --- | --- | --- |
| `verify_state` | `allow` | Bounded, read-only observation of one exact window |
| `set_window_frame` | `ask` | User-visible window mutation |
| `invoke_menu` | `ask` | User-visible native action that can trigger consequential commands |
| `clipboard_write` | `ask` | Mutates privacy-sensitive shared system state |
| `clipboard_read` | `deny` | Can return privacy-sensitive plaintext that DeepChat currently persists as raw MCP structured content |

Explicit denial keeps the tool in the closed catalog and policy while preventing an accidental
sensitive-data path. Enabling reads later requires a separate design for consent, bounded
model-facing projection, transcript persistence, export, and retention.

## Snapshot-safe Element Addressing

The affected native tools are `click`, `double_click`, `right_click`, `type_text`, `press_key`,
`set_value`, and `scroll`.

DeepChat must preserve these invariants:

- prefer the non-empty opaque `element_token` from the latest `get_window_state` for the same
  process and window;
- an index fallback is valid only as the pair `element_index + snapshot_id` from that same result;
- a bare `element_index` fails locally before the runtime call;
- an empty or whitespace-only optional token is still removed so it cannot override another
  addressing mode;
- the adapter never guesses, caches, or injects a “latest” snapshot id;
- pixel-coordinate actions remain valid when no `element_index` is supplied;
- conflicting token/index/snapshot/window inputs are left for the pinned runtime to reject;
- an addressing refusal causes at most one fresh snapshot and one retry with handles from that
  new snapshot. No field from the rejected snapshot may be reused.

`get_window_state` model projection must label the exact pair explicitly. The projected token map
is capped at 256 bounded handles and does not duplicate the accessibility tree. When the map is
truncated, an unlisted element remains addressable through its same-result index-plus-snapshot
pair. Only the pinned 0.17 lexical snapshot/token forms whose snapshot and element-index parts
agree with the structured row enter model-visible content; this boundary check does not decode,
derive, or synthesize either opaque handle for a caller.

## ActionResult Projection

Successful upstream action tools return:

- required `effect`: `confirmed`, `partial`, `unverifiable`, `suspected_noop`, or `refused`;
- required `route`: `accessibility`, `synthetic_events`, `global_input`, `system_api`, `dom`, or
  `trusted_input`;
- optional `delivery.mode` and non-negative `delivery.delivered_count`;
- optional evidence kinds `value_readback` and `window_change`;
- optional closed escalation target/reason.

DeepChat preserves the raw structured result for protocol fidelity and app diagnostics, then
appends a typed, bounded projection to model-visible content only for the reviewed action-tool
set. The projection accepts only closed enum values and numeric bounds. It emits no arbitrary
runtime strings and deduplicates the two possible evidence kinds. A non-error action response that
does not satisfy the reviewed shape appends a fixed contract-validation warning, so legacy result
text cannot silently become evidence of success.

Semantics:

- `confirmed` means the driver has action-specific evidence, not that the user's whole task is
  complete;
- `partial`, `unverifiable`, and `suspected_noop` require observation or recovery before another
  consequential step;
- `refused` is not success;
- delivery only describes dispatch and must not be treated as effect or task completion;
- escalation is advice constrained by current session policy, not permission to broaden scope.

Structured refusal projection remains supported for error results such as stale or malformed
snapshot handles, because those errors occur before a successful `ActionResult` is published.

## Verification Projection and Loop

`verify_state` verifies one exact `(pid, window_id)` against one to eight bounded predicates. Its
aggregate status is `satisfied`, `unsatisfied`, or `unknown`, and `unknown` never means success.

DeepChat projects only:

- aggregate `status`, `stable`, `elapsed_ms`, and `samples`;
- at most eight predicate indices, statuses, and closed `unknown_reason` values.

The upstream `observed_json` field is deliberately not promoted because it can contain application
text and is unnecessary for control-flow decisions. Raw structured content remains available to
the product diagnostics path. A non-error `verify_state` response that violates this shape appends
a fixed warning and cannot be interpreted as verification success.

The Computer Use loop uses `verify_state` after an action only when the requested postcondition is
expressible as a window existence/bounds predicate or trusted native element existence/value/
enabled/selected predicate. It treats success as `status="satisfied"` and `stable=true`. For
desktop scope, browser DOM, canvas, video, screenshots, or other visual effects, it uses a fresh
`get_desktop_state`, `get_browser_state`, or `get_window_state` as appropriate instead.

## Packaging and Compatibility

The existing release-asset staging and integrity model remains unchanged:

- verify `checksums.txt` and each selected archive SHA-256;
- validate the archive layout and executable identity;
- generate the target-local catalog using `dump-docs --type mcp --pretty`;
- scope platform-specific policy entries before exact catalog comparison;
- keep the DeepChat-owned macOS helper name, bundle id, entitlement allowlist, load-path checks,
  re-signing order, and notarization gates;
- keep only the unsigned primary Windows driver and the existing Linux binary layout.

The version/contract values intentionally remain duplicated in source manifest and packaging
validation so packaging fails if the source declaration drifts from the reviewed host contract.

## Acceptance Criteria

- The exact `0.17.0/0.6.0` embedded handshake starts; older or mismatched metadata is rejected.
- All five new tools are present with the reviewed policy, and target-local package policy equals
  the generated catalog exactly.
- Empty tokens are removed, bare indices fail before dispatch, and index-plus-snapshot or token
  inputs are preserved unchanged.
- Model-visible action and verification projections are closed, bounded, injection-resistant, and
  covered for valid and malformed inputs; malformed non-error results fail closed visibly.
- The skill requires current snapshot handles, distinguishes delivery/effect/completion, and uses
  `verify_state` only for supported window predicates.
- Focused adapter, ToolManager, plugin, embedded-runtime, catalog, integrity, and packaging tests
  pass.
- Formatting, i18n validation, lint, Node/Web type checks, CUA plugin validation, and a host-native
  CUA bundle/verify run pass where the current machine can execute the release binary.
- Native Windows/Linux behavior, macOS x64, and release-signed/notarized macOS remain explicit
  release gates unless run in their matching environments.

## Rollback

Rollback requires reverting the version/contract pin, all release hashes, the five policy entries,
model projections, snapshot argument guard, skill contract, and regenerated catalog as one unit.
Mixing a `0.17.0` binary with the `0.14.1` handshake or skill is intentionally unsupported and
must fail closed rather than degrade silently.
