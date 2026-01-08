# Tool Call Rendering + Permission Flow

## User Stories
- As a user, I want tool call params and responses rendered as raw code blocks without complex JSON parsing, making increasingly complex payloads easier to read and consistent with other code displays.
- As a user, I want permission request blocks to appear only while unresolved and disappear once resolved, leaving a single tool call block as the final record.
- As a user, I want tool call code blocks to be lazy-rendered so expanding a block doesn't cause unnecessary performance costs.
- As a developer, I want clearer logging around think-content state changes to debug transient UI toggling.

## Business Value
- Reduces UI complexity and parsing errors for increasingly complex tool call payloads.
- Improves UX clarity by preventing stale permission request blocks from persisting in message history.
- Avoids unnecessary render work for collapsed tool call blocks, improving performance.
- Better debugging capability for think-content state issues.

## Scope
- Tool call message block rendering in renderer
- Permission-request block lifecycle and its persistence in message content
- Basic logging for think-content state transitions
- Device platform detection for PowerShell vs shell language selection

## Non-Goals
- No new permission UX design changes
- No new backend policy logic
- No refactor of unrelated message block types
- No permission request migration from old data (only affects new messages)

## Acceptance Criteria
- Tool call params and responses render via Monaco-based code blocks, without JsonObject parsing or field extraction
- Code block rendering is lazy: no Monaco editor is created until tool call block is expanded; editors are disposed when collapsed
- Language selection rules:
  - Params always use JSON (raw string shown)
  - Responses prefer JSON, then fallback to plaintext
  - Terminal-like tools render as shell/bash; Windows uses PowerShell based on device info
- Copy buttons are preserved for both params and responses
- Permission request block is persisted only while unresolved; once resolved, it is removed from stored content and tool call block is updated by ID
- Think-content logs include enough context to trace type/content changes during streaming
- Device platform is cached once in upgrade store and reused for language detection
- Final stored messages contain only tool_call blocks (no action type permission blocks)

## Open Questions
- None
