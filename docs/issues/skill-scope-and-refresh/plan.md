# Plan

## Approach

Split skill state into three semantics:

1. Explicit/manual session activation remains pinned state backed by `SkillPresenter.setActiveSkills` and `new_sessions.active_skills`.
2. Composer-selected skills are message-scoped. The chat input keeps a local draft skill list, submits it with the next message as `SendMessageInput.activeSkills`, then clears the local list after successful submit/queue/steer/create-session.
3. Agent `skill_view` root activation is runtime/message-loop state. The tool returns activation metadata, and the agent runtime keeps a per-generation/per-session set of runtime-activated skill names for the active message loop.

Do not overload `isPinned` for runtime activation. `isPinned` must mean persisted/manual session pin only. Agent tool results may add separate fields such as `activatedForMessage`, `activationScope`, and `activeForCurrentMessage` to communicate runtime activation without polluting pinned semantics.

When a message starts with composer active skills, initialize the runtime effective skill set with `manual session skills + message active skills`. When runtime activation changes the effective skill set, refresh both tools and the leading system prompt before the next provider request.

## Affected Interfaces

- `SendMessageInput`: add optional `activeSkills?: string[]` for message-scoped composer skill context.
- Route schemas for chat send/steer/pending inputs: accept `activeSkills`.
- `CreateSessionInput`: keep `activeSkills` for compatibility but treat it as initial-message active skills, not session pinning.
- `ChatInputBox` / `useSkillsData`: make selected skills local composer state for existing conversations and expose consume/snapshot helpers.
- `ChatPage` / `NewThreadPage`: include consumed composer skills in submitted message payload and clear after successful submit.
- `AgentSessionPresenter`: stop persisting create-session `activeSkills`; pass them into the initial message payload.
- `AgentRuntimePresenter`: initialize runtime message skills from normalized input, persist them on the user message record, materialize them back from normalized user-message tables, and include them in prompt/tool loading for that message loop.
- `SkillTools.handleSkillView`: support viewing without presenter-side activation for agent runtime calls.
- `AgentToolManager`: derive `activationApplied` from runtime active skill context instead of persisted active skills, and return message-scoped activation metadata without setting `isPinned` to true.
- System/tool prompts: replace pinned wording for automatic `skill_view` activation with message-scoped activation wording.

## Data Flow

- Composer skill selection updates local input state only.
- Submit path consumes local selected skills and sends `{ text, files, activeSkills }`.
- New session creation passes active skills inside the initial message payload and does not call `setActiveSkills`.
- Runtime start resets runtime activated skills, adds message-scoped active skills, then computes effective skills = session-pinned + message/runtime active.
- User message content stores `activeSkills` so the message context is visible/auditable and retry can reuse it. The normalized materialization path must preserve the raw message-scoped `activeSkills` because the structured `deepchat_user_messages` table stores text/search/think but not skill names.
- `skill_view` root call returns `activatedSkill` when the viewed skill is not already effective.
- Runtime callback adds it to the local runtime set for the active message loop.
- Tool refresh uses `manual + message/runtime` effective skills.
- System prompt refresh rebuilds with the same effective skill set and replaces the first system message in the active conversation messages.
- Tool output keeps `isPinned` equal to the persisted/manual pin state and reports runtime activation separately.

## Compatibility

- Existing manual active skills remain stored in `new_sessions.active_skills`.
- Existing `skill_view` route behavior outside agent runtime remains read-only unless explicitly using session active APIs.
- Existing skill_run scripts remain gated by active skill names, now including message/runtime activation for the current loop.
- Existing consumers of `isPinned` can continue treating it as pinned/session state.
- Existing stored messages without `activeSkills` continue to parse as empty message-scoped skills.

## Test Strategy

- Unit-level tests for `SkillTools.handleSkillView` avoiding persisted activation.
- Unit-level tests for `AgentToolManager` activation metadata and non-pinned output.
- Unit-level tests for `processStream` refreshing tools and system prompt after runtime activation.
- Runtime tests ensuring `SendMessageInput.activeSkills` influences initial prompt/tools but does not persist session active skills.
- Renderer tests ensuring composer skills clear after submit, are sent in the message payload, and appear on the corresponding user message item.
- Message store tests ensuring materialized user message content preserves `activeSkills` from the raw message JSON.
- Run targeted tests plus required repository checks: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.
