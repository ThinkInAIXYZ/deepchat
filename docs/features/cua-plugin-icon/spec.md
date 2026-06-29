# CUA Plugin Icon

## User Need

The CUA Computer Use official plugin should be easier to recognize in the plugin hub and detail page.

## Goal

Use `lucide:laptop-minimal-check` for `com.deepchat.plugins.cua` instead of the generic puzzle icon.

## Acceptance Criteria

- The added plugins row shows the CUA plugin with `lucide:laptop-minimal-check`.
- The plugin catalog card shows the CUA plugin with `lucide:laptop-minimal-check`.
- The CUA plugin detail header shows `lucide:laptop-minimal-check`.
- Other non-special official plugins keep the generic puzzle icon.

## UI Sketch

Before:

```text
+---------------------------+
| [puzzle] CUA Computer Use |
+---------------------------+
```

After:

```text
+-----------------------------------------+
| [laptop-minimal-check] CUA Computer Use |
+-----------------------------------------+
```

## Constraints

- Keep the change renderer-only.
- Do not add a manifest icon field for a single plugin.
- Do not change plugin runtime behavior.

## Non-Goals

- Redesign plugin cards.
- Add configurable icon infrastructure.

## Open Questions

- None.
