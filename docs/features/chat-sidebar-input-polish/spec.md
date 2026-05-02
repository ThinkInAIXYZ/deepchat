# Chat Sidebar Input Polish

## Summary
- Keep a visible `+` entry for starting a new conversation when the session sidebar is collapsed.
- Make the collapsed `+` behave exactly like the sidebar header action, including the `All Agents` fallback rules.
- Reduce the default chat input height from `80px` to `60px` while preserving the current max height and scrolling behavior.

## Acceptance Criteria
- When the chat sidebar is expanded, the existing sidebar header `+` continues to start a new conversation.
- When the chat sidebar is collapsed, a `+` button appears at the top-left of the main chat workspace.
- The collapsed `+` is available on `AgentWelcomePage`, `NewThreadPage`, and `ChatPage`.
- If `All Agents` is selected and there is no active session, clicking `+` selects the first enabled agent and opens a new thread for that agent.
- If `All Agents` is selected and there is an active session, clicking `+` keeps the current session agent and closes the session into that agent's new-thread state.
- If a specific agent is selected, clicking `+` starts a new conversation for that same agent.
- When the collapsed `+` is visible on `ChatPage`, the session header content shifts right enough to avoid overlap.
- The chat input editor keeps `max-h-[240px]` and scrolling, but its default minimum height becomes `60px`.

## Non-Goals
- No shared-element animation between the sidebar and the collapsed button.
- No changes to toolbar layout, message editor layout, or global welcome page behavior.
- No new i18n keys, IPC changes, or shared type contracts.
