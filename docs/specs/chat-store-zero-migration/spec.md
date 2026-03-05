# Chat Store Zero Migration

## Goal

Retire legacy renderer `chatStore` usage and switch runtime chat flow to `ui/*` stores only.

## Decisions

1. Renderer old chain components depending on `useChatStore` are removed.
2. New chat flow keeps `ui/session` + `ui/message` event listeners unchanged.
3. Backup import auto-detects DB file in zip:
   - Prefer `database/agent.db`
   - Fallback to `database/chat.db`
4. `chat.db` import behavior:
   - `increment`: legacy migration import
   - `overwrite`: clear new session/message domain tables, then migrate legacy data

## Notes

- Startup `legacyImportHook` remains enabled for local migration compatibility.
- Backup packaging format remains unchanged (`database/agent.db` as primary output).
