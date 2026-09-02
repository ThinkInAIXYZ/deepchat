# DeepSeek Native Web Search Implementation Plan

## Original Approach

This section records the shipped native-search design before the Open Responses migration below.

Use the existing AI SDK OpenAI Responses transport for native-search and compatible replay requests
on the exact official DeepSeek V4 Flash route. Ordinary requests keep the configured transport.
Introduce one provider adapter that owns request-level route recognition, raw item validation,
normalized search projection, replay-envelope validation, AI SDK marker creation, and request-body
transformation.

The surrounding runtime receives only narrow generic hooks:

- capability override: whether the effective route supports per-turn search;
- context replay projector: opaque persisted block JSON to an internal replay content part;
- message mapper hook: internal replay part to an AI SDK provider-executed marker;
- fetch wrapper: request-scoped marker replacement and stateless wire invariants;
- stream hook: raw provider chunk to normalized `provider_search` event.

No generic module parses or constructs a DeepSeek protocol object.

## Dependency Baseline

The original implementation upgraded AI SDK core and all directly used provider packages as one
validated release set. Its composite packages pin sibling providers from the same set: Amazon
Bedrock depends on Anthropic and
OpenAI, Google Vertex depends on Anthropic, Google, and OpenAI Compatible, and Azure depends on
OpenAI. Every resolved package targets `@ai-sdk/provider@4.0.5` and
`@ai-sdk/provider-utils@5.0.22`, avoiding a mixed provider ABI. The DeepSeek feature itself still
used only the existing OpenAI Responses transport. The migration adds
`@ai-sdk/open-responses@2.0.38`, which remains on provider specification v4 but currently resolves
newer provider and provider-utils minors alongside that baseline. Factory and end-to-end serializer
tests are the compatibility boundary until the repository performs another coordinated SDK update.

## Data Flow

```text
Toolbar toggle
  -> SendMessageInput.search
  -> normalized pending payload / UserMessageContent.search
  -> DeepChatLoopRunInput.search
  -> ProviderStreamOptions.search
  -> openai.tools.webSearch()
  -> raw response.output_item.done(web_search_call)
  -> provider_search event
  -> search block + search-result rows + providerReplayJson
  -> AI SDK URL source parts
  -> provider_url_source event
  -> matching search block pages + search-result rows

Next turn
  -> assistant blocks in context projection
  -> opaque replay content part at original block position
  -> adapter registers marker in a request-local map
  -> AI SDK emits item_reference
  -> fetch transform substitutes original web_search_call
  -> DeepSeek /responses with store:false
```

## Interfaces

### Shared input and events

- Add optional `search?: boolean` to `SendMessageInput` and its Zod schema.
- Add `search?: boolean` to `ProviderStreamOptions`.
- Add a generic internal `provider_replay` assistant content part carrying a marker ID and opaque
  payload JSON.
- Add `provider_search` to `LLMCoreStreamEvent` with call ID, query label, normalized results, and
  replay JSON.
- Add `provider_url_source` to `LLMCoreStreamEvent` with the owning search ID and a bounded,
  normalized URL citation.

### Context projection

- Extend context-build options with an optional replay projector.
- Preserve assistant block order when a projector accepts a replay envelope.
- Reuse one replay segmentation helper for persisted-history projection and in-flight tool rounds.
- Keep the existing projection unchanged when no replay part is accepted.
- Count replay payload JSON in `estimateMessageTokens` without changing existing string/tool token
  accounting behavior.
- Reuse turn-level selection and make the emergency fallback drop the owning turn atomically when a
  replay part is present.

### Provider adapter

Create `src/main/provider/deepseekResponsesAdapter.ts` with:

- exact official-route resolver and canonical base URL;
- route-specific capability override helper;
- versioned envelope encoder/parser and context projector;
- non-search OpenAI item-ID stripping;
- request-scoped replay registration and AI SDK marker mapper;
- fetch wrapper that validates and transforms the final JSON body;
- raw Web Search chunk parser and normalized URL projection;
- provider tool definition and tool-event suppression predicate.

The adapter accepts a base fetch implementation and returns a wrapper, preserving the existing proxy,
header, timeout, and abort behavior.

### Runtime wiring

- Resolve the special Responses route per request only when search is enabled or projected context
  contains compatible replay; otherwise preserve the provider's configured route.
- Derive `https://api.deepseek.com` only in the request-local provider patch.
- Create one adapter instance inside each prompt runtime, then pass its closures to provider factory,
  message mapper, and stream adapter.
- Offer the native tool only for `ProviderStreamOptions.search === true`.
- Enable raw chunks only for those search-enabled requests.
- Thread the current turn's search intent through retries and local tool rounds. Resume recovers the
  unfinished turn's intent from its closest preceding persisted user record; new turns never infer
  intent from completed history.
- Use the same safe replay projector for persisted history and in-flight tool rounds before any
  marker reaches the fail-closed adapter registration path.

### Persistence and UI

- Normalize missing input values to false in IPC, session normalization, pending-input decoding, and
  transcript projection.
- Preserve search during queue edits, steer materialization, and attachment retry payloads.
- OR search values when steer payloads merge.
- Add the provider-search block in the accumulator and persist its result rows in the stream process.
- Associate normalized AI SDK URL sources with the latest search action in the same provider round,
  deduplicate by canonical URL, and persist them through the same existing result table.
- Reuse `block.extra`/`extra_json`; no schema change.
- Add a capability-gated globe icon toggle to `ChatInputToolbar.vue`, using
  `chat.features.webSearch` for its tooltip.
- Keep toggle values in the renderer session store and capture the effective value while constructing
  every submission payload. Record a newly created session's captured first-turn intent before
  navigation so the chat-page composer observes the same value on mount.
- Preserve the value in optimistic user records.
- Render normalized provider-search blocks in the existing assistant activity group. Search,
  open-page, and find-in-page actions use one compact presentation with safe links; the component
  must not inspect opaque replay JSON.
- Exclude opaque replay JSON from throttled renderer snapshots and client-facing message-page
  projections, and distinguish provider-native actions from legacy MCP search-result blocks by
  normalized action metadata.
- Remove provider-owned call markers from visible search targets and let completed targets wrap.
- Keep page-navigation targets separate from citation sources. Only normalized provider URL sources
  enter the citation lookup table.

## Compatibility

- Old callers and pending rows without `search` normalize to false.
- Non-DeepSeek providers receive no new tools, raw chunks, replay parts, or request transformation.
- DeepSeek custom endpoints and all other model IDs keep their existing transport.
- Official V4 Flash requests with neither a new search nor compatible replay keep the configured
  Chat Completions transport and endpoint.
- Existing assistant rows without `providerReplayJson` project exactly as before.
- Compatible envelopes are additive inside the existing JSON extra column and remain readable by
  older builds, which ignore the unknown field.
- Model switching omits incompatible replay protocol data while retaining user-visible text.

## Failure Handling

- Invalid endpoint inputs simply do not enable the route.
- A malformed raw Web Search item fails the stream rather than persisting unreplayable state.
- A malformed, unsupported, or oversized persisted envelope is omitted from history and in-flight
  tool-round projection with a warning so local corruption cannot make a conversation unusable.
- Duplicate replay IDs, duplicate body markers, missing registrations, unmatched item references,
  remaining continuation fields, or a non-JSON request body fail before the base fetch is called.
- Only HTTP(S) source URLs enter the normalized search result table; invalid and duplicate sources
  are skipped.
- Envelopes above the documented size limit are rejected before persistence or replay.

## Validation

Focused tests will cover:

- endpoint and exact route matrix;
- route-specific capability snapshots;
- input normalization, queue snapshots, merged steer OR semantics, and optimistic projection;
- toolbar capability, toggle, session switching, and unsupported-model behavior;
- raw chunk validation, URL normalization, block ordering, and result persistence;
- AI SDK URL source association, deduplication, unsafe URL filtering, and late block updates;
- search-action presentation, first-session intent handoff, session switching, and deletion cleanup;
- envelope compatibility, model switching, malformed data, duplicate IDs, and leftover markers;
- production prompt-runtime replay with persisted OpenAI item IDs and the SDK default store path,
  request-scope concurrency isolation, and SQLite `extra_json` round-trip projection;
- request-level transport selection for search, replay, and ordinary DeepSeek turns;
- client message-page redaction, damaged in-flight replay, and multi-assistant resume intent;
- token accounting and complete-turn truncation with replay payloads;
- a two-round AI SDK conformance path with a captured second request body.

Before handoff run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, node and web typechecks,
focused main/renderer Vitest suites, and `git diff --check`. A real-key canary is reported separately
because credentials are not assumed to exist locally.

## Rollback

Remove `deepseekResponsesAdapter.ts` and its narrow hook wiring, then remove the toolbar/input additions.
Persisted `providerReplayJson` values require no cleanup and remain ignored JSON. Reverting the feature
does not require a database rollback or provider configuration migration.

## Open Responses Migration

### Objective

Replace the OpenAI-specific Responses transport used by official DeepSeek V4 Flash search and
replay requests with `@ai-sdk/open-responses`, while preserving DeepSeek's server-side Web Search,
opaque search-item replay, reasoning display, tool loops, and existing non-DeepSeek routes.

The provider package owns portable stateless Responses behavior. The existing request-scoped
DeepSeek adapter owns only DeepSeek's bare `web_search` extension and its fail-closed replay rules.
The migration does not add thinking-off UI support, repair reasoning text absent from old records,
or depend on the experimental Open Responses extension API.

### Implementation

- [x] Add the internal `deepseek-open-responses` provider kind and construct it with the exact DeepSeek
      `/responses` endpoint, `deepseek` provider-options namespace, existing headers, proxy-aware
      fetch, and abort behavior.
- [x] Route only the existing official DeepSeek V4 Flash search/replay boundary to that kind and map
      only currently supported reasoning effort options.
- [x] Simplify the DeepSeek adapter: inject the native `web_search` wire tool, preserve validated raw
      search projection and opaque envelopes, map replay through a private `function_call` marker,
      restore the original item exactly once, reject malformed or residual state, and omit empty
      reasoning without persisting reasoning item IDs.
- [x] Preserve incremental MCP argument rendering by projecting raw function-call start/delta events
      when search or MCP tools can emit them, while using the provider's final canonical tool-call
      event for deduplicated completion.
- [x] Update the maintained feature contract for the stateless plaintext-reasoning transport and
      record the released package's extension limitations and upgrade risk.
- [x] Add durable protocol regression coverage only after the source migration is complete.

### Review And Validation

- [x] Review the complete diff before each commit, ordered by severity, for hidden behavior changes,
      compatibility, edge cases, performance, security, naming, test gaps, and maintenance cost;
      resolve every confirmed issue before committing.
- [x] Run focused provider factory, options, routing, adapter, stream, and persisted-history tests.
- [x] Run formatting, i18n validation, lint, node/web typechecks, and the broader relevant main suite.
- [ ] Keep real-key acceptance pending until it verifies `summary: []`, id-less reasoning replay,
      independent search turns, multiple reasoning items, same-turn MCP tools, and search-off replay
      semantics without exposing credentials or committing probe code.
