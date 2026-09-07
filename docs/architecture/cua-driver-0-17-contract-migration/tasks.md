# CUA Driver 0.17 Contract Migration Tasks

## Contract audit

- [x] Compare the `0.14.1` and `0.17.0` release catalogs and contract manifests.
- [x] Verify the two upstream breaking changes and five added tools against source and release
      binaries.
- [x] Trace DeepChat's manifest, packaging, runtime handshake, MCP result, tool-policy, and skill
      paths.
- [x] Decide the clipboard-read privacy boundary and model projection limits.

## Release and packaging

- [x] Pin the `0.17.0` tag, commit, release URL, asset names, and SHA-256 values.
- [x] Update both exact embedded adapter contracts to `0.17.0/0.6.0`.
- [x] Keep supported targets and platform-specific catalog scoping unchanged.
- [x] Generate, validate, and verify the host-native CUA plugin artifact.

## Tool policy

- [x] Add `verify_state=allow`.
- [x] Add `set_window_frame=ask`, `invoke_menu=ask`, and `clipboard_write=ask`.
- [x] Add `clipboard_read=deny` and document the sensitive-result rationale.
- [x] Prove both policy copies remain identical and exactly cover target catalogs.

## Model-facing compatibility

- [x] Reject bare `element_index` before runtime dispatch.
- [x] Preserve non-empty tokens, index-plus-snapshot pairs, pixels, zeros, and unrelated values.
- [x] Make the window-state projection explicitly pair indices with the projected snapshot id.
- [x] Add a closed and bounded `ActionResult` projection.
- [x] Add a closed and bounded `verify_state` projection without `observed_json`.
- [x] Preserve raw structured results and existing refusal/browser-chrome projections.

## Skill and documentation

- [x] Require current `element_token` or `element_index + snapshot_id` addressing.
- [x] Add one-refresh/one-retry handling for snapshot-addressing refusals.
- [x] Distinguish action delivery, effect, verification, and task completion.
- [x] Use `verify_state` only for expressible exact-window predicates.
- [x] Document `set_window_frame`, `invoke_menu`, and the clipboard policy.
- [x] Align the maintained CUA architecture and historical feature specifications.

## Automated validation

- [x] Adapter unit tests cover valid and malformed action/verification projections.
- [x] ToolManager tests cover local bare-index rejection and model-visible projection composition.
- [x] Plugin tests cover the new versions, hashes, policies, and skill invariants.
- [x] Embedded adapter, catalog, integrity, build-runtime, and package tests pass.
- [x] CUA plugin validation and host-native bundle/verify pass.
- [x] Formatting, i18n, lint, Node/Web typecheck, and relevant broader tests pass.

## Verification record

Completed on 2026-08-03:

- focused CUA adapter, ToolManager, and plugin tests: 133 passed;
- `pnpm run test:main`: 486 files and 5787 tests passed; 21 files and 285 tests were skipped by
  environment gates;
- `pnpm run test:renderer`: 242 files and 1978 tests passed;
- formatting, i18n, lint, Node/Web type checks, and the production build passed;
- macOS arm64 plugin bundle, validation, and verification passed with a development-signed
  artifact; its catalog reported driver 0.17.0, 54 tools, and all five added tools;
- the production prebuild rejected a provider-database refresh larger than its 5 MB limit, then
  completed normally; the generated ACP registry remained unchanged after its separate refresh.

macOS x64, Windows x64/arm64, Linux x64, native desktop action scenarios, and
release-signed/notarized macOS remain release gates.

## Commit gate

- [x] Review the full diff with findings sorted by severity.
- [x] Fix all real review findings and rerun affected validation.
- [x] Commit with a concrete Conventional Commit message.
- [x] Confirm no push was performed.
