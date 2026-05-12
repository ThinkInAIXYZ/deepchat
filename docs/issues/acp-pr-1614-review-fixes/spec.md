# ACP PR 1614 Review Fixes

## Problem

PR review feedback on the ACP client runtime changes found several small reliability and consistency issues that should be fixed before merge.

## Acceptance Criteria

- Terminal cwd values supplied by ACP agents are resolved relative to the active session workdir when they are not absolute, and cwd escapes still fall back safely.
- ACP session initialization cleanup preserves the original initialization error even if unbinding fails.
- Persisted ACP session hook disposal cannot prevent fallback to `newSession`.
- ACP connection initialization clears its timeout handle after `Promise.race` settles.
- ACP turn persistence awaits start and finish writes and reports persistence failures instead of silently dropping them.
- ACP event types use the shared contract as the source of truth.
- Newly added lifecycle event labels are localized for reviewed locales.

## Non-goals

- No broad ACP behavior redesign.
- No full localization rewrite outside the reviewed lifecycle labels.
- No database schema changes beyond the existing ACP turn persistence shape.
