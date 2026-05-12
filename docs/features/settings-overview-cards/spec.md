# Settings Overview Cards

## User Story

As a user opening Settings Overview, I want the top status cards and setup panels to reflect the destinations and current setup state clearly, so I can jump to the right settings page quickly.

## Acceptance Criteria

- The top Providers, MCP, and DeepChat Agents status cards are clickable and navigate to their corresponding settings pages.
- Quick start appears as the fourth top-row card.
- The Quick start card itself is not clickable; only individual check items navigate to their target settings pages.
- The Needs attention panel is removed from the overview.
- The Last backup time metric card is removed from the overview top row.
- The usage dashboard appears immediately below the top row.
- The usage dashboard nostalgia card ("前尘往事") appears beside Token usage.
- Quick start tasks that are complete show a green check icon; incomplete tasks keep their configured icon.
- Recent changes appears at the bottom of the overview and is renamed Recent settings changes.

## Non-goals

- No changes to settings persistence, usage aggregation, backup behavior, or MCP/provider configuration.
- No new IPC routes.

## Constraints

- Keep user-facing strings in i18n files.
- Preserve existing dashboard loading and refresh behavior.
