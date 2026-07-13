# PR 1818 Plugin Review Fixes

## User Need

Review comments on PR #1818 identify a few plugin-page issues that should be fixed before merge when they are directly related to the recent Plugins Hub work.

## Goal

Apply the low-risk plugin-page review fixes that keep the current PR focused:

- Refresh the embedded Feishu remote settings after the official Feishu plugin is enabled or disabled from the detail page header.
- Make plugin component tests assert concrete localized strings instead of raw i18n keys for titles, headings, and action labels.

## Acceptance Criteria

- The official Feishu plugin detail page remounts its embedded `RemoteSettings` after the top enable or disable action updates Feishu remote settings.
- `PluginsCatalogPage` tests use distinct translated values for asserted catalog title, heading, status, and action label keys.
- `OfficialPluginDetailPage` tests use distinct translated values for asserted title and action button keys.
- Existing plugin catalog and official plugin detail tests pass.
- `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` pass.

## Constraints

- Keep the diff scoped to PR #1818 plugin-page review comments.
- Preserve existing Vue 3 Composition API and i18n patterns.
- Do not mix larger SkillPresenter, SkillSyncPresenter, or git-install hardening work into this fix.

## Non-Goals

- No changes to skill install rollback behavior.
- No changes to agent skill adoption/link cleanup.
- No changes to git repository validation.
- No layout redesign.

## Open Questions

None.
