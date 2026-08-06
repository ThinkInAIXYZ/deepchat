# DeepSeek Native Web Search Tasks

- [x] Upgrade `ai`, `@ai-sdk/openai`, and `@ai-sdk/provider` to the selected patch versions in an
  independent commit.
- [x] Add the exact official-endpoint resolver, V4 Flash Responses route, and capability override.
- [x] Add per-turn search input normalization and persistence across send, queue, steer, and retry.
- [x] Add the capability-gated renderer toggle and optimistic search projection.
- [x] Add the normalized provider-search event, search block, and result-row persistence.
- [x] Add versioned opaque envelope persistence and ordering-aware context projection.
- [x] Add the request-scoped replay map, AI SDK marker mapping, and fetch body transform.
- [x] Add replay token accounting and complete-turn truncation guarantees.
- [x] Add focused main and renderer regression tests.
- [x] Add and pass the local two-round conformance test.
- [x] Run format, i18n, lint, node/web typechecks, focused tests, and final diff checks.
- [x] Share transient search intent between new-thread creation and the mounted chat composer.
- [x] Render normalized provider-search actions and safe sources in assistant activity groups.
- [x] Normalize open-page and find-in-page display targets without fabricating citations.
- [x] Add focused renderer, session-store, and adapter regression coverage for the UI follow-up.
- [x] Run the full required validation and complete the severity-ordered pre-commit review.
- [x] Confirm with a real key that the official Responses endpoint emits completed native `search`
  and `open_page` items; the independent second-turn replay canary remains pending.
- [x] Capture normalized AI SDK URL sources in search blocks and the existing result table.
- [x] Hide provider-owned search markers and wrap completed search targets without truncation.
