# Manual Compaction Command Plan

## Implementation

- Add a typed `sessions.compact` route and renderer client method that returns whether a new summary
  was written plus the current compaction state.
- Extend the agent session presenter and DeepChat agent implementation with `compactSession`.
- Add a manual compaction preparation path in `CompactionService` that force-prepares an intent while
  ignoring `autoCompactionEnabled`, threshold, and retain-recent-pairs checks.
- Execute manual compaction only for idle DeepChat runtime sessions; reuse the existing
  `applyCompactionIntent` flow for persisted indicator messages and compaction events.
- Add a local DeepChat slash command item for idle existing sessions. Filter only this item during
  generation.
- Intercept exact `/compact` submissions in `ChatPage` and call the session route instead of
  `chat.sendMessage`.

## Compatibility

- No database schema migration is required.
- Existing summaries remain valid and are updated through the existing compare-and-set summary path.
- ACP sessions keep their existing command discovery and prompt forwarding behavior.

## Tests

- Unit-test manual intent creation in `CompactionService`.
- Unit-test `AgentRuntimePresenter.compactSession` success and unsupported states.
- Cover the typed route contract and route dispatcher.
- Cover renderer suggestion visibility and ChatPage command interception.
