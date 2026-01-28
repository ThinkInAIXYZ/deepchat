# Question Tool (Agent-to-User Choices)

> Status: Draft  
> Date: 2026-01-28

## Overview

Agents sometimes need a fast, structured way to ask the user what to do next (e.g., pick an approach or confirm an action). Free-form follow-up questions are slower and error-prone. This feature introduces a **`question` tool** that renders an in-chat question UI with common choices (single-select / multi-select), and turns the chosen option(s) into the next user message.

The `question` tool call is a **turn boundary**: it pauses the agent and waits for the user. The tool call must be **standalone** and be the **last tool call** in the assistant turn.

## Goals

- Provide an explicit `question` tool for agents to ask the user what to do next.
- Render a dedicated message block (similar to `MessageBlockPermissionRequest.vue`) with a pending/resolved state.
- Support:
  - single-select options
  - multi-select options
  - optional custom typed answer (default on)
  - explicit reject flow
- Resolution rules:
  - selecting options or submitting custom text → `replied`
  - user sends any next message manually (without interacting) → `replied` (auto-resolve)
  - user clicks reject → `rejected` (no user message is inserted)

## Non-Goals

- Multi-question wizards in a single tool call (v1 supports exactly one question per call).
- Persisting question results outside the chat transcript (chat transcript is the source of truth).
- UI customization beyond standard styling and i18n (no per-agent themes).

## User Stories

- As a user, I want the agent to present common next-step choices so I can proceed with one click.
- As a user, I want to type my own answer if none of the choices fit.
- As a user, I want to reject a question without sending a message.
- As an agent, I want the question to stop my turn and wait for the user before continuing.

## UX Notes

- Placement: the question UI renders **under the assistant message that requested it**.
- States:
  - **Asked**: shows question header/body + selectable options + optional custom input + actions.
  - **Replied**: shows question + resolved answer text; hides option buttons and inputs.
  - **Rejected**: shows question + “rejected” indicator; hides option buttons and inputs.
- Auto-resolve: if the user sends a new message while a question is pending, the question resolves to that message content (no extra user message is inserted).
- Accessibility:
  - Keyboard navigation for option selection.
  - Focus moves to the custom input when the block appears (if custom input enabled).
  - `Enter` submits (single-select or custom), `Cmd/Ctrl+Enter` submits multi-select.
- i18n: all UI strings must be i18n keys (labels like “Reject”, “Send”, “Selected”, “Rejected”).

## Tool Contract

### Tool name

`question`

### Tool call constraints

- The `question` tool call must be **standalone** (no other tool calls in the same assistant turn).
- The `question` tool call must be the **last tool call** (no tool calls after it).
- If a model violates constraints, the runtime rejects the call and surfaces an error block.

### Input schema (model → runtime)

- `header`: string (max 30 chars), short label for the question (optional)
- `question`: string, full question text (required)
- `options`: array of options (required)
  - `label`: string (max 30 chars), the text shown on the button and the value used for insertion
  - `description`: string (optional), small helper text under label
- `multiple`: boolean (default: false)
- `custom`: boolean (default: true) — allow typing a custom answer

### Output / side effects

- On `asked`: the runtime appends a **Question Request message block** to the current assistant message and pauses the session.
- On `replied` via option(s): the UI inserts a new user message whose text is:
  - single-select: the selected `label`
  - multi-select: selected `label`s joined by `\n`
  - if custom text is provided: it is appended as the last line (multi) or used as the only line (single)
- On `replied` via manual user message: no insertion; the existing user message is used as the answer.
- On `rejected`: no user message is inserted.

## Message Block Contract (AssistantMessageBlock)

### Representation

Use a new `AssistantMessageBlock` with:

- `type: 'action'`
- `action_type: 'question_request'` (new action type)
- `status` mapping:
  - asked → `pending`
  - replied → `success`
  - rejected → `denied`
- `extra.needsUserAction`:
  - `true` only while `status === 'pending'`
  - `false` after resolution

### Stored fields (extra)

Minimum required fields:

- `questionHeader`: string (optional)
- `questionText`: string
- `questionOptions`: string (JSON of `{ label, description? }[]`) or `object[]` if the shared type is extended
- `questionMultiple`: boolean
- `questionCustom`: boolean
- `questionResolution`: `'asked' | 'replied' | 'rejected'`

Resolution fields (when `replied`):

- `answerText`: string
- `answerMessageId`: string (optional; set when the answer was the next manual user message)

### Renderer behavior

- Pending view (asked):
  - Render header/body and options as buttons.
  - Multi-select uses toggles/checkbox semantics + a submit button.
  - Include a “Reject” action.
  - If `questionCustom` is enabled, render a text input.
- Resolved view:
  - Show question + resolved answer (or “rejected”).
  - Hide all buttons/inputs.

## Acceptance Criteria

- [ ] When the agent calls `question`, the UI shows a pending question block under the current assistant message.
- [ ] Single-select: clicking an option inserts a new user message with the option label and sends it.
- [ ] Multi-select: the user can select multiple options and submit; the inserted user message contains one label per line.
- [ ] If `custom` is enabled, the user can submit a typed answer.
- [ ] While a question is pending, if the user sends a manual message, the question block resolves to `replied` and collapses (no extra message is inserted).
- [ ] Clicking reject resolves the block to `rejected` without inserting a user message.
- [ ] The session is paused after `question` is asked; generation resumes only after user reply (via selection or manual message).
- [ ] The `question` tool call is enforced as standalone and last; violations produce a visible error block and do not pause the session.

## Open Questions [NEEDS CLARIFICATION]

1. For multi-select with custom text, should custom text be allowed in addition to selected options, or should it replace them?
2. Should options support a separate `value` field (distinct from `label`) for insertion into the user message?
3. On auto-resolve via manual user message, should the resolved answer display the full message text or a trimmed preview?

## Security & Privacy Notes

- Treat tool arguments as untrusted input; validate lengths and maximum option count.
- Do not log custom user answers beyond existing chat logging.
- Avoid allowing the tool to smuggle hidden instructions: UI shows only `label` and `description`, and inserted message uses `label`/typed text only.

## Compatibility & Migration

- Adds a new `action_type` and new message block rendering path; existing chats remain compatible.
- Persisted chat messages may include `question_request` blocks; older clients should degrade gracefully (render as generic action block).

