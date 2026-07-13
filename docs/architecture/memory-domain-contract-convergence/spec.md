# Memory Domain Contract Convergence — Specification

> This document defines the maintained goals, constraints, and acceptance criteria for the converged agent
> memory domain contracts.
>
> - Status: **implemented**
> - Classification: architecture refactor
> - Migration class: schema-free and behavior-preserving
> - GitHub issue: none

## 1. Problem Statement

The memory presenter had already been divided into facade, service, infrastructure, and core
modules, but contract ownership still crossed those boundaries:

- Domain-facing memory and audit types were owned by concrete SQLite table modules.
- `MemoryRepositoryPort` and `MemoryAuditRepositoryPort` exposed broad composite surfaces to
  consumers that needed only a small subset of operations.
- `MemoryRuntimeContext` exposed raw dependencies and the provider gateway, making it an implicit
  service locator for repositories, provider callbacks, vector factories, and event sinks.
- Provider consumers obtained text generation, embeddings, configuration, and cancellation through
  the same broad runtime path.
- Update reasons, agent-id validation, and audit actor/status values had duplicate definitions across
  main-process code and shared wire contracts.
- `MemoryInjectionResult` exposed both nested canonical data and duplicated top-level payload fields.
- Architecture checks relied on partial textual matching and disk-backed test fixtures, leaving
  fail-open, false-positive, false-negative, and test-race risks.

These problems increased coupling and made it possible for a local change to bypass intended memory
layer boundaries without a compile-time or CI failure.

## 2. Goals

Establish enforceable ownership and dependency boundaries without changing persisted data or user
visible memory behavior:

1. Move memory and audit domain types out of SQLite concrete modules.
2. Give each service and infrastructure component only the capabilities it needs.
3. Keep composite ports limited to composition, adapters, gateways, fakes, and conformance tests.
4. Restrict `MemoryRuntimeContext` to shared runtime coordination concerns.
5. Preserve provenance resolution, cancellation, operation fences, read epochs, audit ordering, and
   performance observation semantics.
6. Make shared wire-facing definitions the single source of truth for update reasons, agent IDs,
   and audit actor/status values.
7. Represent injection results with one canonical view while retaining legacy input compatibility at
   the injection boundary.
8. Enforce the architecture with fail-closed TypeScript AST and symbol-aware checks.

## 3. Locked Design

### 3.1 Domain Ownership

- `memoryPresenter/domain/types.ts` owns memory rows, lifecycle/status types, write and recall
  results, cursors, health types, and `MemoryModelRef`.
- `memoryPresenter/domain/audit.ts` owns audit rows, insert/list inputs, health aggregation types,
  and consumes shared audit value types.
- SQLite memory tables import domain types with type-only imports and do not re-export them.
- `memoryPresenter/types.ts` keeps the pre-refactor compatibility surface through explicit named
  re-exports. It must not use wildcard re-exports or create a second path for new narrow ports and
  internal collaborator types.
- Snake-case persistence row fields, nullable rules, and union values remain unchanged.

### 3.2 Repository and Audit Capabilities

Repository behavior is split into these narrow capabilities:

- `MemoryReadRepositoryPort`
- `MemoryMutationRepositoryPort`
- `MemoryAccessRepositoryPort`
- `MemoryEmbeddingRepositoryPort`
- `MemoryLifecycleRepositoryPort`
- `MemoryHealthRepositoryPort`
- `MemoryTransactionPort`

Audit behavior is split into:

- `MemoryAuditReadPort`
- `MemoryAuditWritePort`
- `MemoryAuditMaintenancePort`

`MemoryRepositoryPort` and `MemoryAuditRepositoryPort` remain composition-only composites. Each
existing repository method belongs to exactly one capability.

### 3.3 Provider and Runtime Capabilities

Provider and runtime dependencies are represented by:

- `MemoryAgentPolicyPort`
- `MemoryTextGenerationPort`
- `MemoryEmbeddingGatewayPort`
- `MemoryProviderControlPort`
- `MemoryProviderGatewayPort`
- `MemoryVectorStoreFactoryPort`
- `MemoryChangeSinkPort`

The provider composite is implemented by the gateway but is not injected into services,
infrastructure, or context. Text-generation consumers receive only text generation; embedding
consumers receive only embedding and dimension lookup; context privately receives only provider
control.

### 3.4 Runtime Context Boundary

`MemoryRuntimeContext` owns:

- disposed, enabled, managed-agent, and safe-agent guards;
- operation generation fences and read epochs;
- per-agent and global provider cancellation coordination;
- model selection;
- runtime cleanup;
- audit writes and memory-change notifications.

It does not expose repositories, provider gateways, vector factories, or raw presenter dependencies.
Its public surface is architecture-guarded. `resolveProvenance` belongs to `MemoryRowMutations` and is
exposed through `MemoryProvenanceResolverPort`.

### 3.5 Shared Contract Sources

- `MemoryUpdateReason` is inferred from the shared Zod schema.
- The authoritative agent-id RegExp and predicate live in shared agent-memory types.
- Audit actor, status, and failure-status constants and types live in shared agent-memory types.
- Route schemas, runtime guards, domain audit types, and public re-exports consume these definitions.
- The shared lineage codec remains the only parser and serializer for `source_entry_ids`.

### 3.6 Injection Contract

The canonical result is:

```ts
interface MemoryInjectionResult {
  payload: MemoryInjectionPayload
  manifest: MemoryInjectionManifest
}
```

The injection-port module owns the only normalizer. All public section helpers accept legacy plain
payloads, legacy duplicated results, and canonical results through that normalizer. Runtime and facade
production paths emit only the canonical result.

## 4. Scope

### In Scope

- Domain and audit type ownership.
- Repository, audit, provider, policy, vector, event, and collaborator capabilities.
- Service and infrastructure constructor narrowing.
- Runtime-context convergence.
- Shared update-reason, agent-id, and audit value sources.
- Canonical injection result and legacy boundary normalization.
- Architecture guard, contract tests, conformance tests, and as-built documentation.

### Out of Scope

- SQLite or DuckDB schema, migration, index, or SQL behavior changes.
- Memory ranking, extraction, decision, embedding, lifecycle, persona, or working-memory algorithm
  changes.
- Provider rate-limit, timeout, retry, batching, lease, or cancellation behavior changes.
- IPC, tool, renderer DTO, event payload, or public presenter method changes.
- Status-machine redesign or persistence-row shape normalization.
- Broad cleanup of unrelated SDD or architecture documents.

## 5. Acceptance Criteria

- **AC-1 — Domain ownership:** Domain, core, services, and root contracts do not import SQLite memory
  concrete types. SQLite tables are type-only domain consumers.
- **AC-2 — Capability isolation:** Every service and infrastructure constructor declares only the
  repository, provider, audit, policy, vector, and collaborator capabilities it uses.
- **AC-3 — Context boundary:** Production services and infrastructure do not access `ctx.deps` or
  `ctx.provider`; context exposes no repository, provider, or vector-factory escape hatch.
- **AC-4 — Adapter parity:** SQLite tables and shared fakes satisfy the complete composition ports
  without casts or index signatures hiding missing methods.
- **AC-5 — Shared value sources:** Update reasons, agent-id validation, and audit actor/status values
  are derived from shared authoritative definitions and have compile-time and wire-level parity tests.
- **AC-6 — Lineage preservation:** Memory, table, and route code use only the shared lineage codec;
  local lineage JSON helpers are rejected.
- **AC-7 — Behavior parity:** Recall, injection, write outcomes, lifecycle, persona, working memory,
  audit/event ordering, cancellation, fences, cleanup, and access accounting remain unchanged.
- **AC-8 — Performance parity:** Repository observation is applied once before capability projection;
  workload counters and high-water bounds remain valid.
- **AC-9 — Public compatibility:** Presenter dependencies and methods, IPC, tools, renderer contracts,
  schemas, and persistence formats remain unchanged. Legacy injection inputs remain accepted.
- **AC-10 — Enforced architecture:** The guard fails closed when the TypeScript config/program cannot
  be created and rejects forbidden imports, composites, context escapes, type ownership, and local
  lineage codecs using AST and symbol analysis.
- **AC-11 — Safe guard tests:** Architecture fixtures use an in-memory virtual source overlay and
  never create or remove files under production source directories.
- **AC-12 — Documentation:** The implementation plan, task record, and bilingual as-built memory
  architecture describe the same ownership and dependency rules as the code.

## 6. Compatibility and Risk Controls

- The facade remains the only complete composition root.
- The public `MemoryPresenterDeps` input shape remains stable.
- The complete repository is wrapped by the performance observer exactly once, and all capabilities
  are projected from that same observed object.
- Transaction, await, cancellation/fence, audit, notification, and cleanup ordering must remain
  unchanged during constructor migration.
- Managed-agent callback presence semantics and malformed embedding handling remain compatible with
  the pre-refactor runtime behavior.
- No persistence migration or data backfill is required.

## 7. Open Questions

None. The ownership, capability, compatibility, and validation decisions are locked.
