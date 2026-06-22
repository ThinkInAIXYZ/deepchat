# Session Title Generation

Status: implemented
Date: 2026-06-22

## User Need

New sessions should asynchronously replace the initial message snippet title with a generated title
after the first turn finishes.

## Current Behavior

After session creation became non-blocking, title generation can observe the session as `idle`
before the first message has been persisted, find no title messages, and exit without retrying.

## Acceptance Criteria

- Title generation waits until the first persisted title messages exist and the session is idle.
- Title generation stays asynchronous and does not block `createSession`.
- User-edited titles are not overwritten.
- No new dependencies.

## Non-goals

- Changing the title-generation prompt.
- Retrying title generation forever.

## Open Questions

None.
