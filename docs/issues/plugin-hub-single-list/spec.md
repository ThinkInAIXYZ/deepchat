# Plugin Hub Single List

## User Need

The plugin hub should avoid a separate Added section and search field while the plugin catalog is small.

## Goal

Show one available plugin list, with enabled plugins first, clear action labels, and highlighted enabled state.

## Acceptance Criteria

- The standalone Added section is removed.
- The search input is removed.
- Enabled plugins sort before disabled plugins.
- Enabled plugin action button says `管理`.
- Disabled plugin action button says `添加`.
- Enabled status badges use a highlighted color.
- Completed SDD folders keep only `spec.md`.

## UI Sketch

Before:

```text
[Search plugins] [Refresh]

已添加
[CUA icon]

可用插件
[CUA] [管理] [已启用]
[Telegram] [管理] [未启用]
```

After:

```text
插件                                      [Refresh]

可用插件
[CUA]      [管理] [已启用 highlighted]
[Telegram] [添加] [已停用]
```

## Constraints

- Keep the change renderer-only.
- Do not add new plugin category support.

## Non-Goals

- Redesigning plugin cards.
- Adding search back behind a feature flag.

## Open Questions

- None.
