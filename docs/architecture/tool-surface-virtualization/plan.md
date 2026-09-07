# Tool Surface Virtualization Implementation Plan

## Retained Ten-Phase Native/Shared Baseline

The approved HEAD sequence remains the implementation backbone; the later dual-surface phases below
extend rather than replace it.

### 1. Establish Canonical Tool Surface Domains (shared)

- Add bounded stable targets, hashes, Run ceiling, candidates, Active Surface, and immutable
  snapshot types without changing manifest/contract recipes.
- Build Agent/MCP/Plugin/all-valid-enabled-Skill ownership, resolve requirements through execution
  source mapping, and separate canonical catalog order from provider append order.
- Test hash stability, bounds/depth, immutability, revocation restoration, append and ordinal merge;
  cache hashes only under proven immutable revisions.

### 2. Add P0-A Shadow Measurement (shared)

- Compute ownership, eligibility, hypothetical selection, exact definition tokens (including search
  overhead), trigger, overlap, and available cache fields without payload/Tape/config changes.
- Emit only bounded content-free diagnostics; isolate failure and keep the aggregate read path
  main-process/development-only.

### 3. Freeze Run Ceiling and Per-View Snapshot (shared)

- Freeze ceiling, virtualization and adapter in Run resources; derive one exact snapshot per
  requestSeq and reuse it through retries.
- Carry the same snapshot through provider tools, both surfaces, V5 contract, facts, CLI capability,
  and dispatch. Append only later, shrink on revocation, and retain ACP's path.

### 4. Add Native `tool_search` (Native Activation)

- Reserve/register the conditional read tool, pass frozen catalog and batch sink via typed options,
  and return only bounded reviewed metadata.
- Release after durable outcome/full batch, ordinal-merge and deduplicate, admit only in a later
  View, and discard pre-admission candidates on crash without Tape reconstruction.

### 5. Enforce Membership and Definition Identity (shared/Native)

- Bind each batch to its snapshot, anti-oracle reject before hidden resolution, compare stable
  target and canonical definition before T1, and retain specific errors for legitimately active
  targets. Keep V5 ceilings provider-active only.

### 6. Enforce Budgets and Skill Activation (Native Activation)

- Version initial/reserve/search/batch/Run/provider/V5 budgets, close mandatory overflow, record
  candidate rejection without eviction/fallback, and use cross-Run hysteresis only as a hint.
- Precompute serialized no-I/O Skill resource bundles before successful outcome and apply before the
  next View; a failed preflight mutates neither Skill nor prompt.

### 7. Persist View Tool Facts (shared)

- Implement bounded independently hash-valid catalog/provider/programmatic surface facts, reserved
  writers, incarnation dedup, conflict checks, and exclusion from View/Memory/search.
- Atomically persist manifest and applicable facts before strict V5 admission; V4 emits bounded
  honest diagnostics and historical schemas remain unchanged.

### 8. Recover Deferred Dispatch Safely (shared/Native)

- Keep process-live dispatch snapshot-owned. Strict restart requires unique hash-valid manifest and
  exact applicable surfaces/target binding; malformed or stale evidence closes.
- Persist exact bindings for new V4 pauses. Never recover a CLI batch/controller from Programmatic
  provenance; only historical unbound V4 keeps legacy behavior.

### 9. Canary Measurement and Rollback (shared)

- Freeze privacy-preserving canary/holdout assignment and compare provider/model/policy/catalog/
  adapter cohorts using cache read/write, uncached input, pricing, rounds, latency, discovery, and
  quality. Separate providers lacking metrics/pricing.
- Roll back only new Runs; never mutate a frozen Run/facts. Apply all seven default-enable gates.

### 10. Documentation and Validation (shared)

- Update maintained Tool/Tape/cache references only after behavior lands and add focused domain,
  ToolService, loop, retry/recovery, Tape, Agent, ACP, CLI, Journal, and cache telemetry tests.
- Before each commit review staged and merge-base diffs for authority, compatibility, causality,
  privacy, performance, edge cases, naming, tests, and maintenance cost. Run format, i18n, lint,
  typecheck, focused suites, then broad relevant Agent/Tape/main suites.

## Delivery Rules

- Preserve existing V1 behavior and historical facts; add versioned contracts rather than mutate
  old schemas or identities.
- Freeze adapter and Run ceiling once, freeze both surfaces per View, and keep runtime authoritative.
- Deliver each implementation slice with focused tests and a severity-ranked review before commit.
- Do not push from this workstream.

## Programmatic Extension Delivery

### A. Complete the Shared Foundation

Retain the committed canonical owned-capability, Run-ceiling, eligible-catalog, hashing, ordering,
and shadow-measurement foundation. Complete immutable View snapshot plumbing so transient retries
reuse the exact value, later effective Views receive new request identity, and current revocation can
deny immediately. Keep ACP on its existing path.

### B. Assemble Two Disjoint Surfaces

Build Provider Active and Programmatic surfaces from one eligible catalog. Enforce stable-target
mutual exclusion and all Programmatic exclusions. Bind provider definitions, the complete bounded
programmatic target/definition set, catalog/surface hashes, policy versions, TaskContract ref, and
effect, workdir, depth, child, batch, I/O, and time ceilings into
`ProgrammaticToolCapabilityV1`.

At Run admission, derive the maximum possible Programmatic set from the frozen Run ceiling,
including every ceilinged Skill target that a later View could make eligible. Keep that complete live
set within explicit count/byte/depth limits; only its durable fact projection may truncate. An
oversized set selects Native Activation or fails admission when no safe adapter exists. Build the
per-View capability before the provider request without a provider tool-call ID.

Keep V5 `ExecutionContract.ceilings` provider-visible only. Pass the same immutable capability value
through View assembly, runtime control, and grant derivation. Persistence derives the full
capability hash, exact bounded ceilings/quotas, and bounded provenance; it does not store or restore
the complete capability.

### C. Freeze the Three-Adapter Route

Implement per-Run Direct Native, CLI Programmatic, and Native Activation selection from session mode,
provider/model capability, Agent profile, catalog size, and measured capability. Add cross-Run
sticky/hysteresis inputs without making them authority. Never switch adapter in a Run and never
select CLI Programmatic without Agent exec and a proven CLI-capable model.

### D. Add Programmatic Tape Provenance

Retain `view/tool_catalog` and `view/tool_surface`. Add bounded
`view/programmatic_tool_surface`, canonical conflict checks, reserved-writer enforcement, and
exclusion from effective View, Memory, and ordinary search. Strict V5 atomically binds required
manifest/surface facts before admission; V4 retains honest bounded fail-open diagnostics. Dispatch
does not read Tape.

### E. Extend Local Control with Agent Tool Routes

Add Agent-only `deepchat tool search|describe|call|batch` through the existing local-control trust
infrastructure as an explicit exception to generic raw MCP invocation. Add `CLI_SURFACE_V3` as a
version-negotiated strict superset without changing `CLI_SURFACE_V2`. Mint only exact
outer-operation tokens with surface/command/route/invocation, adapter, capability/surface hashes,
expiry, and quotas. Keep `maxCalls: 1` as RPC quota and enforce child quota separately. Do not expose
a human tunnel. Keep the strict V2 descriptor and wire envelope unchanged: verified exact grants,
not caller-supplied headers or body fields, select the V3 route surface.

Derive the exact invocation grant only after provider response supplies `providerToolCallId`. A token
may be prepared for the child environment before outer T1 but remains inert until a newly created T1
receipt arms it; failure revokes it before spawn. Add bounded owned stdin to the exec contract for
call/batch bodies without enabling shell redirection. Reject background/detached/yielded
Programmatic commands before T1 and keep outer exec pending through local-control settlement. Verify
and atomically consume `canonicalInvocationHash` before allocating or approving any child.

Search and describe read the frozen Programmatic projection and create no target Journal operation.
Call executes the one-child state machine without requiring search. Use one anti-oracle response for
provider-active, ineligible, revoked, and nonexistent targets.

### F. Add Nested Journal v2 and Parent Controller

Add discriminated provider/nested identities while retaining v1 read semantics. Persist canonical
target, definition, argument, and capability hashes with bounded provenance only. Allocate bounded
contiguous plan-index child ordinals and reserve the complete step/template mapping before any child
approval or T1.

Implement a process-live parent-operation controller and settlement receipts across the CLI
boundary. Enforce parent T1 before child T1, child T2 before finalized projection, all child T1/T2
pairs before outer T2, and no operation after outer T2 or Run terminal. Reject outer T2 and
`run_terminal` while a Programmatic outer or nested T1 remains unmatched so uncertain Runs stay
visible to recovery. Treat duplicate T1, corruption, and Journal failure as Run-fatal.

Land the controller foundation before production wiring, but do not treat its local assertion as a
global Journal fence. Before registering any Agent tool route, wire the process-live controller as
the sole Programmatic outer-T2 path and require its terminal assertion from the real Run terminal
path; generic writers must not bypass either gate. This wiring uses runtime state and never reads
Tape on the dispatch hot path.

Bind the receipt to the canonical outer-result hash so shell stdout cannot manufacture settlement.
Do not rehydrate an outer shell permission continuation for Programmatic commands after restart; an
in-process grant may continue before T1, while a crash after T1 follows normal parking.

### G. Implement Child and Batch State Machines

For every child, independently enforce Programmatic membership, definition drift, typed TaskContract
meet, effect/workdir/depth, live authority, permission/approval, quotas, and abort before T1.
Default to per-child approval.

Implement fixed-count, bounded, sequential, fail-fast Batch v1. The controller prevalidates the
complete plan and assigns contiguous `childOrdinal = planIndex`; targets are fixed. The only
reference form is a bounded binding from an existing arguments RFC 6901 destination to an immutable
prior-step result RFC 6901 source; duplicate or overlapping destinations are invalid. Reapply all
input and aggregate retention quotas after materialization. Explicitly reject dynamic expansion,
interpolation, parallel/DAG execution, retries, recursion, arbitrary code, and restart recovery. Make
`call` the one-child specialization.

### H. Integrate Context, Skill, and Failure Projection

Keep only the outer exec call/result in provider Context. Project nested real-target status to
Journal/UI after child T2 and synthesize the canonical outer result only after all started children
settle. Park T1-only operations and never auto-project a completed child set when outer T2 is absent.

Add a fixed short CLI-adapter instruction that translates existing Skill “use tool” guidance without
making dynamic Skill text an unmeasured prefix. Preserve Native Activation behavior independently.

### I. Native Activation Integration

Complete the retained Native Activation phases 4-6 independently of CLI Programmatic: native search
and candidate settlement, later-View append ledger, budgets and reserves, anti-oracle dispatch,
canonical definition drift, and staged Skill activation. Test all three adapter transition tables
without allowing CLI discovery to create Native candidates.

### J. Canary and Validation

Canary adapter routing by provider/model/catalog cohort. Measure provider-specific billed cost,
cache read/write tokens, uncached input, schema churn, rounds, latency, and task/tool success. Do not
claim the whole provider prefix is stable.

Before each commit, review staged and merge-base diffs by severity for authority escalation,
causality/replay errors, compatibility, privacy, bounds, cancellation, performance, and test gaps;
fix findings before committing. Run formatting, i18n, lint, typecheck, and the smallest relevant
Tool, Agent, CLI, Tape, Journal, retry, and crash suites. Do not push.
