# OpenAI Codex Store Flag Error

## User Need

OpenAI Codex chat requests should stream successfully through the dedicated Codex provider path. Current requests can fail with `OpenAI Codex request failed: Store must be set to false`.

## Goal

Ensure every OpenAI Codex Responses request sent by DeepChat explicitly sets the OpenAI Responses `store` option to `false`.

## Acceptance Criteria

- Codex chat requests pass `providerOptions.openai.store = false` into the AI SDK Responses model.
- The Codex adapter enforces `store: false` in outgoing JSON request bodies as a provider-specific backend requirement.
- Existing Codex instructions mapping, backend headers, auth refresh, streaming, proxy, and error normalization remain unchanged.
- Focused Codex provider option and adapter tests cover the store flag behavior.
- SDD files contain no unresolved clarification markers.

## Constraints

- Keep the fix scoped to `openai-codex`.
- Do not change standard OpenAI API-key provider behavior.
- Do not expose OAuth tokens or account identifiers in logs or renderer payloads.

## Non-Goals

- Changing the AI SDK dependency.
- Reworking Codex OAuth.
- Changing model catalog behavior.

## Open Questions

None.
