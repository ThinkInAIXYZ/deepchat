# Model Capability Identity Implementation Plan

## Architecture and contracts

Add a main-process capability identity module that owns both phases of New API capability
resolution. Phase 1 accepts only model ID and owner metadata and returns only an Anthropic or Gemini
family hint. It may query provider-db family evidence by those inputs, but cannot consume an
endpoint or any Phase 2 result. Shared endpoint routing consumes the renamed
`capabilityFamilyHint`. Phase 2 accepts the selected endpoint and returns a resolved
provider/catalog model identity.

Split the current shared helper by responsibility. Keep endpoint selection utilities in
`@shared/model`; move the transport capability fallback and ZenMux explicit override into the
main-process capability identity module. Remove `BaseProvider.getCapabilityProviderId`, which has no
callers and represents a third resolution rule.

Audit every current `resolveProviderCapabilityProviderId` caller. Main-process model configuration,
provider model mapping, New API discovery, route decisions, settings getters, and agent generation
defaults must either consume the authoritative identity or use an explicitly named transport-only
fallback. Renderer imports are removed.

## Capability snapshot

Introduce a typed resolved capability snapshot in the provider settings port. ProviderSettings
collects effective route metadata without cloning the complete provider model list, resolves
identity once, and reads all capabilities from that identity. Existing field-level methods delegate
to the snapshot during migration.

Extend the existing models capability route and schema with:

- resolved capability provider and catalog model identity;
- temperature's tri-state value;
- generic generation-parameter policies for temperature and top P;
- required or optional reasoning state and legacy thinking behavior.

ChatStatusBar and ModelConfigDialog consume these fields and remove their local capability routing.
The renderer keeps user values in state but hides or locks controls according to effective policy.
Agent generation settings obtain identity and reasoning defaults from the main-process snapshot
instead of independently deriving endpoint capability semantics.

## Runtime integration

Resolve a route decision exactly once at each request boundary and pass it into
`buildRuntimeContext`. Model-config patching consumes that decision instead of recalculating it.
RouteDecision carries the resolved capability identity, and AiSdkRuntimeContext receives the same
immutable request-local value.

Remove runtime calls that ask ProviderSettings to derive capability ownership again. Prompt/provider
options, reasoning, temperature, top P, and request tracing consume the context identity.

Preserve tri-state temperature capability through policy resolution. Unknown remains pass-through
for compatibility. Delete the dead branch that attempts to recover tri-state after
`supportsTemperatureControl` has already returned a boolean.

## Model request policy

Generalize the existing Moonshot Kimi policy types to support pass-through, fixed, and omitted
parameters. Preserve the existing K2 temperature/reasoning contract. Add exact canonical K3 policy:

- omit temperature;
- omit top P;
- require reasoning;
- omit legacy `thinking`.

Build one effective generation-parameter object for each request and reuse it for request tracing
and the AI SDK call in both generate and stream paths. Do not clear or rewrite persisted model or
session settings.

Expose the generic policy through the capability snapshot. Replace Kimi-specific renderer control
logic only where the generic policy provides the same or stronger behavior; retain K2-specific
copy only if it remains necessary to explain its two fixed values.

## Reasoning effort and provider metadata

Consume K3 reasoning metadata with effort mode, options `low`, `high`, and `max`, and default `max`.
Because the current generated provider-db resource does not contain those effort fields, provide an
exact K3 fallback in the existing portrait fallback layer. Merge explicit catalog fields after the
fallback so a later background catalog refresh remains authoritative without a code change.

Replace Grok's custom snake-case provider option with the standard `reasoningEffort` option, guarded
by the existing Grok Mini family check. The installed OpenAI-compatible adapter maps the standard
option to the final snake-case body field. Add real-adapter fetch-capture tests for both New API K3
and Grok so mapper-only tests cannot pass while the wire field is lost.

## Performance and compatibility

Add a narrow provider-model route metadata getter backed by the provider-model composite primary
key for SQLite stores, with the existing short-lived model cache and legacy store fallback. Do not
call `getProviderModels().find()` from SQLite capability resolution. The getter returns only
endpoint, supported endpoints, model type, and owner metadata.

Do not add a new catalog snapshot, resolution memo, LRU, or persistent cache. Existing provider-db
indexes and catalog-change rebuilds remain in place. Focused tests assert single route/capability
resolution and final wire output rather than unstable wall-clock thresholds.

No database migration is required. Existing provider-level `capabilityProviderId` values remain
valid explicit overrides. Existing capability route response fields remain during migration so
older renderer call sites and tests can be updated incrementally.

## Post-implementation review hardening

Use one shared canonical model-ID normalizer and K3 matcher for request policy and temporary
reasoning metadata. Recognize the catalog's current coding and free K3 aliases without accepting
arbitrary substring matches.

Extend Phase 2 with explicit model-origin rules for provider-db families that have an authoritative
owner. Do not reinstate portrait-registry provider sorting. OpenAI GPT-OSS receives only its
well-established reasoning-supported fallback when the official OpenAI catalog lacks the model;
sampling, limits, tools, and richer portrait fields remain unknown.

Replace the overloaded identity model ID with a discriminated request/catalog identity. Use the
request ID for wire policy and the catalog ID only for provider-db reads.

Split route-only persisted configuration reads from complete derived model configuration. Runtime
selects the route and capability identity first, then derives complete model defaults from that
identity. Settings capability queries use the same route-only path. Keep known provider model
configuration strict and permit cross-provider identity defaults only for explicit overrides or
providers absent from provider-db.

Scope runtime reasoning-effort correction to K3. Make provider option policy and portrait inputs
required, replace DashScope's hidden catalog reads with the supplied portrait, and encode
Anthropic top-P omission in the main-process request policy so renderer and runtime share the same
rule.

Short-circuit provider model-list capability mapping when stored reasoning is already true or no
reasoning candidate exists. Mark the internal provider-model cache view readonly and keep cloning
at the public mutation boundary. Keep a compact raw route-metadata index beside the derived model
snapshot so route lookup remains constant-time and cannot change according to cache warmth.

## Renderer generation-control convergence

Normalize temperature capability into the main-process request policy snapshot. Preserve explicit
fixed and omitted model policies; convert passthrough to omit only for catalog temperature `false`.
Unknown remains passthrough. Runtime request serialization consumes this effective policy directly,
so the snapshot field is the single wire and renderer decision.

Extend `useModelCapabilities` to own an atomic capability snapshot, query lifecycle, internal error
state, query identity, and a pure number-control projection. Support both its existing watched
provider/model mode and manual queries with route and reasoning options so ModelConfigDialog and
ChatStatusBar can use the same owner without adding requests. Starting a query clears the prior
snapshot and exposes loading; request tokens still reject stale responses.

Migrate ChatConfig, ChatStatusBar, and ModelConfigDialog to the composable projection. Remove their
independent request-policy and temperature refs. Replace Kimi-specific fixed-control checks with
the generic fixed policy value. Remove reasoning-effort as a temperature-visibility proxy; explicit
temperature policy remains authoritative.

Render a stable skeleton in the temperature control slot while loading. On error, silently hide
generation controls while retaining the internal error and failed query identity; do not expose a
retry prompt or editable fallback. A successful unknown snapshot still renders passthrough controls
for custom-model compatibility. The renderer does not clear or overwrite stored generation values
merely because a control becomes hidden or fixed; existing save-boundary provider normalization
remains unchanged. Require either a current ready snapshot or a settled failure for the current
provider/model identity before saving its configuration.

Resolve state-dependent fixed policy from an explicit editor reasoning override when available.
For read-only consumers, use persisted reasoning only after the fixed-temperature family prefilter
matches, so ordinary capability queries retain the route-only fast path.

Add a cross-layer matrix test that feeds the same effective policy into renderer presentation and
runtime serialization, covering passthrough, fixed, capability-derived omit, and explicit K3 omit.
Add direct Aihubmix K3, initial loading, silent error, rapid model switch, K2 fixed value, and
effort-plus-temperature renderer regressions.

## Capability query contract hardening

Define `CapabilityRouteOverrideSchema` and `CapabilitySnapshotQuerySchema` in the shared capability
domain and derive their TypeScript types with `z.infer`. The query directly contains provider ID,
model ID, optional route override, and optional `reasoningEnabled`; remove the separate
`CapabilitySnapshotOptions` shape and the duplicate inline route schema.

Change `ProviderSettings.getCapabilitySnapshot` to accept one named resolution input. Model the two
legal caller modes as an exclusive union or equivalent overloads:

- renderer and typed-route callers provide the shared draft query;
- runtime callers provide provider ID, model ID, and one already resolved model configuration.

Do not allow a caller to combine route/reasoning draft fields with a resolved configuration.
Preserve the narrow persisted Kimi reasoning fallback only when neither caller mode supplies an
effective value. Rename the pure request-policy resolver input to `reasoningEnabled`, but retain
`ModelRequestPolicy.reasoning` and `ModelConfig.reasoning` because they name the governed wire
parameter and persisted field rather than query state.

Tighten the typed capability response to the producer's actual guarantees. Required support flags,
thinking-budget range, and search defaults are non-null once a snapshot exists. Keep reasoning
portrait nullable and preserve temperature capability's explicit `undefined`-to-`null` IPC
conversion. Audit renderer consumers manually: remove only field-level compatibility fallbacks and
retain null handling caused by an absent snapshot during idle, loading, and error states.

Migrate database provider-model reasoning projection to the authoritative snapshot. Remove the
twelve unused ProviderSettings field projections and their port declarations, while retaining the
audio-input fallback used before provider-model runtime facts exist. Do not remove the snapshot's
derived `supportsTemperatureControl` field, broaden renderer client cleanup, add a DTO mapper, or
introduce capability caching in this slice.

## External review hardening

Harden Phase 2 input normalization for separator-normalized xAI owners and known dotted provider
namespaces. Keep canonical versioned model IDs unchanged, and add direct unit coverage for both the
recognized namespace and preservation paths.

Align non-New API route-only video detection and fallback type precedence with resolved provider
models. Preserve New API's special type rules. Serialize explicit DashScope thinking budgets when
portrait support is unknown while retaining portrait gates for automatic enablement, default
budgets, and explicit unsupported metadata.

Make ModelConfigDialog schedule identity-driven capability refreshes directly and deduplicate an
unchanged ready or in-flight query without suppressing same-model refreshes caused by route, type,
or reasoning changes. Apply fixed top-P policy when initializing ChatStatusBar defaults.

Thread the existing provider-model facts through manual compaction input-capability resolution and
extract the duplicated private embedding runtime context. Do not introduce capability getter
memoization: catalog refresh, route changes, model configuration, and custom-model mutation would
otherwise require a new invalidation contract for no demonstrated hot-path benefit.

Correct renderer and runtime test fixtures so unknown temperature is represented as `undefined`,
served policy remains the authority, effort portraits are internally consistent, fixed controls
cannot emit updates, and wire interception uses a deterministic terminal response.

## Review and commit slices

1. Write and review the architecture SDD and maintained provider runtime contract.
2. Implement and review two-phase capability identity plus capability snapshot.
3. Implement and review generic generation policy and K3 wire behavior.
4. Implement and review K3 effort consumption, Grok wire behavior, renderer convergence, and
   route-resolution de-duplication.
5. Run final validation and a complete severity-ordered branch review before the final commit.

Each review checks hidden side effects, backward compatibility, boundary cases, performance,
security, misleading names, missing tests, and maintenance cost. Findings are fixed before the
corresponding commit and commit messages describe the concrete change rather than the review.

## Validation

Run focused tests after each slice:

- `test/main/provider/modelCapabilities.test.ts`
- `test/main/provider/providerModelCapabilityMapping.test.ts`
- `test/main/provider/newApiProvider.test.ts`
- `test/main/provider/aiSdkRuntime.test.ts`
- `test/main/provider/aiSdkProviderOptionsMapper.test.ts`
- real OpenAI-compatible provider factory request-capture tests
- `test/main/shared/modelRequestPolicy.test.ts`
- canonical K3 coding/free alias tests
- known-provider model-config source-boundary tests
- GLM, MiniMax, GPT-OSS, and ambiguous-family identity tests
- non-K3 reasoning-effort compatibility tests
- ChatStatusBar and ModelConfigDialog renderer tests
- ChatConfig and `useModelCapabilities` loading/silent-error/policy projection tests
- direct Aihubmix K3 renderer tests
- cross-layer renderer/wire policy matrix
- agent generation settings tests
- named-query false preservation and mutually exclusive resolution-input coverage
- capability response schema rejection for null required fields
- renderer loading/error lifecycle tests proving reasoning remains unknown and sampling controls
  remain non-editable

Before handoff run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, full type checking, the
relevant provider and renderer suites, the full test suite, and the production build when the
environment permits. Review and retain expected generated provider/ACP registry refreshes according
to repository policy.
