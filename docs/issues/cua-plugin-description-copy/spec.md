# CUA Plugin Description Copy

## User Need

The CUA plugin should describe what it is instead of showing `DeepChat · com.deepchat.plugins.cua`.

## Goal

Show localized copy meaning: DeepChat's ComputerUse plugin implemented based on `trycua/cua`.

## Acceptance Criteria

- CUA plugin detail subtitle uses the localized description.
- CUA plugin catalog card uses the same localized description.
- Non-CUA plugins keep their existing description behavior.
- Completed SDD folders keep only `spec.md`.

## UI Sketch

Before:

```text
CUA Computer Use Runtime
DeepChat · com.deepchat.plugins.cua
```

After:

```text
CUA Computer Use Runtime
DeepChat 基于 trycua/cua 项目实现的 ComputerUse 插件
```

## Constraints

- Use i18n for user-facing copy.
- Do not add a manifest field for one plugin.

## Non-Goals

- Redesigning the plugin detail header.
- Changing plugin runtime metadata.

## Open Questions

- None.
