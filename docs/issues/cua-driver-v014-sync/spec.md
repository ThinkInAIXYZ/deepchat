# CUA Driver v0.1.4 Sync Spec

## Goal

Sync the vendored DeepChat CUA driver fork with upstream `trycua/cua`
`cua-driver-v0.1.4` while preserving DeepChat-specific runtime behavior and local
skill customizations.

## Acceptance Criteria

- Vendored upstream metadata points to tag `cua-driver-v0.1.4` and commit
  `d422294b848afec99b979ac1229446c83fa44807`.
- Removed upstream tools `get_accessibility_tree` and `type_text_chars` are no
  longer advertised by the DeepChat plugin manifest or policy.
- `type_text` remains the text-entry tool and supports upstream automatic CGEvent
  fallback behavior.
- DeepChat fork patches remain intact:
  `DeepChatPermissionProbeCommand`, `DeepChat Computer Use.app`,
  `com.wefonk.deepchat.computeruse`, non-blocking MCP/daemon startup,
  DeepChat-managed update messaging, and window-scoped zoom contexts.
- DeepChat-owned plugin skill files receive only minimal compatibility edits for
  removed tool names.

## Non-Goals

- Do not expose a second Claude Code compatibility MCP server in the DeepChat plugin.
- Do not rewrite or replace local DeepChat skill content with upstream skill text.
- Do not change user-facing plugin UX beyond the upstream driver compatibility
  surface required for this sync.
