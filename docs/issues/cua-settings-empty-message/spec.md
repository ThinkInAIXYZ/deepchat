# CUA Settings Empty Message

## User Story

As a user checking Computer Use plugin permissions, I want the plugin settings page to show the
permission results only in the status rows so that a completed check does not leave an unrelated
`Unknown` message at the bottom of the page.

## Acceptance Criteria

- A successful permission check updates the Accessibility and Screen Recording rows.
- After a successful permission check with no diagnostic error, the bottom message area is empty.
- Runtime fields can still show `Unknown` when their underlying status values are unavailable.

## Non-goals

- Redesigning the plugin settings layout.
- Changing runtime or permission detection behavior.

## Open Questions

None.
