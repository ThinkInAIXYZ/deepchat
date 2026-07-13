# Feishu/Lark Streaming Cards

## User need

Feishu/Lark remote-control users want AI responses to appear progressively with a token-by-token/typewriter effect instead of waiting for a normal message update or a complete answer.

## Goal

Add an opt-in Feishu/Lark remote-control setting that delivers AI conversation responses through CardKit streaming cards. When enabled, DeepChat creates a CardKit card entity with `streaming_mode` enabled, sends it to the target chat, updates its markdown component with full text snapshots using a strictly increasing sequence number, and closes streaming mode when the response finishes.

## Acceptance criteria

1. The Feishu/Lark remote settings page exposes a "Streaming Cards" switch with helper text explaining required CardKit permissions.
2. The new setting persists with the remote-control Feishu configuration and defaults to off for existing users.
3. When disabled, Feishu remote-control delivery keeps the existing standard markdown/post message behavior.
4. When enabled for a conversation response:
   - DeepChat creates a CardKit JSON 2.0 card entity with `config.streaming_mode: true` and `config.update_multi: true`.
   - DeepChat sends that card entity as an interactive message using the returned `card_id`.
   - DeepChat updates the card markdown element with the full rendered response text on each snapshot and uses strictly increasing `sequence` values.
   - DeepChat preserves Markdown content for Feishu CardKit rendering, including fenced code blocks and pipe tables.
   - DeepChat shows tool-call progress in the streaming card process section.
   - DeepChat shows the current thinking/running status in the streaming card while the response is active.
   - DeepChat closes streaming mode with the CardKit settings API when the response completes or times out.
5. If CardKit creation, send, update, or close fails because of permissions or API errors, the runtime falls back to the current markdown/post delivery path and logs a clear warning without exposing secrets.
6. Tests cover client request serialization, settings persistence/UI, streaming-card delivery updates, closing behavior, and fallback to standard markdown delivery.

## Constraints

- Use existing remote-control Presenter/Adapter boundaries and typed shared settings.
- Use the existing Lark SDK client request escape hatch for CardKit endpoints because the installed SDK does not expose typed CardKit helpers.
- Do not log App Secret, tokens, or other credentials.
- Keep the implementation small: one streaming card per assistant response, one markdown element (`md_stream`) updated with full text.
- Respect Feishu CardKit limits known from docs: JSON 2.0 cards, `update_multi: true`, card entity send-once, and increasing sequence values.

## Non-goals

- No custom streaming-card template editor.
- No interactive buttons inside the streaming response card.
- No streaming cards for generated image delivery; images continue through the existing image path after text completion.
- No change to the official Feishu MCP plugin settings page.

## Open questions

None.
