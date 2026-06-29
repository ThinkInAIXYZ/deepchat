# Skill Scope and Refresh

## User Need

Skills selected or discovered for a task should follow the message/task chain, not remain fixed in the conversation composer or permanently pollute an entire session. When the user selects a skill in the input box, that skill should be attached to the message being sent, then cleared from the input composer. When the model calls `skill_view`, the skill can become usable for the current generation flow, but it must not be represented as conversation-pinned state unless the user manually pins it elsewhere.

## Problem

Historically, root `skill_view` automatically called `setActiveSkills`, which persisted the skill in `new_sessions.active_skills`. This made model-selected skills follow the whole session instead of the relevant message/task chain.

The first runtime-scoped fix stopped persistence for agent `skill_view`, but the user-facing composer path still used conversation active skills. Selecting a skill in the input box called `setActiveSkills` for existing sessions, stored the skill at session level, and kept the chip fixed in the input box after sending. That is semantically wrong: composer skill chips are task/message context, not global conversation pinned state.

After moving composer skills to the outgoing message payload, the message list must still preserve and render that message-scoped metadata. The normalized user-message materialization path must not drop `activeSkills` when rebuilding message content for the renderer.

In the same generation loop, skill activation must also refresh tool definitions and the system prompt so subsequent provider requests can use the activated skill immediately.

## Goals

- Keep explicit/manual session-pinned skills as session-level active skills where APIs still use `setActiveSkills`.
- Make composer-selected skills message-scoped: attach them to the next sent/queued/steered message and clear the composer chip after successful submission.
- Make model-triggered `skill_view` activation message-scoped/runtime-scoped rather than persisted to the session.
- Show message-scoped skills on the corresponding user message item so the user can see which skills were applied to that turn, without placing those chips inside the message bubble body.
- Do not report runtime activation as `isPinned: true`.
- Expose explicit activation metadata such as `activationScope: "message"` / `activatedForMessage: true` for agent `skill_view` results.
- Ensure runtime skill activation refreshes tool definitions and the active skill prompt for subsequent provider requests in the same generation loop.
- Preserve existing manual skills settings behavior and new-thread/session creation compatibility.

## Acceptance Criteria

- Calling agent tool `skill_view` for a root `SKILL.md` no longer writes to `new_sessions.active_skills`.
- The `skill_view` content for runtime activation does not claim `isPinned: true` unless the skill was manually/session pinned.
- The `skill_view` result clearly reports current-message activation when applicable.
- Selecting a skill in the chat input does not call `setActiveSkills` for the conversation.
- Sending, queueing, steering, or creating a new first-turn session with composer skills sends those skills on that message payload.
- After successful submission, composer skill chips are cleared from the input box.
- User message records preserve their message-scoped skills when they are created, materialized from normalized tables, cloned, edited, or backfilled.
- User message items display their message-scoped skills as lightweight metadata adjacent to the bubble, not inside the bubble content, and do not show them as composer/session pinned skills.
- System prompt wording distinguishes session-pinned skills from message-activated skills and does not tell the model that root `skill_view` pins a skill to the conversation.
- Subsequent provider requests in the same tool loop receive rebuilt system prompt content that includes message-scoped/runtime-activated skills.
- `skill_run` exposure after runtime activation uses the union of manually active and message/runtime-activated skills.
- Manual `setActiveSkills` continues to persist active skills at the session level.
- Relevant tests cover non-persistence, non-pinned output, message payload skills, message item visibility, and same-loop refresh behavior where practical.

## Non-goals

- Full branch/lineage-scoped persisted skill state across future turns.
- Redesigning the settings skills UI.
- Adding a new debug UI for skills.
- Changing MCP tool permissions or authentication behavior.

## Constraints

- Keep changes minimal and aligned with existing presenter boundaries.
- Avoid introducing secret logging or broad trace payloads.
- Do not remove manual session-level skill support.

## Open Questions

None.
