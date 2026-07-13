# Plugin Hub Available Title

## User Need

The plugin hub should not show Official, Workspace, and Personal tabs before those plugin categories are supported.

## Goal

Replace the unused category tabs with a single `可用插件` heading.

## Acceptance Criteria

- The plugin catalog section shows a localized "Available plugins" heading.
- Official, Workspace, and Personal filter tabs are not rendered.
- Plugin search still filters the available catalog items.
- Completed SDD folders keep only `spec.md`.

## UI Sketch

Before:

```text
[DeepChat 官方] [工作区] [个人]
+--------------------+ +--------------------+
| CUA                | | 飞书 / Lark        |
+--------------------+ +--------------------+
```

After:

```text
可用插件
+--------------------+ +--------------------+
| CUA                | | 飞书 / Lark        |
+--------------------+ +--------------------+
```

## Constraints

- Keep this renderer-only.
- Do not add workspace/personal plugin category behavior.

## Non-Goals

- Redesigning plugin cards.
- Adding plugin source classification.

## Open Questions

- None.
