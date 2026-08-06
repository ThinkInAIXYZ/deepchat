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
- [x] Record that no real DeepSeek credential was available locally; the two-user-turn canary remains
  a release gate.
