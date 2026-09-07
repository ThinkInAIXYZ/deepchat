# Model Capability Identity Specification

## Background

DeepChat serves models through provider profiles such as Moonshot, New API, OpenCode Go, and
ZenMux. A provider profile identifies credentials and a service endpoint, while an effective
transport identifies the HTTP protocol used for one model. Neither identity necessarily names the
provider-db entry that owns the model's capabilities.

The current runtime conflates these identities. New API correctly matches `kimi-k3` to
`moonshot/kimi-k3` while resolving its route, but the AI SDK runtime later derives capability
ownership from the OpenAI-compatible endpoint and replaces `moonshot` with `openai`. The resulting
`openai/kimi-k3` lookup is unknown, unknown temperature support is flattened to `true`, and the
request sends the stored default temperature. Kimi K3 rejects that request.

The same duplicated resolution affects OpenCode Go's Anthropic routes. Renderer settings also
derive capability ownership locally, so fixing only the request path would leave controls and
effective wire behavior inconsistent. Reasoning portraits currently have an independent
cross-provider fallback; for `openai/kimi-k3` it deterministically selects the incomplete
`aihubmix/kimi-k3` portrait instead of Moonshot's complete record.

The first renderer convergence still leaves generation-control presentation split across multiple
paths. ModelConfigDialog and ChatStatusBar consume request policy, while ChatConfig receives only
the flattened temperature-support boolean from `useModelCapabilities`. This produces a stable
wire/UI mismatch for provider records such as `aihubmix/kimi-k3`: its catalog temperature is
unknown, so the legacy boolean becomes `true`, but the K3 wire policy still omits temperature.
Capability loading and failure are also represented as passthrough policy plus unknown support, so
an editable control can appear before resolution or remain after an IPC failure.

## Goals

1. Model service identity, transport identity, and provider-db capability identity as separate
   concepts.
2. Make one main-process resolver the authoritative producer of capability identity.
3. Resolve New API routes in two acyclic phases:
   - derive a coarse model-family hint from model ID and owner metadata, then choose the endpoint;
   - resolve the complete capability identity using model ID, owner metadata, and the selected
     endpoint.
4. Make runtime, settings, agent generation defaults, and renderer capability controls consume the
   same resolved identity and capability snapshot.
5. Preserve `true`, `false`, and `unknown` capability states until request policy chooses a wire
   behavior.
6. Generalize the existing Kimi fixed-temperature policy into a model request policy that can pass
   through, fix, or omit generation parameters.
7. Support Kimi K3 through Moonshot direct and aggregator routes without sending unsupported
   sampling or legacy thinking controls.
8. Restore Grok reasoning effort in the final OpenAI-compatible request body.
9. Remove repeated route and capability work without adding a new memoization or cache-invalidation
   subsystem.
10. Preserve reasoning capabilities for recognized model-origin families without restoring
    provider-order-based cross-provider portrait selection.
11. Make renderer generation controls an atomic projection of the same effective request policy
    used by the final wire request, with explicit internal loading and error states.

## Required Invariants

### Identity boundaries

For every model execution:

- service identity owns credentials, base URL, rate limits, and provider-level configuration;
- transport identity owns the AI SDK provider kind and effective endpoint;
- capability identity owns the provider-db model record used for all model capabilities.

For New API Kimi K3 the identities are:

```text
service provider:    new-api
transport endpoint:  openai
capability provider: moonshot
capability model:    kimi-k3
```

An OpenAI-compatible endpoint is not evidence that the model belongs to OpenAI. Transport fallback
may be used only after explicit, provider-local, owner, family, and catalog matches fail.

`LLM_PROVIDER.capabilityProviderId` remains a provider-level explicit override for compatibility
with existing profiles and imports. A per-model New API resolution is request-local and is not
written into provider persistence or model configuration.

### Two-phase New API resolution

Phase 1 accepts only model ID and owner metadata and returns a coarse family hint used to choose an
Anthropic or Gemini endpoint when appropriate. The hint type is closed and narrow:

```text
anthropic | gemini | undefined
```

Phase 1 never consumes a Phase 2 result. `NewApiRouteMeta.capabilityProviderId` is replaced by
`capabilityFamilyHint` so the field cannot be mistaken for an authoritative override.

Phase 2 accepts the selected endpoint in addition to model ID and owner metadata. It resolves one
capability identity using this precedence:

1. explicit provider-level capability override;
2. explicit main-process route override;
3. provider-local exact or canonical provider-db match;
4. qualified model namespace;
5. recognized owner;
6. recognized model family;
7. transport-provider match;
8. unique global exact or canonical match;
9. transport fallback with an unknown catalog model.

An ambiguous global match is not selected by provider iteration order. All capabilities for a
resolved model use the same provider and catalog model identity.

Qualified namespaces, owner metadata, and canonical model-family rules may identify a known model
origin even when an aggregator returns an unqualified ID. The maintained origin rules cover
families with an authoritative provider-db owner, including GLM, MiniMax, StepFun, Mistral, Cohere,
and OpenAI GPT-OSS. Families without an authoritative owner record, or whose provider-db mirrors
disagree about reasoning semantics, remain unknown rather than selecting an arbitrary mirror.

Resolved identity distinguishes the ID sent to the service from the optional ID selected in the
catalog:

```text
requestModelId: the unchanged request-facing model ID
catalogModelId: the matched provider-db model ID, or null when unmatched
```

`catalogMatched` discriminates those two states. Request policy always consumes `requestModelId`;
catalog capability reads always consume `catalogModelId`.

### Capability snapshots

The main process returns one capability snapshot per provider/model selection. The snapshot contains
the resolved identity, reasoning portrait, sampling capability, search defaults, and effective
generation-parameter policy. Field-level compatibility getters are removed after their callers
migrate to the snapshot, except for the audio-input fallback required before provider-model runtime
facts are available.

Renderer components do not import or execute capability-provider routing rules. ChatStatusBar and
ModelConfigDialog consume the snapshot returned by the typed models capability route. Agent
generation settings consume the same main-process resolution contract.

`useModelCapabilities` is the renderer owner of capability snapshot lifecycle and generation-control
projection. It stores one atomic snapshot together with `idle`, `loading`, `ready`, or `error`
status. ChatConfig, ChatStatusBar, and ModelConfigDialog consume that state instead of maintaining
independent policy and temperature-capability refs. A new query invalidates presentation from the
previous query immediately; stale responses cannot restore it.

Loading and successful unknown capability are distinct states. Loading reserves the control's
layout with a skeleton and exposes no editable sampling input. A successful unknown model preserves
passthrough compatibility. An IPC failure remains an internal error state for diagnostics and race
control, but generation controls are silently hidden instead of exposing infrastructure errors to
the user. It never becomes passthrough. Once the failed query matches the current provider and model
identity, unrelated model configuration remains saveable while hidden generation values are
preserved.

The snapshot does not expose a speculative resolution-source field. Request tracing currently has
no metadata contract that consumes it; diagnostics should be added only together with a real trace
consumer.

State-dependent fixed policy uses the editor's explicit draft reasoning when supplied. Other
snapshot consumers fall back to persisted model reasoning only for the narrow fixed-temperature
model family; unrelated capability queries do not derive complete model configuration.

The capability query is one shared schema-derived contract containing provider ID, model ID,
optional route override, and optional `reasoningEnabled`. ProviderSettings accepts that query
directly rather than a positional provider/model pair plus a nested options object. A caller may
provide either draft query fields or one already resolved model configuration, never both.
Runtime consumers pass only the resolved model configuration; renderer queries pass only draft
fields. If neither supplies reasoning state, the narrow persisted Kimi fallback above remains
authoritative.

The `reasoningEnabled` name ends at the capability-query and request-policy resolver input
boundary. `ModelRequestPolicy.reasoning` remains the policy governing the reasoning parameter,
parallel to `temperature`, `topP`, and `legacyThinking`. `ModelConfig.reasoning` remains the
backward-compatible persisted configuration field.

The route output schema matches the resolved snapshot producer. `supportsAudioInput`,
`supportsReasoning`, `supportsSearch`, `supportsTemperatureControl`, `thinkingBudgetRange`, and
`searchDefaults` are non-null after a snapshot resolves. `reasoningPortrait` remains nullable.
`temperatureCapability` remains the only tri-state capability field and converts internal
`undefined` to `null` at the typed IPC boundary. Optional reasoning-effort and verbosity defaults
remain optional because absence means that the catalog declares no default.

Renderer lifecycle nullability is separate from resolved field nullability. While a query is
`idle`, `loading`, or `error`, the renderer may expose `null` because no resolved snapshot is
available. Contract tightening must remove only fallbacks that assume a present snapshot contains
nullable required fields; it must preserve snapshot-level lifecycle guards.

### Generation parameter policy

Model request policy uses a discriminated union:

```text
passthrough
fixed(value)
omit
```

Stored session and model generation settings remain user intent. Policy is applied only when
constructing effective UI controls and the final wire request; switching to another model restores
the stored values without migration or destructive normalization.

Kimi behavior is:

| Model family | Temperature | Top P | Reasoning | Legacy `thinking` |
| --- | --- | --- | --- | --- |
| K2 fixed-temperature models | Fixed by existing reasoning state | Passthrough | Existing behavior | Existing behavior |
| K3 | Omit | Omit | Required | Omit |

K3 matching uses exact canonical model identities rather than substring matching. It remains safe
when provider-db is unavailable or an aggregator exposes a recognized K3-qualified model ID.
Recognized canonical aliases are `kimi-k3`, `kimi-k3-free`, `coding-kimi-k3`, and
`coding-kimi-k3-free`, including qualified and separator-normalized forms. One shared matcher owns
both request policy and the temporary reasoning-metadata fallback.

Unknown model capabilities retain the current compatibility behavior: user-provided parameters
pass through unless an explicit model request policy says otherwise. Unknown does not become
`true` inside the capability layer.

The capability snapshot exposes wire-effective temperature policy. An explicit `fixed` or `omit`
model policy wins. Otherwise, catalog temperature `false` converts passthrough to `omit`, while
catalog `true` and unknown remain passthrough. Runtime and renderer consume this normalized policy;
neither independently combines policy with the legacy flattened support boolean.

Renderer number controls project the normalized policy without provider or model-family branches:

| Effective policy | Renderer control |
| --- | --- |
| `passthrough` | Editable |
| `fixed(value)` | Visible, locked, and explained using `value` |
| `omit` | Hidden |

Reasoning-effort support is not a sampling-policy proxy. Effort-capable models with explicit
temperature support remain editable; models such as OpenAI GPT-5 and o3 remain hidden because their
temperature capability already normalizes policy to `omit`.

Streaming, non-streaming, and request tracing use one effective generation-parameter serialization
per physical request.

### Reasoning effort

Kimi K3 reasoning effort has options `low`, `high`, and `max`, defaulting to `max`. Until
provider-db publishes those fields, DeepChat supplies that exact model fallback; later explicit
catalog fields override the fallback. `medium` is not offered for K3.

Runtime effort normalization is K3-specific. It may choose K3's supported default or remove an
inherited K3 effort when the authoritative K3 portrait declares a non-effort mode. It does not
inject, normalize, or remove effort values for unrelated models; their established model-config
behavior remains unchanged.

DeepChat supplies the standard AI SDK `reasoningEffort` provider option. The installed
`@ai-sdk/openai-compatible` adapter serializes that option as `reasoning_effort`. DeepChat does not
add a duplicate New API snake-case path.

Grok Mini models use the same standard option while retaining the existing model-family guard.
The former custom `reasoning_effort` provider option is removed because the adapter's later
standard-field assignment overwrites it.

### Performance and state

The implementation removes repeated work rather than introducing speculative caching:

- one route decision per request;
- one authoritative Phase 2 capability identity per request;
- one capability snapshot per settings query;
- one effective parameter serialization per request;
- no capability lookup through a cloned full provider-model array.

Route selection reads only persisted route fields before Phase 2. Once identity is known, model
defaults are derived from that identity without resolving it again. Provider model-list mapping
uses a constant-time reasoning-candidate prefilter so models with no catalog reasoning evidence do
not run full route and identity resolution. The short-lived provider-model cache stores a compact
raw route-metadata index separately from its derived renderer model snapshot; both cold and warm
lookups therefore select the same route without scanning the full model list.

Provider-db configuration defaults preserve the pre-existing source boundary. A provider present
in provider-db uses only its own model record unless `LLM_PROVIDER.capabilityProviderId` explicitly
overrides the source. Providers absent from provider-db, such as New API, may use the authoritative
identity resolver. A custom same-name model under a known provider never inherits another
provider's limits or defaults merely because the name is globally unique.

The existing provider-db indexes remain the catalog lookup mechanism. No revision snapshot, LRU,
new persistent cache, or benchmark gate is introduced. No request-path disk or network access is
added.

### External review hardening

Owner and namespace normalization must preserve provider identity across common separator forms.
In particular, `x-ai` owner metadata resolves to xAI after separator normalization, and recognized
dotted provider namespaces such as `meta-llama.llama-3` strip the provider prefix without treating
the hyphenated provider name as the model segment. Token-boundary matching must not classify an
unrelated owner such as `flux-ai` as xAI. Versioned model IDs such as `gpt-4.1-mini` remain intact.

Stored non-New API model metadata remains authoritative for model type after the existing video
compatibility rules are applied. Route-only metadata and the fully resolved provider model
therefore use the same video-detection and model-first fallback sequence. New API retains its
explicit user-selection and media-route precedence.

Explicit DashScope thinking budgets remain request intent even when a custom model has no resolved
reasoning portrait. Portrait support is still required before enabling thinking automatically or
using a portrait-provided default budget.

An editable model identity owns its capability-query lifecycle. Programmatic model-ID changes,
input changes, reset flows, and autofill cannot leave a snapshot in loading without scheduling a
query. Repeated blur for an already resolved or in-flight identity does not refetch, while route,
model-type, and reasoning changes continue to force policy refreshes for the same model ID.

Fixed generation policy also owns initial renderer values. Both fixed temperature and fixed top P
override stored model defaults in ChatStatusBar without overwriting the stored intent. Manual
compaction passes its already resolved provider-model facts to every downstream capability
consumer instead of resolving the same model configuration and snapshot twice.

## Acceptance Criteria

1. New API `kimi-k3` resolves capability identity to `moonshot/kimi-k3`, not
   `openai/kimi-k3`.
2. New API K3 reasoning uses Moonshot's complete portrait, preserving `interleaved`, `summaries`,
   `visibility: summary`, and `continuation: [thinking_blocks]`; it does not use the incomplete
   Aihubmix portrait.
3. Moonshot direct K3, New API `kimi-k3`, and qualified K3 aliases omit temperature and top P from
   streaming, non-streaming, and traced request bodies.
4. `coding-kimi-k3`, `coding-kimi-k3-free`, `kimi-k3-free`, and separator-normalized canonical
   aliases receive the same K3 request policy; unrelated suffix or substring matches do not.
5. K3 does not emit the legacy Kimi `thinking` object and reasoning cannot be disabled in the
   effective UI policy.
6. K2 fixed-temperature and thinking behavior remains unchanged.
7. OpenCode Go Anthropic routes retain Anthropic capability identity through final request
   construction.
8. ZenMux Anthropic behavior remains correct without a duplicate shared routing rule.
9. Unknown custom OpenAI-compatible models retain pass-through generation behavior.
10. K3 effort controls expose exactly `low`, `high`, and `max`, defaulting to `max`; later explicit
   provider-db metadata overrides the local fallback.
11. Non-K3 effort-capable and non-effort models retain their previous runtime model-config values.
12. New API K3 `reasoningEffort: max` produces final wire field `reasoning_effort: "max"`.
13. Grok Mini `reasoningEffort: high` produces final wire field `reasoning_effort: "high"`;
    unsupported Grok models do not gain reasoning-effort behavior.
14. New API GLM, MiniMax, and GPT-OSS examples retain reasoning support through a deterministic
    origin identity or origin fallback, while conflicting unknown families remain unresolved.
15. A known provider's custom same-name model does not inherit another provider's derived model
    configuration; New API still receives origin-derived defaults.
16. ChatStatusBar and ModelConfigDialog show generation controls from the main-process policy and
    contain no local capability-provider resolver.
17. A request calculates its route, Phase 2 capability identity, and effective generation
    parameters once each, and cache warmth cannot change the Phase 1 route metadata.
18. Capability resolution performs no full provider-model clone and requires no new persistent
    data or migration.
19. Provider-option unit tests and runtime use explicit request policy and reasoning portrait
    inputs; the mapper has no hidden cross-provider portrait fallback.
20. Existing provider, model import/export, renderer, agent, and direct-provider behavior remains
    compatible unless explicitly changed above.
21. Direct Aihubmix K3 and any recognized K3 alias hide temperature and top P from every renderer
    entry even when the selected provider's catalog temperature is unknown.
22. Initial capability loading and model switching reserve generation-control layout with a
    skeleton; they never expose stale or editable sampling controls and do not cause the first
    control section to collapse and reappear.
23. Capability IPC failure remains internally distinguishable from unknown support, produces no
    user-facing error or retry control, hides generation controls, and does not synthesize a
    passthrough policy.
24. Fixed temperature and top-P controls use generic request-policy state and policy values;
    renderer code contains no Kimi-specific lock branch, and rendering hidden or fixed controls
    does not itself clear or overwrite stored intent. Existing provider normalization at the save
    boundary remains compatible.
25. A cross-layer policy matrix proves that renderer hidden, fixed, and editable states correspond
    to the same omit, fixed, and passthrough policies used by final request serialization.
26. `ownedBy: x-ai` resolves through the xAI owner path, and recognized hyphenated dotted provider
    namespaces normalize to their model ID without changing versioned unqualified IDs.
27. Non-New API route metadata applies the same video compatibility and stored-model-first fallback
    as the resolved provider model, while New API type precedence remains unchanged.
28. An explicit DashScope thinking budget is serialized for an unresolved custom-model portrait;
    automatic thinking enablement and portrait budget defaults still require supported metadata.
29. Model-ID changes schedule exactly one capability refresh without requiring blur, and blur of
    an already resolved identity performs no redundant query.
30. ChatStatusBar initializes fixed top P from policy, and manual compaction reuses one resolved
    provider-model fact set for input capabilities.
31. Capability route overrides and draft reasoning use one schema-derived query type. The main
    resolver accepts a named input and statically rejects combining draft fields with an already
    resolved model configuration.
32. Capability query and request-policy resolver inputs use `reasoningEnabled`; the wire policy
    field remains `ModelRequestPolicy.reasoning`, and persisted `ModelConfig.reasoning` remains
    unchanged.
33. A resolved capability response rejects null for audio input, reasoning, search, temperature
    control, thinking-budget range, and search defaults. Reasoning portrait and tri-state
    temperature retain their documented nullable semantics.
34. During capability loading or a settled IPC error, renderer reasoning support remains `null`
    rather than collapsing to `false`, and temperature/top-P controls remain non-editable. Schema
    tightening does not remove snapshot-level lifecycle state.
35. ProviderSettings exposes no unused field-level capability projections. Database model mapping
    consumes the snapshot directly, while the pre-runtime audio-input fallback remains available.

## Constraints

- The implementation targets the provider packages pinned by the current lockfile.
- The provider-db cache may refresh while the application is running; existing catalog-change
  rebuilding remains authoritative.
- Provider IDs, API keys, base URLs, and model settings remain backward compatible.
- New user-facing policy descriptions use typed renderer contracts and i18n keys.
- Every local commit requires a severity-ordered review covering hidden side effects,
  compatibility, boundary cases, performance, security, naming, tests, and maintenance cost.
- No branch push, pull request, or GitHub issue is created as part of this work.
- SDD artifacts in this directory use English prose.

## Non-Goals

- Adding New API itself to provider-db.
- Selecting an arbitrary provider from ambiguous global same-model matches.
- Replacing the existing provider-db loader or index with a new caching architecture.
- Changing Moonshot's connection-check model.
- Removing support for provider-level capability overrides.
- Fixing OpenAI-compatible deprecation warnings caused by hyphenated provider option names.
- Broadly redesigning all provider-specific request options.

## Open Questions

None. The identity precedence, two-phase dependency, policy semantics, compatibility behavior, and
validation requirements are fixed by this specification.

## Evolution

The later
[`model-config-source-of-truth`](../model-config-source-of-truth/spec.md) architecture replaces the
historical provider-derived model-config cache described by this specification. Capability identity
remains authoritative, while sparse provider facts live only in `provider_models`, user intent
lives only in `model_configs`, and complete effective configuration is derived at read time. Its
one-time user-only migration is an evolution of storage ownership rather than a capability-identity
cache.
