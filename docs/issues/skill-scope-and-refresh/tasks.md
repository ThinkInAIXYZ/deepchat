# Tasks

- [x] Update skill tool view path so agent `skill_view` does not persist active skills.
- [x] Add runtime activation context for effective skills during a generation loop.
- [x] Refresh tools using effective manual + runtime skills.
- [x] Refresh leading system prompt after runtime skill activation.
- [x] Stop representing runtime activation as conversation-pinned state in tool output and prompts.
- [x] Add/adjust tests for message-scoped activation semantics.
- [x] Add message-scoped `SendMessageInput.activeSkills` plumbing.
- [x] Change composer skill selection to local message draft state instead of session active state.
- [x] Send/queue/steer/create first-turn messages with composer skills and clear chips after submit.
- [x] Initialize runtime effective skills from message active skills and persist them on the user message record.
- [x] Preserve `activeSkills` when user messages are materialized from normalized message tables.
- [x] Display message-scoped skills on the corresponding user message item and cover it with renderer tests.
- [x] Move message-scoped skill chips out of the message bubble and restyle them as subtle message metadata.
- [x] Add renderer/runtime tests for composer message-scoped skills.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after the visibility fix.

- [x] Address review feedback for active skill fallback data, wording, refresh parameter flow, and composer naming clarity.
- [x] Strengthen process stream coverage for hook-backed message-scope skill activation refresh.
