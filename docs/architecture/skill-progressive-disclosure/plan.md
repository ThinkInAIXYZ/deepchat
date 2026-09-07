# Skill Progressive Disclosure Implementation Plan

## Delivery Strategy

Land the architecture in independently reviewable slices. No user-visible projection moves to a
new Tape dependency before that dependency and its fail-closed tests exist. Route and Discover are
one externally visible slice because omission is valid only when bounded discovery is available.

## Route

Add a Skill-owned routing module with:

- canonical NFC routing-card normalization and binary UTF-8 category/name ordering;
- a Unicode-safe 1,024-code-point description cap;
- the 2-percent/2,000-token budget resolver;
- deterministic staged allocation;
- separate compact-text and structured-JSON renderers;
- a render report containing included names, name-only names, omitted names/count, budget, and
  estimated projected tokens.

Pass the effective context budget length through `BasePromptAssemblyInput` and
`PromptAssemblyService` into `SystemPromptBuildInput`. This is a local renderer input only; it does
not move preflight or fitting into system-prompt assembly.

The system renderer owns the complete `<available_skills>` block and verifies the final estimate.
When full cards do not fit, it finds the largest shared summary code-point cap by monotonic binary
search before using name-only cards and stable omission. If the minimum representation cannot fit,
it emits no block. Session-active names may use name-only cards. Runtime message/view activation
never changes Route cards.

Record a bounded catalog degradation code in the existing `skills_metadata` prompt section when
cards are shortened or omitted. Do not add estimated token fields to prompt-section provenance.

## Discover

Extend the existing `skill_list` schema and dispatcher rather than adding another tool. Introduce
shared request/result types and keep the main-process Skill service as the catalog owner.

Normalize query text once. Build a bounded lexical score from existing metadata without provider
or filesystem work. Encode a versioned opaque cursor containing normalized-query hash, stable
result offset, projection version, and normalized catalog fingerprint; reject malformed,
oversized, stale-version, changed-catalog, or query-mismatched cursors. Apply the hard limit and
2,000-token response budget after deterministic ranking.

The result renderer emits only routing-card fields and bounded counts. Remove arbitrary metadata
from the provider result while preserving internal management metadata APIs. Existing no-argument
calls remain valid and become the first bounded page.

Route omission and paginated discovery are connected through the prompt marker and tests. Wire the
bounded catalog and bounded `skill_list` in the same commit so no reachable state claims omitted
Skills are searchable before this tool contract is active.

## Tape Foundation

Add a physical `context` Tape kind and canonical Skill-context materialization types under Tape
domain ownership, plus narrow read/write capabilities under `src/main/tape/ports/`. Existing
effective readers ignore unknown physical kinds by default; new readers also exclude `context`
explicitly. Compose implementations in Tape application services and the existing Session Tape
facade; the DeepChat loop receives only those narrow methods.

The writer:

1. validates the Session/Tape incarnation, per-body, aggregate-byte, and count limits;
2. derives a Session-local provenance key from Agent/source identity, Skill identity, content hash,
   and builder version;
3. resolves an existing entry or appends a new materialization fact;
4. strictly compares a reused entry's canonical payload and hash before returning its ref;
5. performs lookup, validation, and append in one synchronous SQLite transaction;
6. returns a typed incarnation-bound receipt without exposing generic append authority.

The reader resolves only Skill-context refs, validates schema, payload hash, source scope, and Tape
incarnation, and returns a bounded typed payload. It does not expose arbitrary raw entries.

Add ViewManifest schema 6/hash 4 with `runId`, typed Skill-context refs, optional validated
ExecutionContract, and a `requireDurableManifest` path independent from `strictViewContract`. Old
versions retain their exact parsers and hash recipes. New Skill-context provenance accepts generic
source entry refs rather than assuming every source is a transcript anchor.

Add ViewManifest schema 7/hash 5 when a runtime `skill_view` also has executable authority. Its
runtime context references both the exact provider-visible `tool_result` fact and the exact
`skill/materialized` execution package. Both refs are inside the same execution-bound occurrence,
must resolve before append/replay, and are exported as replay evidence. Schema 6 remains readable
without an execution ref. A narrow Run reader selects the latest raw occurrence for continuation
and fails closed when a newer occurrence is malformed instead of falling back to an older parsed
manifest.

Add explicit filters for materialization facts in effective views, transcript rendering, FTS and
fallback search, Agent Tape tools, Memory ingestion/recall, and fork merge. Compatibility tests
exercise the previous reader semantics and prove unknown `context` rows are non-effective.
Architecture tests prevent broad Tape capability imports and sidecar persistence. This Foundation
slice originally adds no production writer call site; later Activate slices connect the narrow
capabilities only after their fail-closed projection paths exist.

Extend the same canonical `skill/materialized` fact, rather than adding another fact or sidecar,
with a private execution package for script-bearing Skills. Snapshot the bounded regular-file
`scripts/` tree and explicitly declared non-executable support paths sequentially with no-follow
identity checks and portable canonical paths. Store decoded and encoded size evidence and hashes;
strictly recompute them on every read or reuse. Keep extension environment values out of Tape and
bind them by an opaque management-state revision that future dispatch must verify through a narrow
capability. Do not claim package-backed execution until `skill_run` consumes the exact
execution-bound ref. Migrate the two legacy bundled Skills that require support paths only after a
bounded, repeated full-tree fingerprint proves each top-level or Agent-private installed copy is
unchanged; never overwrite customized Skill content. Keep legacy Skill Sync conversion fail-closed
for declarations it cannot yet round-trip with their support files.

## Safe Runtime Skill View

Extract one fresh-resolving effective-content builder from the current `loadSkillContent` and root
view paths. It renders the body and appends runtime instructions once.

Migrate root `skill_view` in this order:

1. build canonical effective content;
2. return that exact content in the candidate tool result;
3. apply independent UTF-8 and context visibility checks;
4. commit the existing strict `execution/tool_outcome` operation-settlement hash;
5. through a narrow strict writer, persist and read back the canonical ordinary `tool_result` as
   the exact content authority, validating it against the Journal outcome;
6. materialize and read back the matching execution package, then bind both facts into schema 7;
7. only then mark runtime activation;
8. refresh the tool catalog/allow-list;
9. remove full-body reinjection through leading-system refresh.

The later normal transcript/tool-fact path reuses the strict result's provenance key and verifies
canonical equality; it never writes a second result fact. Do not change supporting-file view
semantics. Add an execution-local projection registry so a root view already provided by Session,
message, or prior tool result returns a bounded confirmation. A failed, truncated, or offloaded
root result does not activate the Skill and stops that run from issuing a provider request with an
unrecorded behavior contract. Expose this behavior only after strict executable Skill-bearing
manifests are active in the same commit.

For later executions only, project persisted successful root-view results as bounded markers while
leaving exact `tool_result` facts untouched. Preserve the exact result for permission resume of the
owning assistant message, and preserve supporting-file and unrelated MCP results in all views.

## Message And Session Projection

Split runtime names conceptually and in local APIs into message Skill references and Session active
Skills. Retain persisted schema compatibility where field renames would require a migration.

For each new execution:

1. resolve message and Session Skill names against the scoped enabled catalog;
2. fresh-read or cache-validate each source and build canonical effective content in memory;
3. enforce the per-body, 64-body, and 2-MiB aggregate physical limits without performing token
   admission;
4. materialize or strictly reuse each body;
5. round-trip read and validate each ref;
6. build message active-turn user context and Session stable-system sections only from validated
   facts;
7. deduplicate complete bodies through the Run-local projection registry;
8. pass refs and projection hashes through loop state and ViewManifest assembly;
9. run the sole authoritative `contextCoordinator` preflight and strict schema-6 manifest commit
   before provider dispatch.

Continuation carries exact refs through tool rounds and overflow recovery in one Run. Permission
pause/resume creates a new Run for the same assistant-message execution; it restores runtime-view
refs only from strict facts that match that message's persisted blocks and rebuilds a new Run-local
registry without reading Skill files. A newly submitted, regenerated, or edited message is a new
execution and deliberately repeats fresh resolution. No Session-global "latest Skill context"
cache is introduced.

Historical message projection replaces an expanded message body with a bounded `[Used skill: ...]`
marker after the owning active turn. Tape retains the original message Skill refs and
materialization facts for audit and same-execution recovery; compaction does not preserve Skill
bodies.

Remove the dormant mention fallback that writes ordinary message selection into Session state.
Preserve the verified regular-session path, which already forwards first-message Skill refs through
`startInitialTurn` without persisting them. Detached and subagent creation keep their explicit
Session-active assignment semantics. Existing Session active state remains accepted and projected.

## Compatibility UI

Expose existing Session active Skills as persistent, removable state in the composer or adjacent
Session Skill surface. It must be visually distinct from next-message selections. Do not add an
action that creates new persistent state. Removal uses the existing typed Skill route and updates
the stable system projection on the next execution.

Use vue-i18n for labels, status, and removal errors. Preserve current message chips and `@skill`
selection behavior.

## Context Diagnostics

After Route/Discover/Activate are stable, add an ephemeral render report pipeline. The final
preflight derives an approximate category breakdown from the exact request sections, tools,
messages, output reserve, and Skill materialization reports. Opaque reconciliation displays total
cost with unavailable attribution instead of inventing precision.

Upgrade overflow detection to a structured observation. Parse explicit actual/limit numbers when
providers supply them, but only an explicit total-context or whole-prompt limit may become a
Session ceiling. Message-, request-, schema-, tool-, or other field-scoped limits only mark model
metadata suspect. Keep generic matches qualitative. Session ceiling, configured context length,
and any future estimator calibration remain separate values with explicit source/confidence.
Explicit limits are model-scoped runtime observations and do not overwrite Provider configuration
or enter Tape.

Retry only when the final Provider projection materially changes its messages or effective output
limit. If the calibrated projection is unchanged or protected content cannot fit, skip the doomed
second Provider call and return actionable category diagnostics.

## Compatibility And Rollback

- Existing Skill files, Agent scopes, Plugin contributions, settings, and management APIs remain
  unchanged.
- Direct ACP compatibility keeps bounded local routing cards but does not project full local Skill
  bodies because that path has no Skill materialization authority. Do not reintroduce mutable disk
  reads in prompt assembly as an ACP fallback.
- Existing `skill_list({})` calls remain valid but receive a bounded first page.
- Arbitrary metadata remains available to trusted management UI paths, not provider tool results.
- Existing Session active Skill rows remain valid and removable.
- Existing ViewManifest versions, hashes, Tape entries, and replay reads remain valid.
- A supported older reader ignores the new physical `context` kind because its effective,
  transcript, search, and Memory projections select only known kinds. It may copy an unknown row
  during fork merge, but the row stays inert and fails destination identity validation. Old code
  must not reinterpret ViewManifest schemas 6 or 7.
- No persistent field is repurposed from derived token observations.

## Security And Privacy

- Validate Skill and Agent identity against the current Session scope before materialization.
- Keep all existing path confinement and symlink defenses.
- Treat effective Skill content as sensitive Session data and never log it.
- Enforce independent canonical payload and response budgets before allocation or persistence.
- Bound `skill_run` argument and stdin payloads, and resolve configured system runtimes to exact
  executable paths from the inherited process environment without running login-shell or runtime
  discovery probes or RTK rewrites before the Journal dispatch boundary.
- Terminate Skill processes with an explicit error marker when their combined stdout/stderr exceeds
  the fixed Skill output budget; never let foreground or background offload grow without bound.
- Never trust renderer-supplied paths, hashes, entry refs, or activation scope.
- Recheck cancellation, current runtime instance, Tape incarnation, source refs, and hashes at the
  final provider boundary.
- Exclude materialization facts from retrieval systems that could reactivate stale instructions.
- Do not grant Agent code generic Tape or database capabilities.

## Validation Strategy

### Route And Discover

- Property-style boundedness across large catalogs, Unicode, long descriptions, tiny windows, and
  invalid context lengths.
- NFC and binary ordering, deterministic byte output, shared-cap summary allocation, name-only
  fallback, zero-block fallback, and omission marker tests.
- Query ranking, query/cursor byte and code-point limits, snapshot-fingerprint mismatch,
  pagination stability, hard-limit, and response token-bound tests.
- Provider-result whitelist tests proving metadata/path leakage is impossible.
- Prompt assembly and refresh tests proving message activation does not mutate Route.

### Tape Foundation

- New/strictly reused/corrupt materialization fact tests using real SQLite where available.
- UTF-8 byte bound, canonical equality, Tape reset/incarnation, and narrow capability tests.
- Schema 1–7 parser and hash-vector tests, including contract/no-contract legal states and duplicate
  run/request binding rejection.
- Effective view, FTS/fallback search, Agent Tape tools, Memory, renderer, and fork isolation tests.
- Previous-reader compatibility tests proving unknown `context` rows cannot surface instruction
  bodies.

### Activate

- Effective-content parity across root view, message projection, and Session projection.
- Tool-result settlement-before-activation and fail-closed persistence tests.
- Repeated root/supporting-file view behavior.
- Bounded Skill execution inputs and side-effect-free, cancellable system-runtime path resolution.
- Foreground and background Skill output-limit termination, including offload failure paths.
- One-body-per-Skill request tests across overlapping activation sources.
- Same-execution continuation with source mutation and new-execution fresh-version tests.
- In-process permission pause, overflow recovery, parked restart behavior, and Tape reset failure
  tests.
- First-message non-persistence and dormant fallback removal tests.
- Manifest/script mutation tests proving instructions and inventory are frozen while live runtime
  permission, path, existence, and file-hash checks still apply.

### Diagnostics

- Derived ledger agreement with exact projected content and opaque-attribution fallback.
- Explicit provider limit parsing, generic overflow handling, and no-op retry suppression.

### Repository Gates

Each slice runs focused Vitest suites, Node/web type checks as affected, formatting, i18n validation,
and lint before commit. Final validation runs:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run test:renderer
pnpm run build
```

Generated provider and ACP registry changes produced by the normal build are reviewed and retained
only when expected by repository policy.
