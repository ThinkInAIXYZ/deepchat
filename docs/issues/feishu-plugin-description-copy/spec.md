# Feishu Plugin Description Copy

## User Need

The Feishu/Lark plugin should describe its actual remote-control purpose instead of showing `DeepChat · com.deepchat.plugins.feishu`.

## Goal

Use the existing Feishu remote-control description for the official Feishu/Lark plugin in catalog and detail views.

## Acceptance Criteria

- Feishu/Lark plugin catalog description uses `settings.remote.feishu.description`.
- Feishu/Lark plugin detail subtitle uses `settings.remote.feishu.description`.
- zh-CN Feishu remote description names `飞书 / Lark Bot`.
- Other non-special official plugins keep the publisher/id fallback.
- Completed SDD folders keep only `spec.md`.

## UI Sketch

Before:

```text
飞书 / Lark
DeepChat · com.deepchat.plugins.feishu
```

After:

```text
飞书 / Lark
接入飞书 / Lark Bot，支持私聊、群聊和会话远程控制。
```

## Constraints

- Reuse existing i18n copy instead of adding duplicate plugin-specific Feishu strings.
- Do not change plugin manifest metadata.

## Non-Goals

- Redesigning plugin cards.
- Changing Feishu runtime behavior.

## Open Questions

- None.
