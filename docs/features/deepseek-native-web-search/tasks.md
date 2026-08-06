# DeepSeek Native Web Search Tasks

- [x] Upgrade AI SDK core and directly used provider packages as one compatible release set in an
  independent commit, then validate the shared provider runtime.
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
  and `open_page` items.
- [ ] Before merge, confirm with a real key that a second independent user turn retains the first
  turn's replayed search context.
- [x] Capture normalized AI SDK URL sources in search blocks and the existing result table.
- [x] Hide provider-owned search markers and wrap completed search targets without truncation.
- [x] Preserve queued search intent during edits and keep replay-bearing turns atomic in emergency
  truncation.
- [x] Cover production-runtime replay, SDK default store behavior, persisted OpenAI item-ID removal,
  request-scope isolation, and SQLite opaque-envelope round trips.
- [x] Keep legacy MCP search blocks and opaque replay payloads out of provider-native renderer UI.
- [x] Keep ordinary V4 Flash requests on Chat Completions while routing search and replay requests
  through Responses.
- [x] Strip opaque replay payloads from client message pages without changing durable storage.
- [x] Apply the safe replay projector to in-flight tool rounds and recover resume intent from the
  closest persisted user record.
- [x] Fail closed when invalid client message content contains opaque replay payloads.
- [x] Keep provider stream invocation independent from mock call arity and report provider search
  separately from local tool-call counts.
- [x] Reconcile the AI SDK dependency graph with the current `dev` runtime lockfile.
