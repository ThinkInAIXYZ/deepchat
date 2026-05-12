# Feishu Post Message Payload

## User Story

When DeepChat replies to Feishu remote-control commands, the bot should send a valid Feishu `post` message so users see the actual command result instead of the generic internal-error fallback.

## Acceptance Criteria

- Feishu command replies such as `/pair` and `/help` send valid `msg_type: 'post'` payloads accepted by the Feishu reply API.
- Successful Feishu command handling no longer falls back to `An internal error occurred while processing your request.` because of invalid markdown payload shape.
- The Feishu client has a focused regression test that verifies the serialized `post` payload shape.

## Constraints

- Keep the existing Feishu runtime reply flow and markdown optimization behavior.
- Limit the change to the Feishu remote-control client and focused tests.

## Non-Goals

- No changes to pairing authorization semantics.
- No changes to Feishu parser, router, or runtime retry behavior.
