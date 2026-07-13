# OpenAI Codex Unsupported Responses Parameters

## User Need

OpenAI Codex chat requests should stream successfully through the dedicated Codex provider path. After setting `store: false`, Codex requests can still fail with `OpenAI Codex request failed: Unsupported parameter: max_output_tokens`.

## Goal

Remove Responses parameters that the ChatGPT Codex backend rejects from outgoing Codex request bodies, starting with `max_output_tokens`.

## Acceptance Criteria

- Codex Responses JSON request bodies sent through the dedicated adapter omit `max_output_tokens`.
- Codex Responses JSON request bodies continue to include `store: false`.
- Existing Codex auth headers, 401 refresh replay, streaming, proxy, and error normalization remain unchanged.
- Standard OpenAI API-key provider behavior remains unchanged.
- Focused Codex adapter tests cover the unsupported parameter removal.
- SDD files contain no unresolved clarification markers.

## Constraints

- Keep the fix scoped to `openai-codex`.
- Preserve non-string bodies and invalid JSON bodies unchanged except for existing Codex header/auth behavior.
- Do not log or expose OAuth tokens or account identifiers.

## Non-Goals

- Changing the AI SDK dependency.
- Reworking Codex OAuth.
- Changing model catalog behavior.
- Broadly removing unreported Responses parameters.

## Open Questions

None.
