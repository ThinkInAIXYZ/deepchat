# MiniMax model matching and thinking

## Problem

MiniMax provider models with mixed-case IDs such as `MiniMax-M3` and `MiniMax-M2.5` can miss
provider DB-derived configuration because model config lookup lowercases the requested model ID but
compares it with the raw DB model ID.

MiniMax-M3 also requires explicit Anthropic-compatible `thinking: { type: "adaptive" }` to emit
thinking blocks. Current Anthropic-compatible provider options only send `thinking` for official
Anthropic adaptive reasoning or budget-based thinking.

## Acceptance Criteria

- Provider DB model lookup matches model IDs case-insensitively while keeping provider matching
  strict.
- MiniMax mixed-case model IDs inherit provider DB context, output, multimodal, tool-call, and
  reasoning defaults.
- MiniMax-M3 defaults to interleaved thinking compatibility even if the provider DB source has not
  caught up.
- MiniMax-M3 sends Anthropic-compatible adaptive thinking when reasoning is enabled.
- Reasoning-disabled MiniMax-M3 requests do not send adaptive thinking.

## Non-goals

- Do not route MiniMax through Anthropic provider capability semantics.
- Do not change Claude or generic Anthropic proxy behavior.
