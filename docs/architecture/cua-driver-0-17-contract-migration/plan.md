# CUA Driver 0.17 Contract Migration Plan

## Status

Implementation and host-native validation are complete. Native cross-platform and release-signing
gates remain pending.

## 1. Freeze the reviewed contract

- Record the exact upstream tag, commit, contract metadata, supported targets, tool additions, and
  breaking semantics.
- Keep clipboard reads denied until DeepChat has an explicit sensitive-result lifecycle.
- Define closed, bounded model projections and the snapshot-addressing invariant.

## 2. Update the release and host handshake

- Replace the pinned tag, commit, release URL, checksums asset hash, archive names, and archive
  hashes in `upstream.json`.
- Update the manifest and package-time embedded adapter contract to driver `0.17.0` and contract
  `0.6.0`.
- Keep tools-list schema, capability version, MCP protocol, supported targets, and runtime layout
  unchanged.

## 3. Close the new tool surface

- Add the five new tools to both policy copies with the reviewed defaults.
- Regenerate target-local catalogs from the pinned native release binary.
- Retain strict package failure for missing or extra policy entries after platform scoping.

## 4. Adapt element arguments

- Continue removing only an empty optional `element_token` on the seven affected native tools.
- Add a pure guard that rejects a remaining bare `element_index` before dispatch.
- Preserve valid token, index-plus-snapshot, pixel, zero-valued, and unrelated arguments.
- Add unit and ToolManager dispatch tests for all modes.

## 5. Adapt model-visible results

- Project the closed `ActionResult` fields only for the reviewed action-tool set.
- Project bounded `verify_state` control facts without `observed_json`.
- Preserve existing window-handle, browser-chrome, and structured-refusal projections.
- Test valid shapes, enum drift, malformed nested values, bounded evidence, and composition with
  existing MCP content.

## 6. Update the Computer Use contract

- Require `element_token` or `element_index + snapshot_id` from the latest same-window snapshot.
- Add all relevant snapshot refusal codes and one-refresh/one-retry recovery.
- Explain `ActionResult` effect, route, delivery, evidence, and escalation semantics.
- Add deterministic `verify_state` to the post-action loop only for supported window/native AX
  predicates; retain fresh state tools for desktop, browser DOM, canvas, and visual checks.
- Document the new window/menu tools and the conservative clipboard policy.

## 7. Validate and review

- Run focused adapter, ToolManager, plugin, runtime, catalog, integrity, build-runtime, and package
  tests first.
- Build, validate, and verify the host-native CUA plugin artifact.
- Run formatting, i18n, lint, Node/Web type checks, and the appropriate broader suites.
- Review the complete diff for hidden side effects, backward compatibility, edge cases,
  performance, security, misleading names, missing tests, and maintenance cost.
- Sort findings by severity, fix every real finding, rerun affected validation, and only then
  create one concrete Conventional Commit. Do not push.
