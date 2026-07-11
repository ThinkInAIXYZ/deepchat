# Memory Domain Contract Convergence — Tasks

> Tasks are ordered by dependency and record the implementation represented by the current diff.
> Acceptance criteria are defined in [spec.md](./spec.md); implementation details are in
> [plan.md](./plan.md).

## Phase A — Characterization and Domain Ownership

### A1. Freeze Behavior

- [x] Preserve recall, injection, write, lifecycle, persona, working-memory, audit, and disposal
  behavior with characterization assertions.
- [x] Cover legacy and canonical injection inputs, rendered output, manifest, and access accounting.
- [x] Preserve provider abort, operation-fence, read-epoch, audit/event, and cleanup ordering.
- [x] Preserve repository and infrastructure performance-counter semantics.

### A2. Establish Domain Type Owners

- [x] Add `memoryPresenter/domain/types.ts` for memory-domain types and `MemoryModelRef`.
- [x] Add `memoryPresenter/domain/audit.ts` for audit-domain types.
- [x] Convert SQLite memory tables to type-only domain consumers.
- [x] Remove domain type re-exports from SQLite concrete table modules.
- [x] Update routes to import row types from domain modules.
- [x] Preserve explicit established compatibility exports in `memoryPresenter/types.ts`.
- [x] Add compile-time conformance for SQLite adapters and shared fakes.

## Phase B — Repository Capabilities and Stateful Services

### B1. Define Repository and Audit Capabilities

- [x] Define seven repository capabilities with each method declared once.
- [x] Define audit read, write, and maintenance capabilities.
- [x] Retain repository and audit composites for composition and conformance only.
- [x] Define provenance and row-mutation collaborator ports.

### B2. Migrate Stateful Services

- [x] Migrate `MemoryRowMutations` to Read + Mutation + Embedding + Transaction and optional Audit
  Read.
- [x] Move provenance resolution from context to `MemoryRowMutations` without changing lookup,
  transaction, rekey, conflict recovery, or reload ordering.
- [x] Migrate working, reflection, persona, conflict, and write services to their declared capability
  intersections.
- [x] Remove concrete sibling-service imports in favor of collaborator ports.
- [x] Preserve conflict liveness checks, write decisions, transactions, audit, and notification order.

## Phase C — Provider, Context, and Remaining Consumers

### C1. Define Provider and Runtime Ports

- [x] Define agent policy, text generation, embedding gateway, provider control, provider composite,
  vector-store factory, and change-sink ports.
- [x] Construct the provider gateway from narrow internal dependencies.
- [x] Preserve provider purpose, rate limit, deadline, signal, retry, and cancellation behavior.
- [x] Keep the public presenter dependency input unchanged.

### C2. Migrate Provider and Infrastructure Consumers

- [x] Inject Text Generation into write, reflection, persona, conflict, and maintenance consumers.
- [x] Inject Embedding Gateway into retrieval and embedding infrastructure.
- [x] Inject Agent Policy where configuration or model resolution is required.
- [x] Inject Vector Store Factory and optional Perf Observer into vector infrastructure.
- [x] Apply repository observation once in facade composition and project every capability from the
  same observed object.

### C3. Migrate Maintenance and Management

- [x] Give maintenance only the repository, policy, text, provenance, Audit Read, and Audit
  Maintenance capabilities it uses.
- [x] Keep `pruneOperationalEvents` in the audit-maintenance capability.
- [x] Give management only its read, mutation, embedding, lifecycle, health, transaction, policy, and
  optional Audit Read capabilities.
- [x] Preserve budgets, cooldowns, retention, pagination, content bounds, and DTO behavior.

### C4. Converge Runtime Context

- [x] Replace the context constructor with one internal options object.
- [x] Retain guards, model resolution, fences, epochs, cancellation, cleanup, audit, and events.
- [x] Remove raw `deps`, public provider access, repository access, vector factories, and provenance
  resolution from context.
- [x] Restore callback-presence semantics for managed-agent checks.
- [x] Make missing or malformed embedding identity checks return `false` without throwing.
- [x] Add runtime characterization for nullish callback results and malformed embedding inputs.

## Phase D — Shared Contracts and Injection

### D1. Converge Shared Value Sources

- [x] Infer `MemoryUpdateReason` from the shared Zod schema.
- [x] Share one agent-id pattern and predicate across routes, runtime, and facade.
- [x] Share audit actor, status, and failure-status constants and types across domain, runtime, and
  routes.
- [x] Add compile-time reason/audit parity and runtime unknown-value rejection.
- [x] Replace circular agent-id expectations with a fixed literal truth table.

### D2. Preserve the Shared Lineage Codec

- [x] Keep memory scoring, management, routes, and SQLite tables on the shared lineage codec.
- [x] Reject local lineage JSON parsers and serializers through architecture checks.
- [x] Preserve the existing lineage parser and serializer semantics.

### D3. Canonicalize Injection Results

- [x] Define canonical `MemoryInjectionResult` as `{ payload, manifest }`.
- [x] Emit only canonical results from retrieval, runtime, facade, and fakes.
- [x] Keep one injection-module normalizer for legacy payloads and duplicated result shapes.
- [x] Route all three public section helpers through the same normalizer.
- [x] Verify rendered output, manifest, selected-only access, and anchor behavior.

## Phase E — Architecture Enforcement

### E1. Build the Memory AST Guard

- [x] Extract memory-specific AST analysis into `scripts/lib/memory-architecture-guard.mjs`.
- [x] Fail closed when TypeScript config or Program construction is unavailable or invalid.
- [x] Restrict domain imports to domain and shared modules.
- [x] Reject direct and barrel SQLite concrete imports from every memoryPresenter layer.
- [x] Resolve composite symbols through aliases and compatibility paths.
- [x] Enforce file-specific composite allowlists.
- [x] Lock context public names and reject forbidden dependency return/parameter types.
- [x] Detect direct, aliased, destructured, and bracket context escape access.
- [x] Lock explicit `types.ts` compatibility re-exports and local ownership.
- [x] Reject domain type re-exports from SQLite table modules.

### E2. Strengthen Lineage Analysis

- [x] Taint only exact lineage fields and their aliases.
- [x] Detect direct JSON calls, function/arrow helpers, object property helpers, methods, aliases, and
  wrapper chains.
- [x] Include main routes in the parser boundary.
- [x] Avoid false positives for comments, strings, and unrelated audit/config JSON.

### E3. Replace Disk Fixtures

- [x] Add an absolute-path virtual source overlay to the architecture runner and TypeScript host.
- [x] Combine positive and negative fixtures into one aggregate in-memory analysis.
- [x] Retain one production CLI smoke test.
- [x] Confirm architecture tests create no files under `src/`.

## Phase F — Documentation and Validation

### F1. Documentation

- [x] Document domain ownership, capability ports, facade composition, and context boundaries.
- [x] Document fail-closed architecture enforcement and virtual fixtures.
- [x] Synchronize English and Chinese as-built agent-memory architecture references.

### F2. Completed Gates

- [x] Focused runtime, contract, architecture, and memory presenter tests pass.
- [x] Architecture suite completes with one aggregate analysis and one production CLI smoke.
- [x] Memory performance tests pass where the environment does not require the unavailable Native
  binary.
- [x] Node and renderer typechecks pass.
- [x] Formatting, i18n, lint, architecture lint, and diff whitespace checks pass.
- [x] No memory, audit, or DuckDB schema/migration change is present.
- [x] No public presenter, IPC, tool, renderer, or provider behavior change is present.

### F3. Remaining Validation Blockers

- [ ] The complete main-process test suite passes. Two independently reproducible failures outside
  this architecture change remain: converted-steer rebudgeting and a debug mock missing a `plan`
  block.
- [ ] Native SQLite memory suites execute successfully. The installed native module currently targets
  a different Node ABI than the active mise runtime; the dependency was not rebuilt or reinstalled.

The architecture implementation is complete, but the SDD remains validation-blocked until both
remaining gates succeed.
