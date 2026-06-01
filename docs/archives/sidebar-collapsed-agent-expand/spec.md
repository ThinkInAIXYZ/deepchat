# Sidebar Collapsed Agent Expand

## User need

When the sidebar is collapsed, clicking the Agent rail should provide visible feedback and access to the selected Agent's conversation list. The current behavior only switches the selected Agent while the session column remains hidden, making the click feel ineffective.

## Goal

In the first phase, clicking either the All Agents button or a specific Agent button while the sidebar is collapsed expands the sidebar and keeps the existing Agent selection behavior.

## Acceptance criteria

- When the sidebar is collapsed, clicking All Agents expands the sidebar.
- When the sidebar is collapsed, clicking any Agent expands the sidebar.
- Existing Agent selection semantics remain unchanged:
  - selecting a different Agent closes the active session first and then selects that Agent;
  - clicking the currently selected Agent toggles back to All Agents;
  - expanded-sidebar Agent clicks behave the same as before.
- Existing collapse/expand toggle button behavior remains unchanged.
- Component coverage verifies the collapsed Agent click path.

## Constraints

- Keep the change renderer-local and focused on `WindowSideBar`.
- Do not introduce a quick-list popover in this phase.
- Avoid new user-facing strings unless required.
- Preserve current session switching order and error handling.

## Non-goals

- Implementing a compact Agent quick list.
- Redesigning sidebar layout or width.
- Changing Agent/session data models or persistence.

## Open questions

None.
