# Mock Long Chat Debug Data

## User Story

Developers need a development-only control that creates a large realistic chat session in the local database so the virtualized chat window and full-data search counting can be verified without manually chatting for hundreds of messages.

## Acceptance Criteria

- The About settings page shows a mock chat data button only in dev builds.
- The main process refuses to create mock chat data in packaged builds.
- Clicking the button creates one regular chat session with 100 user messages and 100 assistant messages.
- The created session uses the built-in `deepchat` agent, not a debug-only agent id.
- Mock content is rewritten synthetic text, but can reuse the current database's message shapes and block types as samples.
- Assistant messages include mixed short and long markdown plus persisted block varieties such as
  content, reasoning, search, tool call, action, image, artifact thinking, and error. Agent plans are
  transient progress state and are not persisted into mock assistant history.
- The inserted session appears in the session list without restarting the app.
- The flow reports success or failure clearly to the developer.

## Non-Goals

- No release-visible debug UI.
- No hidden migration, seed data, or automatic fixture generation.
- No broad data factory or generalized import/export framework.

## Constraints

- Keep the implementation small and aligned with existing typed route/client patterns.
- Avoid copying user database content verbatim; sample structure only and rewrite text.
- Do not add excessive fallback layers.
