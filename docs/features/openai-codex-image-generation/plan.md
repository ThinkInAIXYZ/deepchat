# OpenAI Codex Image Generation Plan

Objective: make `gpt-image-2` available through the existing `openai-codex` provider and DeepChat
image-generation flow without adding a provider, dependency, credential path, or renderer-specific
branch.

## 1. Contract and catalog

- [x] Confirm the official model, endpoint, usage, and active-provider auth behavior.
- [x] Define the provider, transport, metadata, security, and compatibility contract in `spec.md`.
- [x] Add `gpt-image-2` to the curated Codex model catalog and maintained provider runtime contract.

Completion condition: model refresh can surface the provider-db-backed image model without changing
fallback behavior.

## 2. Runtime support

- [x] Create the Codex image model and trace endpoint in the existing AI SDK provider context.
- [x] Keep Responses-only body and Accept normalization away from image requests.
- [x] Preserve OAuth injection, refresh, abort, and normalized error behavior for both endpoints.
- [x] Preserve shared model/session image settings and disable unsupported reference-image input.

Completion condition: the existing image runtime can call the Codex image endpoint with the current
credential store and no renderer-owned provider logic.

## 3. Whole-change review and validation

- [x] Review model typing, image settings compatibility, credential boundaries, traces, error paths,
  and text-request compatibility against `spec.md`.
- [x] Select and add only durable provider contract tests needed to protect the new route.
- [x] Run focused provider tests.
- [x] Run format, i18n, lint, and typecheck quality gates.
- [x] Remove temporary probes and record the final validation outcome.

Completion condition: all acceptance criteria are covered by code inspection or durable checks, and
the repository quality gates pass.

## Validation outcome

- `pnpm run format`: passed.
- `pnpm run i18n`: passed.
- `pnpm run lint`: passed.
- `pnpm run typecheck`: passed.
- Focused main and renderer provider tests: 7 files and 261 tests passed.
