# Memory Domain Contract Convergence — Implementation Plan

> Goals and acceptance criteria are defined in [spec.md](./spec.md). The completed execution record
> is in [tasks.md](./tasks.md).

## 1. Strategy

Use a behavior-preserving strangler refactor:

1. Freeze observable behavior and architecture boundaries with characterization and negative tests.
2. Move domain ownership while preserving the established compatibility import path.
3. Define narrow capabilities and make adapters/fakes satisfy the complete composites first.
4. Migrate services and infrastructure to explicit dependency objects.
5. Converge provider access and reduce the runtime context.
6. Converge shared contracts and the injection result.
7. Strengthen the architecture guard and synchronize as-built documentation.

The facade remains the only full composition root throughout the migration. SQL, algorithms, side
effect ordering, and error handling must not change as part of dependency narrowing.

## 2. Module Ownership and Dependency Direction

### 2.1 Responsibilities

- `memoryPresenter/domain/types.ts`: pure memory-domain types.
- `memoryPresenter/domain/audit.ts`: pure audit-domain types consuming shared audit values.
- `memoryPresenter/ports.ts`: narrow capabilities, collaborator contracts, and composition-only
  composites.
- `memoryPresenter/context.ts`: cross-service guards, fences, epochs, cancellation, model resolution,
  audit, notifications, and cleanup.
- `memoryPresenter/types.ts`: `MemoryPresenterDeps`, configuration constants, and explicit historical
  compatibility re-exports.
- `memoryPresenter/index.ts`: facade and sole complete composition root.
- SQLite tables: persistence implementations and type-only domain consumers.

### 2.2 Dependency DAG

- `domain/` may depend only on shared types and constants.
- `ports.ts` may depend only on domain and shared contracts.
- `context.ts` may depend on domain, ports, and shared contracts.
- `core/` may depend on domain, pure ports, and shared contracts; it must not depend on context,
  services, infrastructure, facade, or SQLite concrete modules.
- `services/` may depend on domain, ports, context, and core; they must not import infrastructure or
  another concrete service.
- `infra/` may depend on domain, ports, context, and core; it must not import services.
- Only `index.ts` may compose services and infrastructure together.
- SQLite tables may import domain types with type-only imports but must not own or re-export them.

`MemoryModelRef` belongs in the domain to avoid a ports-to-context cycle.

## 3. Domain Ownership Migration

### 3.1 Memory Types

Move the existing row, status, conflict, persona, insert/list, lifecycle, health, recall, write-result,
cursor, vector, and model-reference types into `domain/types.ts` without changing fields, nullability,
or union values. SQLite row creation and mapping remain unchanged.

Use explicit named re-exports in `memoryPresenter/types.ts` for names that existed on the compatibility
path before the refactor. New narrow capabilities and internal collaborator result types must be
imported directly from their owner modules.

### 3.2 Audit Types

Move audit row, insert/list input, and health types into `domain/audit.ts`. Import audit actor/status
types from shared constants. Preserve table schema version, `memory_ref_id`, JSON reference fallback,
query behavior, and returned shapes.

### 3.3 SQLite Boundaries

Update main-process routes to import row types from domain modules. Remove type re-exports from the
SQLite table modules. Keep the concrete table classes and all persistence behavior unchanged.

## 4. Capability Ports

### 4.1 Repository Groups

Assign each repository method to exactly one group:

- **Read:** ID/provenance lookup, agent listing and management pages, persona reads, keyword search,
  working candidates, active-agent discovery, and active-memory checks.
- **Mutation:** insert, provenance rekey, status/content/metadata updates, confidence/importance,
  persona/anchor, supersede/conflict mutations, delete, and clear.
- **Access:** single and batch access recording.
- **Embedding:** pending activation and completion/error updates, requeue/status scans, current
  identity and stale checks, and vector-reference reconciliation.
- **Lifecycle:** cognitive-maintenance input, decay and consolidation markers, archive eligibility,
  conflict integrity, consolidation scans, and internal status repair.
- **Health:** health statistics, top-accessed rows, counts, status view, and persona counts.
- **Transaction:** synchronous `runInTransaction`.

`MemoryRepositoryPort` extends those capabilities and declares no additional methods.

Audit methods are assigned as follows:

- **Write:** `insert`
- **Read:** list, latest completed event, forget-event lookup, and health audit statistics
- **Maintenance:** `pruneOperationalEvents`

`MemoryAuditRepositoryPort` extends all three audit capabilities.

### 4.2 Consumer Matrix

| Consumer | Repository capabilities | Other capabilities |
| --- | --- | --- |
| `MemoryRowMutations` | Read + Mutation + Embedding + Transaction | optional Audit Read; Provenance Resolver implementation |
| `WorkingMemoryService` | Read + Mutation + Transaction | none |
| `RetrievalService` | Read + Access | Agent Policy + Embedding Gateway + Vector Retrieval + Working Read |
| `ReflectionService` | Read + Mutation + Lifecycle + Transaction | Text Generation + Provenance Resolver |
| `PersonaService` | Read + Mutation + Lifecycle | Text Generation |
| `ConflictService` | Read + Mutation + Embedding + Lifecycle + Transaction | Text Generation |
| `WriteCoordinator` | Read + Mutation + Embedding + Transaction | Agent Policy + Text Generation + Provenance Resolver |
| `MaintenanceService` | Read + Mutation + Embedding + Lifecycle + Transaction | Agent Policy + Text Generation + optional Audit Read + Audit Maintenance + Provenance Resolver |
| `ManagementService` | Read + Mutation + Embedding + Lifecycle + Health + Transaction | Agent Policy + optional Audit Read |
| `EmbeddingPipeline` | Read + Embedding | Agent Policy + Embedding Gateway + narrow row callbacks |
| `VectorStoreManager` | Embedding | Agent Policy + Vector Store Factory + optional Perf Observer |

If a consumer needs an existing method not represented in the matrix, update the owning capability
and the matrix. Do not inject a composite or create a duplicate one-off repository interface.

### 4.3 Collaborator Ports

Define narrow collaborator contracts for provenance resolution, pending-row checks, write mutations,
manual edits, and maintenance row mutations. Consumers depend on those interfaces rather than the
concrete sibling service.

Move provenance resolution into `MemoryRowMutations` without changing:

1. normalized v2 lookup;
2. legacy lookup;
3. transactional rekey;
4. unique-conflict recovery;
5. final authoritative owner reload.

## 5. Provider and Context Convergence

### 5.1 Provider Gateway

Construct `MemoryProviderGateway` from a narrow internal dependency object rather than the complete
presenter dependencies. Project the gateway into:

- text generation;
- embedding and dimension lookup;
- provider cancellation control.

Preserve purpose labels, rate limiting, signals, deadlines, retry behavior, batching, and bounded late
settlement.

### 5.2 Runtime Context

Construct context from a single internal options object containing:

- agent policy;
- optional audit writer;
- optional change sink;
- mutation invalidation callback;
- private provider control.

Keep the existing guard, fence, epoch, model-resolution, cancellation, cleanup, audit, and event
methods. Remove raw `deps`, public provider access, provenance resolution, and every repository/vector
escape hatch.

Preserve callback-presence semantics for managed-agent checks. Missing callbacks allow the historical
default; a present callback returns its value without nullish coalescing. Missing or malformed current
embedding identities return `false` without throwing.

### 5.3 Performance Observation

Move repository observation to facade composition:

1. Wrap the complete repository once.
2. Project every repository capability from that observed object.
3. Never pass the unobserved repository to a service.
4. Inject optional performance observers explicitly into provider/vector infrastructure.

This preserves `repositoryCalls`, `materializedRows`, provider calls, DuckDB statements, open stores,
leases, queue depth, and cache high-water semantics.

## 6. Shared Contracts and Injection

### 6.1 Update Reasons

Export `MemoryUpdateReason` as the inferred type of the shared reason schema. Main-process contracts
import or compatibility-re-export that type and do not maintain a handwritten union.

### 6.2 Agent IDs and Audit Values

Shared agent-memory types own:

- the agent-id pattern and `isSafeAgentId` predicate;
- audit actor constants and type;
- audit status constants and type;
- failure-status constants and type.

Route schemas, domain audit contracts, runtime audit writes, and facade exports consume those shared
definitions. Tests use fixed literal truth tables rather than deriving expected values from the same
implementation under test.

### 6.3 Lineage Codec

Keep `src/shared/lib/agentMemoryLineage.ts` as the only implementation of lineage parsing and
serialization. Memory scoring, management, routes, and tables import the shared codec. No local JSON
helper may parse or serialize `source_entry_ids`.

### 6.4 Canonical Injection Result

Define `MemoryInjectionResult` as `{ payload, manifest }`. Runtime, facade, retrieval, and fakes emit
only that shape.

Keep one module-level normalizer in the injection-port module. `buildMemorySection`,
`appendMemorySection`, and `appendMemorySectionWithManifest` all use it to accept legacy payloads,
legacy duplicated results, and canonical results. No other production module performs shape
detection.

## 7. Architecture Guard

Move memory-specific TypeScript analysis into `scripts/lib/memory-architecture-guard.mjs`. Keep
`scripts/architecture-guard.mjs` as the orchestration and CLI entrypoint.

### 7.1 Fail-Closed Compiler Setup

Emit `[memory-guard-program-invalid]` and fail the gate when:

- `tsconfig.node.json` cannot be found;
- the config cannot be read or parsed;
- config parsing returns diagnostics;
- the TypeScript Program cannot be created.

Use focused Program roots for memoryPresenter, the memory tables, the shared memory route, main
routes, lineage candidates, and virtual fixtures. Let TypeScript load transitive dependencies.

### 7.2 Import and Composite Rules

- Domain imports use a true allowlist: domain files and shared modules only.
- Every memoryPresenter layer rejects direct or barrel imports of SQLite concrete implementations.
- Composite detection resolves TypeScript symbols and recognizes aliases and compatibility paths.
- File-specific allowances permit only the composite required by each composition or adapter file.
- The provider gateway may reference the provider composite but not repository or audit composites.

### 7.3 Context and Type Ownership Rules

- Lock the current context public method/getter surface.
- Reject public context data fields and forbidden dependency types.
- Detect direct, aliased, destructured, and bracket access to non-public context capabilities.
- Permit `types.ts` to own only `MemoryPresenterDeps` and established configuration constants.
- Require explicit named compatibility re-exports and reject wildcard or new narrow-port aliases.
- Reject domain type re-exports from SQLite table modules.

### 7.4 Lineage Data Flow

- Seed lineage taint only from exact `source_entry_ids` / `sourceEntryIds` properties and aliases.
- Recognize direct JSON calls, functions, arrows, object properties, methods, helper aliases, and
  wrapper chains.
- Scan actual parser boundaries, including main routes.
- Allow unrelated configuration or audit JSON parsing even when comments or strings mention lineage.
- Allow JSON lineage implementation only in the shared lineage codec.

### 7.5 Virtual Test Overlay

The runner accepts a map of absolute logical paths to source text. File collection, source reads, and
the TypeScript CompilerHost prefer that overlay. Negative and positive fixtures run in one aggregate
analysis without writing to `src/`; a single CLI smoke verifies production source.

## 8. Validation Strategy

### Characterization

Freeze and compare:

- recall IDs, ordering, score breakdown, and manifest;
- legacy/canonical injection rendering, manifest, and access behavior;
- all write outcomes;
- archive, restore, forget, persona, and working-memory behavior;
- audit references and memory-change reason/context;
- deletion/disposal cancellation, fences, epochs, and cleanup ordering;
- workload counters and high-water bounds.

### Contract and Architecture

- Table/fake/composite compile conformance.
- Service constructor capability coverage.
- Reason, agent-id, and audit compile-time/wire parity.
- Architecture positive and negative cases.
- Shared lineage codec tests.

### Commands

Run all pnpm commands through mise:

```text
mise exec -- pnpm exec vitest run --config vitest.config.ts test/main/scripts/architectureGuard.test.ts
mise exec -- pnpm exec vitest run --config vitest.config.ts test/main/contracts/memoryContractParity.test.ts
mise exec -- pnpm exec vitest run --config vitest.config.ts test/main/presenter/memoryRuntimeContext.test.ts
mise exec -- pnpm exec vitest run --config vitest.config.ts test/main/presenter/memoryPresenter.test.ts
mise exec -- pnpm run lint:architecture
mise exec -- pnpm run typecheck:node
mise exec -- pnpm run test:main:memory-perf
mise exec -- pnpm run typecheck
mise exec -- pnpm run format
mise exec -- pnpm run i18n
mise exec -- pnpm run lint
mise exec -- pnpm run test:main
```

Run the focused Native SQLite memory suites only when the installed binary matches the active mise
Node ABI. Do not rebuild workspace dependencies as part of this refactor.

## 9. Rollback

The change is schema-free. A constructor migration can be reverted independently without reverting
domain ownership or another service migration. Compatibility re-exports remain explicit, so rollback
does not require a persistence migration or coordinated wire-contract rollback.
