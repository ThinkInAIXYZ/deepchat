# Tool Surface Virtualization Specification

## Status

Approved architecture contract. Revised 2026-08-11. This decision preserves V1 compatibility and
defines the Programmatic and Execution Journal v2 work that remains to be implemented.

## Decision

DeepChat uses one capability foundation and two immutable per-View tool surfaces:

```text
Owned capabilities
  -> frozen Run Tool Ceiling
  -> per-View Eligible Catalog
  -> immutable View capability snapshot
       |- Provider Active Surface
       `- Programmatic Surface
```

Runtime is online authority. Tape is bounded historical evidence and is never read on the ordinary
dispatch hot path. A transient physical retry reuses the same `requestSeq` and exact snapshot;
context recovery or effective expansion creates a later View. Current revocation may shrink
authority immediately.

For every stable target, the Provider Active Surface and Programmatic Surface are mutually
exclusive within a View. The first determines provider-native callable definitions. The second
determines targets callable through Agent-scoped `deepchat tool` commands. Provider-active,
core/native, diagnostic, runtime-only, ineligible, and revoked targets are excluded from the
Programmatic Surface.

## Motivation

DeepChat currently transmits every resolved tool definition on each provider request. A growing MCP,
Agent, Plugin, and Skill catalog consumes context, degrades model selection quality, encounters
provider limits, and causes contract-bearing V5 construction to fail above 256 identities or 64 KiB.
Native Activation bounds provider exposure and remains necessary for chat/weak-CLI models, but each
later-View schema activation changes the provider tools prefix and can invalidate cached conversation
history. CLI Programmatic removes that catalog-driven schema churn by carrying discovery and results
in appended messages while preserving real target dispatch identity. It does not eliminate cache
invalidations caused by Skill/system/core changes, compaction, recovery, or model/config changes.

## Principles

1. Freeze ceilings and adapter choice; recheck current authority at execution.
2. Virtualize exposure, never target identity or approval ownership.
3. Search is discovery, not authorization, activation, or execution.
4. Provider Context records provider-visible operations; Journal records physical execution truth.
5. Same durable identity plus different canonical payload is corruption.
6. No automatic retry, replay, redelivery, or recovery crosses an uncertain effect boundary.
7. Historical V1 facts and contracts remain readable and are never rewritten.

## Scope and Non-Goals

This decision covers DeepChat Agent Runs, excluding ACP, and defines surface assembly, adapter
selection, CLI protocol, capability binding, nested execution, Tape provenance, and cache/cost
evaluation. It retains the existing small-catalog/native and V1 Journal behavior.

Permanent Non-Goals are an arbitrary-code Shell/JavaScript sandbox, a human raw MCP tunnel, and an
unscoped generic raw MCP invocation API. Also excluded are recursive programmatic calls, unbounded or
dynamic batch plans, cross-restart batch resume, and automatic reconciliation of indeterminate
operations.

## Retained P0-A Shadow Measurement Contract

P0-A computes catalog identity, definition hashes, candidate virtualization decisions,
hypothetical initial surfaces, schema-token estimates, and static surface overlap across
consecutive requests. It must not change provider-visible tools or ordering, add native
`tool_search` or CLI routes, alter an ExecutionContract ceiling, write Tape facts, or persist raw
schemas, descriptions, prompts, user text, or provider payloads. Measurements are bounded,
content-free process diagnostics: counts, token estimates, trigger/reason codes, static overlap,
and provider cache fields that actually exist. Unavailable values are not fabricated. Collector
failure is bounded, ignored, and cannot affect generation.

## Domain Contract

### Owned Capabilities, Run Tool Ceiling, and Eligible Catalog

At Run creation the universe contains current Agent policy, enabled MCP and Plugin contributions,
system-model policy, and conditional definitions and declared requirements of **every** currently
valid enabled Skill. Absent Skill `allowedTools` declares no additional named requirement. Names
resolve through execution's source mapping and reserved-name rules. An unresolved or ambiguous
inactive-Skill requirement makes that Skill non-activatable for this Run with bounded degradation;
the same defect in an initially active mandatory Skill fails admission. Shadow diagnostics retain
only counts/reason codes.

An automatic canary assignment that cannot prove a complete universe, but has no initially active
mandatory defect, is excluded from managed adapters and retains legacy delivery for that Run.
Explicit managed modes and initially active mandatory defects still fail admission because they
cannot claim a complete frozen ceiling.

The TaskContract meet precedes freezing maximum stable targets as the Run Tool Ceiling. This is not
the resolver's initially active Skill profile. The ceiling binds stable target/definition identity,
never becomes persisted authority, and never expands. Current revocation may remove or reject a
target immediately; newly installed/enabled capability waits for a new Run. Contract-bearing child
TaskContract ceilings are met first; the per-View provider ExecutionContract is narrower.

```text
Eligible Catalog =
  Run Tool Ceiling
  meet current runtime authority
  meet current Skill state
  minus current revocations
```

Skill activation exposes only ceilinged definitions and atomically preflights membership/budget
before Skill or prompt mutation. New, newly enabled, unresolved, ambiguous, or definition-drifted
targets wait for a new Run; changed runtime definition makes the old entry stale. Search reads only
its originating frozen catalog, never process- or Session-global latest state.

### Foundation and ToolSurfaceSnapshot

The Run Tool Ceiling is frozen from owned Agent, MCP, Plugin, Skill, and system-model capabilities
after the TaskContract meet. It never expands. Each View derives an Eligible Catalog by meeting the
ceiling with current Skill state and runtime authority and subtracting revocations. One deeply
immutable snapshot binds request identity, catalog, both surfaces, definitions, policy versions,
adapter mode, ceilings, and hashes. The exact value follows provider payload construction, runtime,
and synchronous surface-fact derivation; persistence receives only the hashes, bounded fields, and
projections specified below. A Session-global latest snapshot is forbidden. Specifically it carries
`sessionId`, `messageId`, `runId`, `requestSeq`, adapter mode, policy/ordering/canonicalization
versions, virtualization decision and budgets, full catalog hash and bounded entries, ordered
provider-active definitions, Programmatic Surface and capability, per-target
`canonicalToolDefinitionHash`, accepted activation provenance, and bounded degradation. The same
value, by reference or canonical identity, serves payload/capability assembly, surface-fact
derivation, V5 contract, dispatch guards, and the complete tool batch.

Definition drift makes the originating capability stale. Current permission, approval, target,
revocation, abort, and binding checks remain authoritative immediately before T1. Tape cannot grant
or restore authority.

### Provider Active Surface

The Provider Active Surface is the ordered set of complete native tool definitions sent to the
provider. Existing V1 native activation semantics remain compatible: provider-visible targets use
their real identity, and an eligible activation affects only a later View. V5
`ExecutionContract.ceilings` continues to contain only provider-visible tools; Programmatic targets
must not be inserted into that field.

Native Activation retains a Run-scoped activation ledger. Initial order is deterministic; prior
entries keep ordinals and accepted candidates append in one sorted batch. Ranking/budget never
evicts an active entry. Revocation filters without deleting its ordinal; restored authority resumes
that ordinal. Catalog hashing uses canonical stable-target order, not append history.

#### Activation Candidates (Native Activation only)

Candidates are identified by `sessionId`, `messageId`, `runId`, `requestSeq`, assistant-batch tool
call ordinal, result rank, and stable target. Results say pending/candidate or a statically knowable
rejection; they are not authority and cannot activate in the originating View. Release follows the
durable ToolSearch `tool_outcome`, is operation-idempotent, and waits for complete batch settlement.
Merge by requestSeq, persisted call ordinal, rank, stable target, then deduplicate; opaque provider
call IDs are never ordering keys.

Before the next request recheck ceiling, live authority, definition identity, and budget. Stage
accepted candidates and update the ledger only at provider admission—after facts for strict V5 or
bounded diagnostics for V4. In-process preflight recovery keeps candidates pending. Crash before
admission discards them; recovery after provider start carries the committed ledger. Tape or mutable
catalogs never reconstruct them. A later release queues behind an older release deferred by recovery;
each admitted View consumes at most one bounded release in originating-request order. They never
cross Runs, and incomplete batches cannot start Views.

### Programmatic Surface and Capability

The Programmatic Surface is the complete, hard-bounded set of targets available only to the CLI
Programmatic adapter. Its process-live value contains every allowed stable target and definition
hash; the corresponding Tape fact may retain only the bounded projection defined below. It excludes
every provider-active target and every core/native, diagnostic, runtime-only, ineligible, or revoked
target. Membership is frozen per View, while current authority may still deny a call. A catalog that
cannot fit the versioned live-surface count/byte/depth bounds never produces a truncated online
authority. Adapter admission computes the maximum possible Programmatic set from the frozen Run
ceiling, including every ceilinged Skill target that a later View could make eligible. If that set
cannot fit, CLI Programmatic is ineligible and the Run selects Native Activation or fails admission
when no safe adapter exists; overflow is never discovered for the first time after mode freeze.

`ProgrammaticToolCapabilityV1` is versioned and binds at least:

- `sessionId`, `messageId`, `runId`, and `requestSeq`;
- adapter mode, `catalogHash`, and `programmaticSurfaceHash`;
- the complete hard-bounded stable-target and definition-hash set;
- TaskContract reference and effect/workdir/depth ceilings;
- child, batch, input, output, and time quotas;
- policy and canonicalization versions.

The complete canonical capability is process-live only. The same immutable value is used for View
assembly, runtime enforcement, and grant derivation. Persistence synchronously derives its full
`capabilityHash`, exact bounded ceilings/quotas, and a separately bounded target projection with
degradation metadata; Tape cannot reconstruct or restore the live capability. Strict V5 durably
binds the hash and request identity before provider admission and fails closed. V4 surface provenance
may retain its existing fail-open discipline but must not claim unpersisted evidence as verified.
Every real nested child Journal write is strict regardless of manifest version.

The capability cannot contain `providerToolCallId`, which does not exist until a provider response
creates the outer exec operation. Once that operation exists, runtime derives a separate exact
`ProgrammaticInvocationGrantV1` that binds the capability hash to `providerToolCallId`, surface
version, command/route, canonical invocation hash, and invocation quotas. The invocation hash covers
the canonical command/route plus owned stdin or scalar arguments from the outer exec operation.
Capability assembly and invocation-grant derivation are distinct boundaries.

## Frozen Per-Run Adapters

Exactly one adapter is selected at Run admission and cannot silently change within that Run:

| Conditions | Adapter | Provider exposure |
| --- | --- | --- |
| small catalog | Direct Native | eligible native tools |
| large catalog, Agent mode has exec, model is proven CLI-capable, and maximum ceiling-derived Programmatic set fits hard bounds | CLI Programmatic | fixed exec/native entry plus Programmatic Surface out of band |
| large catalog without exec or with incapable model | Native Activation | bounded native active set and native discovery/activation |
| maximum ceiling-derived Programmatic set exceeds hard bounds | Native Activation, or admission failure when unavailable | bounded native active set; no truncated Programmatic authority |

ACP is excluded. Route selection uses session mode, provider, model, Agent profile, catalog size,
and measured model capability. Selection is per-Run frozen; cross-Run state may use sticky assignment
and enter/exit hysteresis. No document or task may claim a completion percentage for Native
Activation.

## Adapter Selection and Native Activation

### Selection, View Transitions, and Budgets

Native virtualization freezes per Run from complete-ceiling tool count and exact estimated
definition tokens, including native search overhead. Above either enter threshold virtualizes;
below both stays full. Cross-Run exit thresholds are lower, and hysteresis is a bounded hint
recomputed against the new ceiling. Initial order is mandatory system-model tools, Agent core,
initially active Skill requirements, bounded eligible recent-use, then native `tool_search`. CLI
routing additionally requires Agent exec and proven provider/model capability.
That Agent exec requirement applies to Run admission. If current authority later revokes exec, the
Run remains assigned to the CLI adapter but the next Provider Active Surface and its durable View
fact omit exec; no new invocation grant can be reached from that View.

The recent-use hint affects deterministic initial selection only. It cannot make a target eligible,
survive definition drift, or act as cross-Run authority. `deepchat_question` remains user-configurable
and is never treated as an unconditional mandatory host tool.

| Transition | Direct Native | Native Activation | CLI Programmatic |
| --- | --- | --- | --- |
| transient retry | reuse exact View | reuse exact View | reuse exact View/capability |
| discovery | n/a | activation only in later View | no expansion or seen ledger |
| context recovery | new View | new View | new View/capability |
| effective Skill/surface change | new View | new View | new View |
| current revocation | deny now; shrink next | deny now; shrink next | deny now; shrink next |
| new capability | new Run | new Run | new Run |

Native policy separately bounds initial count/tokens, activation-reserve count/tokens, search
results, settled-batch additions, Run batches/appends, provider count/tokens, and V5 identities.
Initial assembly leaves reserve. Rejected candidates stay absent with bounded provenance—no eviction
or full-catalog fallback. Contract-bearing V5 is limited to 256 identities and 64 KiB canonical
contract bytes; V4 uses provider limits. Mandatory overflow fails Run admission.

### Skill Activation Settlement

Native Skill activation is serialized and staged: resolve through the frozen ceiling; compute the
cumulative exact next Skill/tool/prompt bundle without mutation; persist bounded failure or success;
then apply the immutable bundle before another View. Apply performs no I/O and cannot fail.
Persistence failure discards it; crash before apply exposes no partial state. Same-batch intents
preflight cumulatively by ordinal. Failure never partially activates, evicts, or waits for the next
request; the activation call returns a bounded error and the Run continues.

### Native `tool_search`

This belongs only to Native Activation: one reserved Agent `system-model` read tool that cannot be
shadowed. It searches only model-discoverable entries in its originating frozen Eligible Catalog.
Bounded results contain model-visible name, reviewed source, one-line description, optional reviewed
effect/tags, and pending/static-rejection state. They exclude stable keys, hashes, server UUIDs, raw
IDs, schemas, MCP `_meta`, handlers, payloads, secrets, arbitrary metadata, and unbounded text.

It follows normal preparation, fitting, cancellation, `dispatch_committed`, and `tool_outcome`, and
never dispatches a candidate. Parallel results merge by persisted batch ordinal. Typed execution
options carry originating snapshot and batch-owned sink to a statically registered handler—no
per-View closure or global latest state. Duplicate identity cannot release twice. CLI search below
is separate and creates no candidate.

## CLI Protocol

The Agent-only commands are:

```text
deepchat tool search --query "<terms>" [--limit <1-32>]
deepchat tool describe --target <name>
deepchat tool call
deepchat tool batch
```

Search accepts either one unquoted safe term or multiple safe terms enclosed in double quotes.
Quoted queries contain no escapes, use one ASCII space between terms, and exclude shell expansion
and control characters in POSIX, PowerShell, and cmd. Describe accepts one safe target either
unquoted or enclosed in exactly one pair of ASCII double quotes, with no escapes. The authority
parser binds the decoded query or target, not its quoted command spelling, into the exact invocation
hash. Single-quoted forms remain invalid because their shell semantics are not portable.

`search` and `describe` read only the originating View's frozen Programmatic Surface. They do not
authorize, activate, create target Journal facts, or create a “seen” ledger. A target in that frozen
surface may be called directly without prior search. Search never returns a provider-active target.

Search returns bounded model-visible invocation names, reviewed source/effect labels, one-line
descriptions, compact input signatures, and copyable call examples. Describe returns one target's
bounded canonical input signature/schema and short example. Neither returns internal stable keys,
server UUIDs, hashes, MCP `_meta`, handlers, secrets, or unbounded descriptions. These results are
message-tail discovery data, not authority; call resolves the model-visible name only within the
originating frozen Programmatic capability and Journals the resolved real target identity.

`call` is the one-child specialization of the batch child state machine. For a provider-active,
ineligible, revoked, or nonexistent target, `call` and `batch` return the same bounded anti-oracle
shape.

Batch v1 has a fixed bounded step count and executes sequentially in canonical plan-array order,
fail-fast. The controller, never the caller, assigns contiguous `childOrdinal = planIndex`. Before
any child approval or T1, it validates and reserves the complete ordinal-to-step/template mapping;
targets are fixed stable keys and cannot be references.

Each step has literal JSON `arguments` plus an optional bounded `bindings` array. A binding is exactly
`{ "to": "/arguments-pointer", "from": "$steps/<prior-index>/result/<result-pointer>" }`.
`to` is an RFC 6901 JSON Pointer to an existing destination in that step's arguments. `from` selects
an immutable completed earlier result and then applies an RFC 6901 pointer; it cannot select a target
or any current/later step. Duplicate, ancestor/descendant-overlapping, or otherwise conflicting
destinations are invalid. Bindings replace whole JSON values in canonical list order, so they are
type-preserving and contain no interpolation or executable expression syntax. The grammar has
versioned pointer-byte, segment, depth, binding-count, retained-result, and
aggregate-materialized-input bounds. Missing paths fail deterministically before that child's T1;
target schema type mismatch follows ordinary pre-T1 input rejection. Per-child and aggregate input
byte/depth/entry quotas are reapplied after materialization. Any known error, denial, cancellation,
quota/materialization failure, or target error stops the batch and marks every later step
`not_started`.

`maxOutputBytes` independently bounds the aggregate finalized child response texts and the
canonical outer result. The outer result is not added to the child aggregate because it may be a
bounded summary of those same child results. Exceeding either bound must be converted to a bounded
known error before child T2 or settlement; reaching the controller with an oversized finalized
value is a Run-fatal invariant breach.

Batch v1 forbids `forEach`, dynamic expansion, parallelism, DAG scheduling, automatic retry,
cross-restart resume, replay/redelivery, recursion, and arbitrary Shell/JavaScript execution. The
controller is not durable: after a crash it does not restore the plan or unexecuted steps.

Existing Skill text that says “use X tool” receives a fixed, short adapter instruction translating
that action to `deepchat tool call`. Dynamic Skill bodies must not be injected as an unmeasured
provider-prefix mechanism.

Call and batch receive their canonical bounded request body through the exec tool's owned stdin
channel, not shell redirection or command-line JSON. The outer exec arguments and T1 hash bind that
stdin value without persisting it. Search/describe may use bounded scalar command arguments. Shell
control syntax remains forbidden, and Programmatic CLI invocations may not request model-owned
timeout, background, detached, or yielded execution. Ordinary shell commands in the same Run retain
the normal exec controls. The outer exec stays pending until the local-control request and all
started children settle or the Run enters a fatal/indeterminate state.

## Agent CLI Capability Token

Only a CLI Programmatic Run receives a token. It carries an exact outer-operation invocation grant:

- session, message, Run, `requestSeq`, and `providerToolCallId`;
- local-control surface version, command/route and `canonicalInvocationHash`, adapter mode,
  capability/surface hashes, and expiry;
- child, batch, input, output, and time quotas.

`maxCalls: 1` limits the local-control RPC use of the token; it is not a nested-child quota. Tool
call/batch v1 is Agent-only and does not expose a human raw MCP tunnel. Direct Native, Native
Activation, ordinary human CLI, and ACP Runs never receive this token. Call and batch use a bounded
Agent compute admission domain independent from model, media, and OCR compute, in addition to their
exact invocation and child/batch quotas; search and describe remain read operations.

Local control compares the exact route and canonical request body to `canonicalInvocationHash`, then
atomically consumes the one-use token before child ordinal allocation or approval. Changed route,
changed body, wrong principal/conversation, expired/revoked grant, and replay before or after a
successful request all fail closed without revealing target membership.

Current shell integration may prepare the token for environment injection before outer T1. Such a
token is inert: local control rejects it until a newly created outer T1 receipt atomically arms the
matching process-live grant. T1 failure revokes the token and prevents process spawn. The bundled
CLI starts only after the grant is armed. A separate settlement receipt binds the canonical
outer-result hash; stdout is untrusted transport data and cannot independently prove child or outer
settlement. After exact local-control admission, a policy, capacity, or timeout failure before
Programmatic dispatch is recorded as a bounded typed result in that same process-live controller;
it creates no child T1, and the outer runtime remains the only owner that can commit outer T2.

The ordinary shell permission interaction remains before outer T1. In-process approval may continue
with the same frozen View capability and a fresh exact invocation grant. A Programmatic CLI command
pending at that outer shell gate is not resumed after process restart. After outer T1, a pending
child approval keeps the foreground CLI request and outer operation open; process restart aborts the
controller and recovery follows the T1-only rules below.

## Child Preflight and Approval

Before every child T1, runtime independently checks frozen Programmatic membership, definition
drift, TaskContract typed meet, effect/workdir/depth ceilings, current runtime authority, target
permission and approval, quotas, and abort state. Shell approval authorizes only launching the CLI;
it does not approve nested targets. Default approval is per child.

A future plan approval may be considered only for a complete static plan that fixes every target,
argument, effect, and ordinal. It is not a Batch v1 commitment.

## Native Direct Dispatch Guard

Before target resolution, Native Activation checks originating active membership. Hidden,
ineligible, revoked-before-View, and nonexistent names share one bounded unavailable response, with
no side effect or target `dispatch_committed`. Active targets retain specific errors for changed
authority, permission, approval, Session state, or binding. CLI Programmatic applies the same
anti-oracle boundary before its child plan: once frozen Programmatic membership is established,
pre-T1 runtime failures distinguish disabled authority, an unavailable target, definition drift,
changed bindings, rejected arguments, unavailable target runtimes, and temporarily unavailable
Session authority. The bounded step codes are `tool_disabled`, `authority_changed`,
`target_unavailable`, `target_changed`, `definition_changed`, `invalid_request`,
`runtime_unavailable`, and `runtime_authority_unavailable`. These errors never expose raw
definitions or internal exceptions and do not create a child T1.

`canonicalToolDefinitionHash` is canonical JSON of complete `MCPToolDefinition` after
`stripToolExecutionContract`, including function/server/raw fields and excluding only execution
policy. Metadata drift closes. Provider-adapter normalization below this layer is outside the guard;
the recipe is versioned. Permission, approval, contract, target, effect, workdir, depth, revocation,
abort, and definition gates complete before T1. TaskContract definition meet remains assembly-time.

## Provider Context and Execution Journal v2

Provider/Context truth stores the outer exec call and outer result. It must not fabricate nested
targets as provider-native calls or results. Journal v2 stores each real nested target, UI/approval
binding, and known outcome, with the outer provider operation as parent.

Journal identity is discriminated:

```text
provider v1-compatible operation: (runId, requestSeq, providerToolCallId)
nested v2 operation: (runId, requestSeq, providerToolCallId, childOrdinal)
```

`childOrdinal` identifies an independent child operation, not an invocation attempt. It is bounded,
allocated by declaration/materialization order before that child's T1, never reused, and never
assigned by completion order. `target`, `definitionHash`, `argumentsHash`, and `capabilityHash` are
canonical payload. Same identity with different canonical payload is corruption. Neither provider
nor nested operation has attempt identity or same-identity automatic retry. V1 and v2 coexist on
read; historical V1 is never rewritten.

The mandatory causal sequence is:

```text
outer exec T1
  -> child preflight/approval
  -> child T1 -> physical call -> child T2 -> finalized nested projection
  -> ...
  -> canonical outer result -> outer exec T2
  -> transcript/model/UI
```

Child T1 requires parent T1. No child may start after outer T2 or `run_terminal`. Before outer T2,
every child T1 must have T2. Duplicate T1 prevents physical repetition. A process-live parent
operation controller and settlement receipt cross the CLI boundary and mechanically enforce these
rules; stdout is not authority. Nested Journal failure or corruption is Run-fatal and must not be
reduced to CLI exit status or stderr.

For a Run containing a Programmatic outer operation, `run_terminal` requires that outer exec to have
T2 and every outer or nested T1 to have a matching T2. A T1-only operation forbids both outer T2 and
`run_terminal`; the Run remains unterminated and parked so startup recovery cannot omit the uncertain
effect. A deterministic pre-child-T1 refusal has no child fact and may produce a known outer error;
a Journal write failure/corruption remains fatal and may settle the outer operation only when the
Journal is still trusted and that exact outcome can be durably committed.

Journal persistence contains canonical hashes, statuses, and bounded provenance only. It never
copies raw arguments, result/error text, MCP envelopes, binary data, or temporary paths.

## Failure Matrix

| Event | Required state |
| --- | --- |
| known success or known target error | child T2 before nested projection |
| denial before child T1 | no child fact; later batch children are `not_started` |
| pending approval | remain before child T1 |
| crash | no plan recovery or automatic retry |
| cancel before child T1 | no child fact |
| cancel after child T1 with known outcome | child T2 |
| cancel after child T1 without known outcome | T1-only, `indeterminate` |
| CLI exit after reserve/materialize with no unknown child | known outer process error; no invented child fact |
| CLI exit after local control records the complete result | reuse that exact process-live result for outer T2 |
| Journal failure/corruption | Run-fatal |
| every child has T2 but outer T2 is missing | incomplete; no automatic projection |
| explicit model retry | new provider operation and new identities |

T1-only operations are parked. `AbortError` by name is not cancellation evidence. The owned abort
signal authorizes revoking the exact local-control grant, terminating its attached CLI process, and
preventing later children; it does not prove an already-dispatched child outcome.

## Tape Contract

`view/tool_catalog` and `view/tool_surface` retain their provider-exposure semantics. A third bounded
fact, `view/programmatic_tool_surface`, records request/manifest/catalog references, capability and
surface hashes, policy/canonicalization versions, bounded target/definition projection, and bounded
degradation. It excludes the effective View, Memory ingestion, and ordinary search.

All three use same-identity/same-payload idempotency and same-identity/different-payload corruption.
Strict V5 writes required facts before provider admission and fails closed. V4 provenance may fail
open with a bounded diagnostic but cannot masquerade as verified. Normal dispatch never reads these
facts; narrowly specified restart auditing does not turn Tape into authority.

`view/tool_catalog` is incarnation-local idempotent by `fullCatalogHash`. It stores schema/hash
recipe/canonicalization versions, full and retained-projection hashes, bounded stable target and
definition-hash projection, reviewed exposure/effect/mode, total/retained counts, and degradation.
The projection hash proves only retained evidence. Raw schemas, MCP metadata, handlers, payloads,
secrets, and full descriptions are forbidden.

`view/tool_surface` is keyed by complete View identity and stores versions, `surfaceHash`, manifest
and physical catalog references, full catalog hash, policy/order and adapter mode, virtualization
decision, ordered active target/hash/ordinal/reason entries, budgets, bounded native-search
references/rejections, and degradation. Strict V5 retains the complete list. Oversized V4
projections truncate deterministically and each paused action binds exact surface/target/hash.
Historical Tool Surface V1 facts retain their original hash recipe without adapter mode; V2 adds the
explicit adapter field. Recovery may derive Direct Native versus Native Activation from the V1
virtualization decision, but CLI Programmatic Views require V2 and never reinterpret V1 evidence.

`view/programmatic_tool_surface` has equal detail: complete View, manifest, and physical catalog
references; adapter mode; capability/surface hashes; policy/canonicalization versions; bounded
target/definition projection; TaskContract/effect/workdir/depth and child/batch/I/O/time ceilings;
and degradation. It is provenance and strict provider-admission binding only. It cannot restore the
parent-operation controller, receipt, CLI plan, or unstarted children; CLI batches never recover
across restart.

A dedicated single SQLite transaction writes `view/assembled`, validates/appends catalog,
validates/appends provider surface, and, when applicable, validates/appends programmatic surface,
before provider admission. All facts use canonical conflict checking and incarnation-local physical
references and stay outside effective View, Memory, and ordinary search. Missing, malformed,
duplicate-conflicting, or failed evidence closes strict V5. V4 fails open only with a bounded honest
diagnostic. Strict deferred V5 recovery requires exactly one hash-valid manifest and applicable
surface evidence plus exact target/hash. New canary V4 pauses carry exact binding; only historical
unbound V4 retains legacy recovery.

## Cache and Cost Contract

Virtualization aims to reduce catalog-driven tool-schema churn, not to make the entire provider
prefix fixed. Skill/system/core changes, revocation, compaction, context recovery, model/config
changes, and conversation history may still invalidate cache reuse.

Canaries compare provider-specific billed cost and cache read/write metrics, schema tokens, provider
rounds, latency, success, and repeated discovery. Existing `provider/attempt_completed` v2 cache
token fields are reused when available rather than inventing parallel telemetry. Providers lacking
comparable pricing or cache metrics remain separate cohorts. Adapter selection uses measured
capability and cost evidence; no schema-size-only claim is sufficient.

Provider tool order is deterministic: initial order freezes, accepted native activations append in
one sorted batch, and reranking/eviction is forbidden; revocation filters and restoration resumes
the ordinal. Catalog hashes use canonical target order. Canary/holdout assignment freezes before
ceiling construction from a privacy-preserving seed/bucket; raw keys are not persisted and retries
cannot reassign. Cohorts include provider, model, policy, catalog band, and adapter. Metrics include
cache-read/write and uncached tokens, schema tokens, requests/rounds, discovery/repeated discovery,
TTFT/end-to-end latency, categorized success/failure, and billed effective input cost under
versioned pricing. TTFT runs from entry into the Run through adapter setup to the first provider
output event; resumed transcript accounting cannot move that baseline. Providers lacking comparable
cache/pricing remain separate cohorts.

## Compatibility, Security/Privacy, and Performance Bounds

Native identity, approval, permission, Journal, and results remain native. Small catalogs preserve
eligible calls. V4 needs no ExecutionContract and its `toolDefinitionsHash` covers exact active
definitions; V5 ceilings remain provider-only. Existing manifests/contracts/facts/hash recipes do
not mutate. The canonical Agent `exec` provider schema has no owned-stdin field. A Run frozen to CLI
Programmatic receives one stable attached-exec projection before its ceiling, snapshot, and hashes
are constructed: it adds bounded owned stdin while retaining ordinary timeout/background/yield
controls for ordinary shell commands in the same Run. Every View in that Run uses the same
projected definition; schema selection never parses or branches on model-controlled command text.
Exact process-live Programmatic parent authority identifies Programmatic invocations, which reject
model-owned timeout/background/yield before process spawn and outer T1. Runtime validation rejects
owned stdin without that exact authority, and accepted stdin is bound into the invocation grant and
Journal argument hashing. Other adapters retain the existing schema and avoid owned stdin and its
cache-prefix churn. ACP and disabled configurable tools remain excluded.
Search/selector errors are bounded
and never expose the full catalog. In a Native Activation canary, initial selector failure degrades
to bounded core plus native `tool_search`; an individual search failure returns a bounded error.
Rollback prevents new canary Runs and never mutates an existing Run or facts. Search cannot enumerate
excluded targets or grant permission. Queries, descriptions, errors, IDs, facts, and Journal
provenance are bounded and contain no raw schemas, prompts, headers, credentials, arguments/results,
MCP envelopes, binary, paths, handlers, or payloads.

Canonicalization has versioned input-byte, depth, entry-count, and output-byte bounds plus token
bounds. P0-A emits content-free `surface_hash_input_exceeded` and omits the hypothetical surface;
P0-B assigns oversized Runs to pre-admission control/ineligible cohorts, never a post-selection
fallback. Definition-hash caching requires proven immutable revision/binding identity; request
membership and authority always rebuild. Full catalog hash binds reviewed effect/mode separately.

## Security Invariants

1. The frozen ceiling never expands; revocation can deny immediately.
2. The two View surfaces are immutable and stable-target disjoint.
3. Search/describe cannot grant, activate, execute, or enumerate excluded targets.
4. Nested calls cannot exceed the exact originating `ProgrammaticInvocationGrantV1`.
5. Runtime and process-live settlement receipts, not Tape or stdout, authorize progression.
6. Every real child uses strict Journal ordering and its real target identity.
7. No raw secret, argument/result body, MCP envelope, binary, or temporary path enters surface or
   Journal facts.
8. Arbitrary-code sandboxing and human raw MCP invocation remain Non-Goals.
9. Programmatic CLI execution is foreground-only and cannot yield or detach past outer T2.
10. Per-View capability construction never depends on a future provider tool-call ID.
11. A Programmatic Run cannot terminalize while any outer or nested T1 lacks T2.
12. Exact one-use grants bind and verify the canonical CLI invocation body and route.

### Retained Native Activation Invariants

1. One immutable snapshot serves each provider request and batch.
2. The Run ceiling never expands; current revocation shrinks authority.
3. Native search reads only its originating Eligible Catalog.
4. A native hit enters only a later View.
5. Guessed inactive calls close without side effects or target T1.
6. Physical retry reuses snapshot, manifest, contract, messages, and requestSeq.
7. Recovery, activation, or effective change creates a new View.
8. V5 ceilings equal the provider-visible Active Surface; V4 needs no contract.
9. Runtime, not Tape, is authority; normal dispatch never reads Tape.
10. Every live gate completes before target T1.
11. Execution, approval, Journal, UI, and outcome use real target identity.
12. Diagnostic/runtime-only/ineligible tools never enter search.
13. Search or selection failure never falls back to the full catalog.
14. Historical schemas and hash recipes never change in place.
15. Active surfaces respect provider and applicable V5 limits.
16. Ranking/budget never evicts active tools; revocation remains effective.
17. Strict conflicts close and V4 failures never masquerade as verified evidence.
18. ACP remains outside P0.
19. Provider ordering is deterministic and accepted activations append.
20. Candidate release waits for durable outcome and complete batch settlement.

## Acceptance Criteria

### P0-A

Shadow changes no payload, order, contract, or Tape fact; emits only deterministic bounded
counts/tokens/triggers/static overlap and available baseline cache fields; hashes ignore enumeration
order; diagnostics fail open.

### Shared Foundation and Direct Native

The exact ceiling/catalog/snapshot formulas hold, retries reuse identity, recovery creates a View,
small catalogs preserve eligible native tools, ACP remains unchanged, and Direct Native receives no
CLI token or native activation search.

### Native Activation

Large catalogs receive bounded initial surfaces; native search returns no schema and activates only
later under real identity. Anti-oracle, drift, budget, Skill staging, stable append ordering,
revocation, crash candidate loss, V5 atomic provenance/recovery, and V4 honest fail-open behavior
match the contracts above.

### CLI Programmatic

1. One View carries one exact immutable snapshot; physical retries reuse it and recovery creates a
   later View.
2. Every target is in at most one surface, and Programmatic exclusions are enforced.
3. Adapter choice is deterministic and frozen per Run, with ACP excluded.
4. CLI discovery reads only the originating frozen Programmatic Surface and creates no target fact.
5. Direct call works without search, while excluded/unknown targets share one anti-oracle response.
6. Batch v1 obeys fixed sequential fail-fast semantics and all stated bounds/non-goals.
7. Exact capability/token identity and quotas are enforced across the CLI boundary.
8. Child preflight, parent/child T1/T2 causality, parking, and Run-fatal Journal failures match the
   failure matrix.
9. Provider Context contains only the outer exec operation; Journal v2 preserves real nested truth.
10. V1/v2 facts coexist without migration or identity reinterpretation.
11. Strict V5 surface facts bind before admission; V4 fail-open evidence is labeled honestly.
12. Normal dispatch performs no Tape read, and cache claims remain provider-cost canary claims.
13. Programmatic call/batch bodies use bounded owned stdin, compound shell syntax is rejected, and
    model-owned timeout/background/yield requests fail before outer T1 without removing those
    controls from ordinary shell execution.
14. A prepared token cannot reach local control before a new parent T1 arms its exact grant; failed
    parent T1 prevents process spawn and revokes the grant.
15. Grant tests reject changed body/route, replay, expiry/revocation, wrong principal/conversation,
    and any v1-surface attempt to reach a Programmatic route.
16. Batch tests cover contiguous controller-assigned ordinals, invalid/static references, missing or
    mismatched values, post-materialization and aggregate quota amplification, and fail-fast
    `not_started` settlement.

### Journal/Batch

Provider Context keeps outer truth; nested Journal keeps physical target truth. Fixed sequential
fail-fast execution (never `forEach`) enforces per-child gates/approval, parent/child T1/T2,
indeterminate parking, no restart recovery, and Run-fatal persistence/corruption. Failpoint coverage
proves `run_terminal` is rejected when a Programmatic outer or nested operation has T1 without T2.

### Default-Enable Go/No-Go

Default enablement requires all seven historical gates: sufficient trigger rate; lower effective
provider cost including cache pricing and extra rounds; non-inferior task/tool success at the
recorded confidence bound; p95 latency and extra rounds within budget; zero unauthorized,
same-View-activated, or stale-definition dispatch; repeated-search and Skill-budget failures below
threshold; and oversized canonicalization below an accepted threshold with explicit production
policy. Any failure retains canary/rollback.

There are no open questions or clarification markers in this approved contract.
