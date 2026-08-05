# DeepSeek Native Web Search Tasks

- [x] Upgrade `ai`, `@ai-sdk/openai`, and `@ai-sdk/provider` to the selected patch versions in an
  independent commit.
- [ ] Add the exact official-endpoint resolver, V4 Flash Responses route, and capability override.
- [ ] Add per-turn search input normalization and persistence across send, queue, steer, and retry.
- [ ] Add the capability-gated renderer toggle and optimistic search projection.
- [ ] Add the normalized provider-search event, search block, and result-row persistence.
- [ ] Add versioned opaque envelope persistence and ordering-aware context projection.
- [ ] Add the request-scoped replay map, AI SDK marker mapping, and fetch body transform.
- [ ] Add replay token accounting and complete-turn truncation guarantees.
- [ ] Add focused main and renderer regression tests.
- [ ] Add and pass the local two-round conformance test.
- [ ] Run format, i18n, lint, node/web typechecks, focused tests, and final diff checks.
- [ ] Run a two-user-turn real-key canary, or explicitly record that credentials were unavailable.
