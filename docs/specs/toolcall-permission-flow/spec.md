# Tool Call Rendering + Permission Flow

## User Stories
- As a user, I want tool call params/output rendered as code blocks without secondary parsing so complex payloads are readable and consistent.
- As a user, I want permission requests to appear only while unresolved and disappear once resolved, leaving a single tool call block as the final record.
- As a user, I want tool call code blocks to be lazy-rendered so expanding a block does not cause unnecessary performance costs.
- As a developer, I want clearer logging around think-content state changes to debug transient UI toggling.

## Business Value
- Reduces UI complexity and parsing errors for increasingly complex tool call payloads.
- Improves UX clarity by preventing stale permission request blocks from persisting in history.
- Avoids unnecessary render work for collapsed tool call blocks.

## Scope
- Tool call message block rendering in renderer.
- Permission-request block lifecycle and its persistence in message content.
- Basic logging for think-content state transitions.

## Non-Goals
- No new permission UX design changes.
- No new backend policy logic.
- No refactor of unrelated message block types.

## Acceptance Criteria
- Tool call params and responses render via Monaco-based code blocks, without JSON parsing or field extraction.
- Code block rendering is lazy: no Monaco editor is created until the tool call block is expanded.
- Language selection:
  - Params default to JSON (raw string shown).
  - Responses prefer JSON, then plaintext.
  - Terminal-like tools render as shell/bash; Windows uses PowerShell based on device info.
- Permission request block is persisted only while unresolved; once resolved, it is removed from stored content and the tool call block is updated by ID.
- Think-content logs include enough context to trace type/content changes during streaming; final data remains unchanged.

## Open Questions
- None.
