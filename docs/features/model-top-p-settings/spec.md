# Model Top P Settings

## User Need

Users need to adjust `top_p` for chat models because many upstream model APIs support nucleus sampling and expose it as a generation parameter.

## Goal

Add an optional per-session `topP` generation setting for text chat requests and pass it through to AI SDK text generation when the user explicitly sets it.

## Acceptance Criteria

- Users can set `topP` from the chat model advanced settings panel for regular text chat models.
- `topP` accepts values greater than 0 and less than or equal to 1.
- Existing conversations and new sessions continue to work when no `topP` is set.
- `topP` persists with DeepChat session generation settings and survives app restart.
- Text `generateText` and streaming requests pass `topP` to AI SDK only when it is defined.
- Existing Voice.ai TTS `topP` configuration remains independent.

## Constraints

- Follow current typed route/contracts and presenter boundaries.
- Use `topP` internally and let SDK/provider layers map provider payload details.
- Do not default-send `topP: 1`; omit the parameter when unset to preserve provider defaults.
- Use i18n keys for all user-facing strings.
- SQLite schema migration must be backward compatible.

## Non-Goals

- Provider-specific `top_p` compatibility matrices.
- Building a full Provider DB `top_p` capability matrix.

## Open Questions

- None.
