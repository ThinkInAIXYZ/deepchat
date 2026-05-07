# CUA Driver v0.1.4 Sync Plan

## Approach

Apply the upstream `libs/cua-driver` delta from `cua-driver-v0.0.15` to
`cua-driver-v0.1.4`, then re-apply DeepChat fork patches where conflicts overlap.
Keep the DeepChat plugin MCP server configured as the normal `cua-driver` server.

## Compatibility

- Remove removed upstream tools from plugin policy and manifest:
  `get_accessibility_tree`, `type_text_chars`.
- Keep `type_text` approved for text input and document its `delay_ms` fallback
  path in local skills.
- Preserve DeepChat TCC ownership and app bundle identity throughout the driver,
  helper build scripts, diagnostics, and permission flows.
- Preserve the DeepChat-owned update path; the bundled helper must not install
  standalone upstream releases.

## Validation

- Build the Swift package from the vendored driver source.
- Run focused plugin presenter and packaging/signing tests.
- Run repository formatting, i18n, and lint checks after implementation.
- Inspect protected files for accidental skill or fork-patch regressions.
