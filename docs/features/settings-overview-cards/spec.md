# Settings Overview Cards

## User Story

As a user opening Settings Overview, I want the top status cards and setup panels to reflect the destinations and current setup state clearly, so I can jump to the right settings page quickly.

## Acceptance Criteria

- The top Providers, MCP, Knowledge, and data status cards are clickable and navigate to their corresponding settings pages.
- The data status card label is "Last backup time" in English and "最后备份时间" in Chinese.
- The Needs attention panel is removed from the overview.
- The usage dashboard nostalgia card ("前尘往事") appears beside Quick start on the overview, and the dashboard copy below does not duplicate it.
- Quick start tasks that are complete show a green check icon; incomplete tasks keep their configured icon.
- Recent changes appears at the bottom of the overview and is renamed Recent settings changes.

## Non-goals

- No changes to settings persistence, usage aggregation, backup behavior, or MCP/provider configuration.
- No new IPC routes.

## Constraints

- Keep user-facing strings in i18n files.
- Preserve existing dashboard loading and refresh behavior.
