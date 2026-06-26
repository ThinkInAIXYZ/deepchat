# Plan

## Implementation

- Add the remote icon color map to `OfficialPluginDetailPage.vue`, matching `PluginsCatalogPage.vue`.
- Use the Feishu remote icon/color for `com.deepchat.plugins.feishu` in the official plugin detail header.
- Bind remote detail header icons to both icon name and color class.
- Use the Feishu remote i18n title for the official Feishu plugin in catalog and detail headers.

## Affected Interfaces

- Renderer-only Vue template/computed state.
- No IPC, presenter, or persisted data changes.

## Test Strategy

- Add focused renderer tests for Feishu official detail icons/titles and catalog title localization.
- Run format, i18n, lint, and the focused renderer test.
