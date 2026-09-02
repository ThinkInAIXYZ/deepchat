# DeepSeek Native Web Search

Status: Open Responses migration repository-validated; migration-specific real-key canaries remain a
merge gate.

## User Need

DeepChat users selecting DeepSeek V4 Flash on DeepSeek's official API need to opt into the
provider-native Web Search tool for an individual turn. Search results must remain visible and
exportable, and a later turn must retain the search context even though DeepSeek's Responses API is
stateless.

## Migration Rationale

[PR #2093](https://github.com/ThinkInAIXYZ/deepchat/pull/2093) introduced the original native-search
route on `@ai-sdk/openai`. That provider implements OpenAI's server-stored or encrypted continuation
models: it does not parse DeepSeek's plaintext `reasoning_text` stream, drops plaintext reasoning
without an OpenAI item reference, and gates reasoning effort by recognized OpenAI model names. A
tool-bearing follow-up therefore omitted required reasoning and could fail with DeepSeek's
`reasoning_text` replay error, while configured effort was silently absent from the request.

DeepSeek's endpoint instead uses a stateless plaintext Responses contract. The migration assigns
that portable contract to `@ai-sdk/open-responses` and keeps only DeepSeek's bare native-search
extension in the local adapter. No DeepSeek server behavior change is assumed.

## Goals

- Route only native-search and compatible replay requests from the exact supported DeepSeek
  configuration through a stateless Open Responses transport.
- Capture search intent per submitted turn across send, queue, and steer paths.
- Project provider search output into DeepChat's existing search blocks and result store.
- Persist the complete provider item required for stateless replay without a schema migration.
- Replay search history in original assistant-block order without relying on server-side response
  storage.
- Keep every DeepSeek-specific wire-protocol rule in one removable adapter while delegating portable
  plaintext reasoning and function-tool behavior to the Open Responses provider.

## Supported Configuration

Native search is eligible only when all of the following are true:

- provider ID is exactly `deepseek`;
- model ID is exactly `deepseek-v4-flash`;
- the persisted endpoint is an official DeepSeek HTTPS URL.

An official endpoint has host `api.deepseek.com`, no credentials, query, fragment, or custom port,
and a path of `/` or `/v1` after removing trailing slashes. An eligible request uses the request-local
API type `openai-responses`, internal AI SDK provider kind `deepseek-open-responses`, and base URL
`https://api.deepseek.com` only when the current turn enables native search or the projected context
contains compatible replay. Requests with neither condition keep the persisted transport and base
URL. Persisted provider configuration is never mutated.

Custom relays, aggregators, model-name prefixes, and DeepSeek V4 Pro are not supported by this
feature.

## Functional Requirements

### Per-turn intent

- `SendMessageInput.search` is optional at the public boundary and normalizes to `false`.
- Persisted `UserMessageContent.search` records the captured value for every accepted user input.
- Send, queue, and steer snapshot the effective toolbar state when submitted.
- Multiple steer inputs merged into one provider turn combine search intent with logical OR.
- Turning search off prevents a new search tool from being offered; it never removes compatible
  replay items from prior turns, and those replay-bearing requests still use Responses.
- Resuming an unfinished assistant turn recovers its intent from the closest persisted user record
  at or before that assistant. Completed historical turns never enable search for a new turn.
- Existing conversation-level `enableSearch` fields are not read, extended, or migrated.

### Search output

- A search-enabled request injects exactly one bare `{ type: 'web_search' }` provider tool into the
  final DeepSeek request. Ordinary MCP function tools remain alongside it.
- Raw AI SDK chunks are enabled only while the DeepSeek adapter is active and the request can emit
  either a new provider search or an MCP function call.
- A complete `response.output_item.done` item with type `web_search_call` produces one
  `provider_search` event.
- The event creates one successful `search` block at the event's original position. Its normalized
  action type and bounded display target serve the renderer. Optional provider-declared HTTP(S)
  `action.sources` continue through the existing message search-result table, but DeepSeek's
  Responses guide does not guarantee that field.
- AI SDK URL `source` parts and bounded Open Responses URL-citation annotations from the `deepseek`
  provider-options namespace produce generic `provider_url_source` events associated with the
  latest `search` action in the same provider round. Safe, deduplicated HTTP(S) citations update
  that search block and the existing message search-result table; other namespaces, document
  sources, and unsafe URLs are ignored.
- `search`, `open_page`, and `find_in_page` actions share one visible activity presentation.
  Safe page targets are clickable, and completed opaque actions never claim that zero results were
  found.
- An `open_page.url` is a navigation target, not evidence cited by the model. It is displayed but is
  not fabricated into a citation source. URL citations render as clickable source rows; translating
  them into inline numbered references remains outside this feature because normalized AI SDK
  source parts do not retain text offsets.
- Provider-owned `ws_call_id=...` query markers remain in the opaque replay envelope but are removed
  from the visible search target. Completed search targets wrap instead of using single-line
  truncation.
- Provider-owned Web Search tool lifecycle events do not enter DeepChat's local tool execution
  loop and do not create a visible `tool_call` block.
- The adapter projects `response.output_item.added(function_call)` and incremental
  `response.function_call_arguments.delta` events so MCP argument cards update while DeepSeek is
  generating them. It correlates each delta's `item_id` with the `call_id` captured from the added
  item. The Open Responses provider's final canonical `tool-call` supplies the complete arguments
  and closes the block without repeating the projected start or deltas. Missing or malformed
  optional raw function events fall back to that atomic canonical event.
- Normalized search data serves UI, export, and citation lookup. It is never used to reconstruct the
  provider protocol item.
- Renderer code consumes only normalized block fields and never parses `providerReplayJson`.
- Streaming snapshots and client-facing message-page projections omit `providerReplayJson`;
  renderer presentation and public read models never depend on the opaque payload, while durable
  assistant-block storage remains the replay source.
- Existing MCP-produced `search` blocks without normalized provider action metadata remain on their
  legacy presentation path instead of being grouped as provider-native search activity.

### Opaque replay

Each search block stores a JSON string in `block.extra.providerReplayJson`. The version 1 envelope
contains:

```ts
type DeepSeekWebSearchReplayEnvelopeV1 = {
  version: 1
  providerId: 'deepseek'
  modelId: 'deepseek-v4-flash'
  item: {
    type: 'web_search_call'
    id: string
    [key: string]: unknown
  }
}
```

The complete raw `item` is retained. No database table or migration is added.

For a compatible target, context projection emits an internal opaque replay part at the search
block's original position. For any other provider or model, it omits the part while retaining all
normal assistant text and reasoning.

Invalid, unsupported, or oversized persisted envelopes are omitted with a diagnostic warning in
both history and in-flight tool-round projection, so a damaged local row cannot permanently block
the conversation. Once a replay marker is accepted, registration and wire transformation remain
fail-closed and never send incomplete replay state.

The adapter maps each compatible replay part to a provider-executed private tool-call marker.
`@ai-sdk/open-responses` serializes the marker as a normal `function_call`. A request-scoped fetch
transform then:

1. identifies the private marker by its exact tool name and call ID;
2. replaces it exactly once with its matching original `web_search_call` object;
3. rejects malformed, duplicate, missing, mismatched, or leftover markers and every
   `item_reference` before network I/O.

The marker tool name is reserved while this route is active. An MCP tool with the same name is
rejected before serialization rather than being confused with replay state.

The Open Responses provider is stateless and does not generate `store`, `previous_response_id`,
`conversation`, or `truncation` fields. The adapter does not emulate a stateful OpenAI request and
does not mutate those fields after serialization.

Replay state is held only in a closure owned by one provider request. No global or cross-request map
is permitted.

### Plaintext reasoning

`@ai-sdk/open-responses` consumes `response.reasoning_text.delta` natively and replays persisted
reasoning as a plaintext item with `summary: []` and `content[].type = 'reasoning_text'`. DeepChat
persists only the streamed reasoning text. It does not consume `reasoning-end` metadata or persist a
reasoning item ID, so replay uses the provider's text fallback and does not depend on server-side
item references. Empty reasoning properties are omitted before AI SDK message conversion.

The context builder's existing assistant-record contract concatenates multiple persisted reasoning
blocks into one string. The resulting id-less plaintext reasoning item remains adjacent to the
assistant content and tool calls reconstructed from that record. Historical records created by a
broken Responses route and lacking reasoning text cannot be repaired locally.

Configured `low`, `high`, and `max` reasoning efforts are sent under the `deepseek` provider-options
namespace without OpenAI model-name capability gates. Exposing `none` as a product-level thinking
toggle is a separate feature because the Chat Completions route requires a different wire mapping.

### Context budget

- The serialized opaque envelope contributes to token estimation exactly once.
- Normal history selection removes complete user turns. Emergency message-level truncation may
  remove non-replay messages individually, but removes a replay-bearing turn atomically when that
  turn reaches the head.
- A replay part is inseparable from the assistant record that owns it; no request may contain an
  isolated search item.
- Emergency message-level truncation removes an entire replay-bearing turn if any part of that turn
  must be discarded.
- DeepSeek requests do not ask the server to truncate context.

### Toolbar

The toolbar exposes an icon toggle only while the current route reports `supportsSearch`.
Search state is transient and keyed by session in the renderer. It may stay enabled between sends in
the same renderer session, resets to false after reload, and is effectively false while an
unsupported model is selected.

Capability refreshes keep the last resolved value while revalidating the same session/model identity,
then replace it atomically. Switching identity clears the old value immediately.

The new-thread composer captures its local intent in `CreateSessionInput`. After the main process
accepts the new session and before chat navigation, the renderer session store records that intent
under the returned session ID. The chat composer reads the same session-keyed source, so mounting the
chat page cannot turn an enabled first-turn toggle off. Session deletion removes the transient entry.

Before:

```text
+------------------------------------------------------------------+
| [+ Attach]                                  [Mic] [Steer] [Send] |
+------------------------------------------------------------------+
```

After on the supported route:

```text
+------------------------------------------------------------------+
| [+ Attach]                         [Globe Search] [Mic] [Steer] [Send] |
+------------------------------------------------------------------+
```

After on every unsupported route, the layout remains unchanged.

## Acceptance Criteria

- Official `/` and `/v1` endpoint variants enable V4 Flash search. Search and compatible replay
  requests derive the canonical Responses URL without mutating saved configuration; ordinary
  requests retain the configured transport and endpoint.
- HTTP, credentials, query, fragment, custom host/path/port, relay, prefixed model IDs, and V4 Pro
  configurations do not expose or send native search.
- Missing `search` values behave as false for old callers and persisted pending inputs.
- Queue and steer inputs retain their submission-time search values; merged steers use OR.
- A search-enabled first turn keeps the toolbar enabled after navigation to the newly created
  session; switching sessions preserves independent transient values and deletion clears them.
- A search stream creates a search block, normalized result rows, and a versioned opaque envelope,
  with no local tool execution.
- Completed provider search, open-page, and find-in-page actions are visible inside the existing
  assistant activity group, including safe clickable targets and normalized AI SDK URL source rows.
- Switching provider or model excludes incompatible replay markers but preserves response text.
- Corrupt persisted envelopes are skipped locally, while malformed accepted markers and unmatched
  item references still fail before fetch.
- Resuming across multiple assistant records recovers search intent from the owning persisted user
  record without inferring intent for a new turn.
- Stream snapshots and paginated client reads exclude opaque replay JSON while durable storage keeps
  the envelope intact.
- A local two-round conformance test proves that the second request contains the original
  `web_search_call`, an id-less plaintext reasoning item with `summary: []`, no private function-call
  marker or `item_reference`, no newly offered search tool when search is off, and no OpenAI state or
  continuation fields.
- A replay-only route with search disabled continues to stream MCP function arguments before the
  provider's completed tool-call item arrives.
- A real-key canary confirms DeepSeek emits `summary: []`, accepts id-less reasoning replay, completes
  two independent user turns, and retains a searched detail that was absent from the first answer.
- Real-key tool gates cover one response with multiple reasoning items and a same-turn MCP tool
  round. A search-off replay gate must ask about a fact present only in the prior search result body,
  not a fact already copied into the prior assistant answer.

## Constraints

- Reuse `ai` and `@ai-sdk/open-responses` for DeepSeek's stateless plaintext Responses transport;
  OpenAI, Azure, and Codex remain on `@ai-sdk/openai`.
- Do not add `@ai-sdk/deepseek` or another search service dependency.
- Do not use the experimental Open Responses extension registry or depend on unreleased bare-tool
  support. The adapter must continue to handle DeepSeek's unnamespaced search items explicitly.
- Do not mutate persisted provider base URLs.
- Do not add a database migration.
- Do not broaden provider-db search capability metadata to relays or aggregators.
- Preserve abort signals, proxy handling, headers, and existing non-DeepSeek behavior through the
  fetch adapter. DeepSeek request traces are emitted from the validated, fully transformed wire
  body immediately before network I/O, so they contain the injected search tool and restored search
  items rather than private markers. Tracing is per validated fetch invocation: streaming disables
  SDK retries, while one-shot SDK retries may produce more than one trace row.
- Bound normalized URL projection and reject unreasonably large replay envelopes; the full accepted
  opaque item remains the replay source of truth.
- Treat `@ai-sdk/open-responses` as an actively evolving protocol dependency: request-shape,
  id-less reasoning, raw-chunk, and unknown-item behavior remain covered by executable conformance
  tests before dependency upgrades.

## Non-goals

- Supporting DeepSeek V4 Pro, custom relays, or third-party DeepSeek aggregators.
- Adding conversation-level search settings or restoring legacy external-search infrastructure.
- Implementing DeepSeek Responses state storage or `previous_response_id` chaining.
- Exposing `reasoning.effort = 'none'` as a cross-route thinking-off product control.
- Generalizing arbitrary provider response items into a public extension protocol.
- Restoring the retired external-search drawer or inventing citations from page-navigation actions.
- Adding inline numbered references for provider URL-citation annotations.

If an external search stack is reintroduced later, its interaction with provider-native search must
be specified at that time; no such runtime exists today.

## Open Questions

None. The product semantics remain unchanged: turning search off does not offer a new search tool,
while compatible historical search items are still replayed. Migration-specific real-key checks in
the acceptance criteria remain blocking validation gates rather than unresolved design choices.
