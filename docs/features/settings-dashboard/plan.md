# Plan

## Data Model

- Add `deepchat_usage_stats` keyed by `message_id`.
- Store final per-message usage snapshots:
  - session, provider, model
  - input/output/total tokens
  - cached input tokens
  - estimated USD cost
  - local usage date
  - source (`backfill` or `live`)

## Backfill

- Trigger in `AFTER_START` with a non-blocking hook.
- Scan only `deepchat_messages` joined with `deepchat_sessions`.
- Use message metadata provider/model first, then session fallback.
- Persist backfill status in config under `dashboardStatsBackfillV1`.
- Re-running is safe because stats rows are upserted by `message_id`.

## Live Recording

- Extend stream usage metadata with optional `cached_tokens`.
- Persist cached input tokens into assistant message metadata.
- Upsert stats from `DeepChatMessageStore.finalizeAssistantMessage` and `setMessageError`.

## Dashboard Query

- Expose `agentSessionPresenter.getUsageDashboard()`.
- Aggregate summary, 365-day calendar, provider breakdown, and model breakdown from `deepchat_usage_stats`.

## UI

- Add `DashboardSettings.vue` as a scrollable settings page.
- Keep the visual language aligned with the current project theme.
- Show loading, empty, running backfill, and failed backfill states.
- Render four summary cards only; remove the cache hit rate card from the dashboard overview.
- Adopt the official `shadcn-vue chart` component with `Unovis` for dashboard chart rendering.
- Rebuild the overview layout as `1 large + 3 small`, with total tokens as the hero chart.
- Replace the total-token number card with a donut-based hero chart that visualizes input/output ratio.
- Visualize cached input tokens with a compact horizontal stacked bar for cached versus uncached input.
- Visualize estimated cost with a 30-day area chart while keeping the total cost as the primary value.
- Reuse `recordingStartedAt` to render a locale-specific, number-first "days with DeepChat" summary card in the renderer.
- Keep provider/model ranking queries unchanged, but render them as horizontal token bar charts with internal scrolling.
- Translate changed dashboard copy per locale instead of falling back to English sentence structure.
