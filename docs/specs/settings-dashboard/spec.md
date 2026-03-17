# Settings Dashboard

## Goal

Add a dedicated dashboard page under settings to show token usage, cached token usage, estimated cost, and a GitHub-like contribution calendar.

## User Stories

- As a user, I want to see my total token usage, cached token usage, and estimated cost in one place.
- As an existing user, I want the dashboard to initialize from the current `deepchat_messages` table once, without scanning legacy tables.
- As a user, I want the dashboard to keep growing from newly recorded usage without repeatedly recomputing from old chat tables.

## Acceptance Criteria

- A new settings route named `settings-dashboard` is available after provider settings.
- The dashboard reads from a dedicated `deepchat_usage_stats` table only.
- Existing users get a one-time background backfill from current `deepchat_messages`.
- Historical backfill sets cached input tokens to `0`.
- New assistant message finalization and error finalization upsert usage rows into `deepchat_usage_stats`.
- Price estimation uses current provider pricing first and falls back to `aihubmix` for the same model id when needed.
- The page contains four overview cards: a total-token ring card, a cached-token ratio card, an estimated-cost trend card, and a days-with-DeepChat card.
- The total-token ring card visualizes input/output token composition and shows exact values plus percentages.
- The cached-token card visualizes cached versus uncached input tokens and shows exact values plus percentages.
- The estimated-cost card shows the total estimated cost plus a lightweight 30-day trend sparkline.
- The "days with DeepChat" card is derived from the earliest recorded usage date and rendered in a number-first, locale-specific layout.
- The page contains a 365-day contribution calendar and provider/model breakdowns.
- Provider and model breakdown cards support internal scrolling without growing the full page indefinitely.

## Non-Goals

- No backfill from legacy `messages` or `conversations` tables.
- No delete-triggered rollback of accumulated usage stats.
- No additional day-level rollup table in v1.
