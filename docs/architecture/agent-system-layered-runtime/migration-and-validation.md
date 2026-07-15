# Agent System Layered Runtime — Migration and Validation

## 1. Compatibility policy

This is a structural migration. Existing behavior is the baseline contract, including awkward behavior that
may deserve a later fix. A refactor PR is blocked when it changes observable ordering, fallback, persistence,
permission settlement or resource selection without a separate approved behavior spec.

No phase requires a DB migration. Every phase writes the same persisted shapes and can roll back by restoring
the previous delegate.

## 2. Wire and storage freeze

### Wire contracts

The following remain stable:

- all `sessions.*`, `chat.*`, `config.*`, `memory.*`, MCP, skills and provider route names;
- route schemas and renderer client return shapes;
- `chat.stream.*`, `sessions.*`, plan, memory, ACP mode/config/command and catalog event payloads;
- RemoteControl and CronJobs ports and status/output semantics;
- preload/typed bridge boundaries.
- the supported `kind=deepchat + providerId=acp` route/storage combination and its
  `MessageStartResult`/request projection.

Internal discriminated types are converted to current wire DTOs by boundary codecs. A deprecated alias may
remain in the DTO during this goal, but it cannot leak back into domain/backend contracts.

Legacy agent rows use two read policies: catalog listing preserves current tolerant parse/null/default/filter
behavior per row, while backend open requires a valid executable descriptor and may return typed unavailable.
Malformed `config_json`/`state_json`, missing manual command, invalid source×kind and source/id collision cannot
fail the whole catalog or fallback to another kind.

### Storage contracts

Do not rename, merge or recreate these stores in this goal:

| Store | Contract to preserve |
| --- | --- |
| `agents` | common row plus current JSON columns; typed codecs split above it |
| `new_sessions` | app identity/title/project/pin/draft/skill/subagent shell；`session_kind` remains `regular | subagent`, not backend kind |
| `deepchat_sessions` | provider/model/settings/summary/memory cursor |
| structured message/search tables | hot read/write projection and fallback JSON behavior |
| pending input tables | state/claim/order/recovery semantics |
| `deepchat_tape_entries` | per-session monotonic semantic facts/anchors/manifests |
| `deepchat_message_traces` | current redacted provider request trace behavior |
| `acp_sessions` / `acp_turns` | app conversation to remote session/turn mapping |
| `agent_memory` / audit / projection tables | current Memory schema/version/transaction semantics |
| per-agent DuckDB sidecars | current embedding identity and lifecycle behavior |

## 3. Baseline behavior matrix

### Session and turn

- input/config/default precedence remains input > agent config > global defaults;
- explicit project-dir null/normalization stays intact;
- session list hydration remains lightweight and lazy;
- status and the pre-stream AbortController are registered before long preparation awaits, while the active
  generation remains registered only after context assembly and assistant placeholder creation;
- stale run completion cannot overwrite a newer run's state;
- claimed pending inputs recover after crash and are not exposed twice;
- queue/steer ordering, max count and single-flight drain stay unchanged;
- partial assistant output and terminal cancellation are persisted/emitted once;
- first-turn readiness/title generation remains non-blocking and stale-run safe.

### Provider and context

- every provider attempt passes rate admission and cancellation checks;
- `providerRoundCount` increments/checks max at each outer round entry；`requestSeq` increments per provider
  attempt before ViewManifest, including strict retry within the same outer round；
- base resource prompt is assembled before compaction intent preparation; user fact precedes compaction apply
  on the intent path; summary/reconstruction/Memory and context follow compaction;
- context preflight, pressure compaction/recovery and strict retry retain current order;
- context overflow is not confused with quota/rate-limit errors;
- interleaved reasoning preservation uses current model portrait rules;
- image/video endpoint budget bypass stays unchanged.

### Tool, skill and permission

- MCP name collision precedence and tool source routing remain unchanged;
- only the currently allowed readonly agent-tool batch may execute in parallel;
- mutating/side-effect tools are not replayed or retried for output fitting;
- output guard/offload/downgrade and screenshot normalization remain unchanged;
- agent-scoped MCP/skill/plugin policy and disabled tools apply to the bound `agentId`;
- `skill_view` activation refreshes tools/prompt only under the current rules;
- question, pre-check permission, post-call `requiresPermission` and post-success skill-draft interactions
  preserve their current ordered batch and durable continuation;
- a paused run settles; intermediate interaction responses stay paused, and only the final response creates the
  current fresh resume run rather than resuming the old provider call stack;
- `default`, `auto_approve`, `full_access` and auto-review fallback behavior remain unchanged.

### ACP

- global enablement and manual/registry/install/env configuration remain compatible;
- alias normalization remains in effect;
- workdir is required/synchronized before send, with current reset/rollback behavior;
- system prompt is marked sent only after a successful ACP prompt;
- session load/resume/new fallback, modes, config options and commands remain compatible;
- advertised commands do not imply a direct `executeCommand` route/SDK facet;
- protocol permission promises settle on decision, timeout, cancel, clear and shutdown;
- transfer into ACP remains rejected before mutation; supported ACP -> DeepChat transfer closes the direct ACP
  runtime at the current post-ownership commit point (legacy DeepChat + ACP-provider keeps compatibility
  binding cleanup there);
- regular ACP keeps its current compatibility prompt/local-resource behavior;
- ACP-backed subagent keeps current isolation/bypass/retry behavior;
- remote ACP sync's legacy conversation behavior is not silently unified with `new_sessions`.
- direct `kind=acp` uses the existing structured message/Tape/event writers so restart/search/export remain
  compatible; `acp_turns` remains metadata-only.
- direct `kind=acp` writes the same fail-open `acp://session/prompt` request trace with current
  message/request correlation, redaction/truncation and trace-before-prompt order;
- trace persistence failure is characterized at the real fail-open emitter/adapter boundary, not by a
  provider-private mock that injects a rejecting persistence implementation;
- DeepChat descriptors selecting `providerId=acp` keep the DeepChat outer loop, regular compatibility
  system-prompt/resource descriptions and ACP-as-provider adapter.

### Tape

- user/final/tool facts remain monotonic and idempotent by provenance;
- edit/delete are replacement/retraction facts, not in-place Tape mutation;
- effective view, bootstrap/backfill, anchors, handoff, true-fork merge/discard, and production
  subagent Tape links remain compatible;
- one ViewManifest write is synchronously attempted before each actual provider request at the current point;
  write failure logs and remains fail-open, so a request may legally have no manifest;
- trace/replay default remains metadata-only; raw payload inclusion stays opt-in;
- session clear/delete retains current Tape deletion semantics.

## 4. Memory no-regression contract

Memory is the highest-risk cross-cutting participant and migrates last. These IDs are the single authoritative
wording; module and task documents reference them without redefining them.

| ID | Frozen invariant |
| --- | --- |
| `MEM-01` | Disabled Memory or any injection failure returns the original prompt unchanged. |
| `MEM-02` | Injection keeps sanitization, untrusted/read-only framing and hard token budget. |
| `MEM-03` | Only active persona is injected; working memory is separate; unapproved persona draft is excluded. |
| `MEM-04` | Injection access is recorded only for final selected manifest IDs. With a non-null messageId it is deduped by session/message under the current TTL/cap; null-messageId pressure-recovery calls keep current non-deduped accounting. This is not extraction dedupe. |
| `MEM-05` | `memory/view_assembled` failure does not remove an already assembled prompt. |
| `MEM-06` | Extraction input comes from the effective Tape/projection with the exact lineage of the window built inside the serialized task. |
| `MEM-07` | Extraction stays background and per-session serial; sibling sessions may progress independently. Enqueue keeps the trigger path and existing compaction upper bound only. The serialized task ensures the current epoch and reads the latest cursor/tail when it starts; only same-job chunk continuations carry `expectedEpoch`. |
| `MEM-08` | Cursor advances only after `ok: true`; failed/disabled work cannot consume the range. |
| `MEM-09` | Projection validation/rebuild failure falls back to authoritative Tape without committing cursor and keeps the retry cooldown. |
| `MEM-10` | Edit/delete/retry/pending rollback/clear/destroy invalidate stale epochs and rewind/rebuild at the current boundary. |
| `MEM-11` | Agent delete clears Memory rows/audit transactionally before best-effort vector sidecar cleanup. |
| `MEM-12` | App shutdown aborts and drains Memory before SQLite closes; late writes remain fenced. |
| `MEM-13` | Initial and resume terminal triggers preserve the outcome matrix below; returned abort and thrown AbortError are distinct. |
| `MEM-14` | At the existing extraction-enabled compaction entry points only—initial input and context-pressure recovery—a non-null intent triggers extraction after any normal `applyCompactionIntent` return, including `succeeded=false`; any throw, including AbortError, triggers nothing, and no intent triggers nothing. Resume and manual compaction do not enqueue compaction extraction; resume terminal fallback remains governed by `MEM-13`. |

Terminal trigger matrix:

| Origin/outcome | Enqueue fallback extraction |
| --- | --- |
| initial turn returns `completed` | yes |
| initial turn returns `aborted` | no |
| initial turn returns `paused` or `error` | no |
| initial turn throws AbortError or another error | no |
| resume returns `completed` | yes |
| resume returns `aborted` | yes |
| resume returns `paused` or `error` | no |
| resume throws AbortError or another error | no |

Compaction trigger matrix:

| Entry point | Intent/apply outcome | Enqueue compaction extraction | Upper bound |
| --- | --- | --- | --- |
| initial input or context-pressure recovery | no intent | no | none |
| initial input or context-pressure recovery | `applyCompactionIntent` returns with `succeeded=true` | yes | intent target cursor |
| initial input or context-pressure recovery | `applyCompactionIntent` returns with `succeeded=false` | yes | intent target cursor |
| initial input or context-pressure recovery | apply throws AbortError or another error | no | none |
| resume or manual compaction | any intent/apply outcome | no | none |

Memory service internals are out of scope. ASLR-059 moved the current queue/counter, chains/epochs,
cooldown/access-dedupe and cursor orchestration into one runtime-scoped `MemoryRuntimeCoordinator`; instances
only keep a session handle. ASLR-060 made that coordinator the direct `MemoryPromptContributor` implementation
and preserved the fixed PostCompaction slot. ASLR-061 made it the direct discriminated
`MemoryIngestionObserver`, preserved the complete `MEM-13/14` matrices, and added the composition-root
admission-fence -> Memory dispose -> bounded chain-wait with typed pending outcome -> SQLite-close shutdown
order. A timeout is not reported as settled; permanent coordinator and Memory operation fences reject late
writes. The existing start-time epoch leaves session-id reuse behavior intentionally unchanged; any change
requires a separate behavior spec.

## 5. Golden causal fixtures

Add deterministic fixtures using fake provider/tool ports; never invoke real side effects twice.

### Multi-round success

```text
session status generating + pre-stream AbortController
base prompt + Tape/history + compaction intent
user message projection + Tape fact
compaction apply when intent exists
summary/reconstruction/Memory + context
assistant placeholder + active generation
request ViewManifest attempt seq=1 (write may fail-open)
provider text/tool events
tool call/result projection + Tape facts
request ViewManifest attempt seq=2
provider final response
assistant final projection + Tape fact
terminal event/status idle
eligible background Memory scheduling
```

### Permission pause/resume

```text
provider round -> tool batch
pre-check | question | post-call permission | post-success skill draft -> ordered interactions
persist all pending actions + execution state
user decision
resolve the first matching continuation
execute/deny/answer/confirm under the current origin-specific rule
persist result and remove that interaction
if interactions remain: stay pending and return without a run
otherwise: rebuild context and start one fresh resume run
terminal settlement
```

### Context recovery

```text
assemble initial Tape view
preflight pressure
compaction/recovery attempt
rebuild system prompt including current Memory rule
attempt request manifest with recovered policy/cursor (fail-open)
rate gate
single provider attempt or documented strict retry
```

### ACP permission

```text
ACP prompt active
protocol permission request registered with timeout
renderer action projection
decision | cancel | timeout | close
ACP promise settles once
action/turn terminal state persists
```

## 6. Characterization coverage policy and map

Phase 0 does not translate every behavior row into a new presenter-level test. It first maps existing durable
proof, adds only high-value gaps that can be asserted through a stable public/port seam, and assigns contracts
that require a new typed seam to the phase that introduces that seam. This scheduling does not weaken any
behavior matrix in this document; the assigned phase cannot pass until its narrow contract fixture exists.

Permanent tests assert behavior, ordering, failure policy, persistence or compatibility. Do not retain tests that
only inspect presenter-private maps, mirror the complete internal mock call graph, prove a file was temporarily
moved, assert each proposed stage was called, or dual-run provider/tool side effects. Migration-only parity,
import-path and private-shape tests must be removed after their comparison; final import ownership belongs in the
architecture guard.

| Compatibility row | Phase 0 proof | Owning narrow-seam gate |
| --- | --- | --- |
| malformed agent config/state, missing manual command, invalid source×kind, source/id collision, legacy DTO | repository characterization over current public reads/writes | typed tolerant/strict codec contracts in `ASLR-010` and repository ownership contracts in `ASLR-011` |
| initial/tool/multi-round loop, max rounds, skill refresh, rate wait, cancel and stale run | existing `agentRuntimePresenter/process` contract suites plus focused strict-retry outer-round/request-sequence characterization | complete typed lifecycle causal order in `ASLR-052..056` / Phase 6 |
| prompt order, compaction, overflow recovery and ViewManifest success/failure | existing runtime, compaction and Tape/ViewManifest suites | typed input/context/request lifecycle order in `ASLR-052..054` / Phase 6 |
| tool catalog order/collision/policy/cache/revision, exact execution options/order, normalization/output fitting and abort | existing ToolPresenter, process, dispatch and output-guard suites | typed adapter contracts plus real ToolPresenter collision boundary in `ASLR-055` / Phase 6 |
| pre-check permission, question, skill draft, multiple ordered interactions and fresh-run resume | existing dispatch/runtime interaction suites plus ASLR-056 four-origin order/execution-state and explicit execute-count fixtures | typed batch outcome, post-call no-replay and final-item-only resume completed in `ASLR-056` / Phase 6 |
| external hook payload/order, snapshot isolation and non-blocking failure policy | existing hooks/runtime suites plus ASLR-057 observer order, snapshot, sync-throw, rejected/never-settling contracts | typed notification observer separated from control collaborators and internal diagnostics in `ASLR-057` / Phase 6 |
| ACP regular/subagent behavior and DeepChat + ACP-provider compatibility versus direct `kind=acp` | existing ACP provider/session and DeepChat compatibility suites; Phase 0 had no direct backend | direct instance/composition parity completed in `ASLR-070..071`; route/title/subagent-retry/pending/remote/cron/no-fallback switch completed in `ASLR-072`; generic provider contract and legacy ACP backend retirement completed in `ASLR-073` / Phase 7 |
| Tape facts, effective view, manifest, replay/privacy | existing Tape fact/view/replay suites | recorder/output causal order in `ASLR-052`; pure-read causal join, partial/unavailable states and event-history gap in `ASLR-080`; injected-seam plus native-table non-interference, replay privacy and AST-enforced Memory non-access proof completed in `ASLR-081`; runtime cooldown remains assigned to `ASLR-059`, and event history remains `not_persisted` |
| Memory injection, extraction, cursor, lineage, fencing and current trigger asymmetries | existing Memory and runtime integration suites plus the authoritative `MEM-01..14` matrices below | `MemoryPromptContributor` and `MEM-01..05` parity completed in `ASLR-060`; complete `MEM-13` returned/thrown turn matrix, `MEM-14` compaction return/throw matrix and shutdown drain/fence over `MemoryIngestionObserver` completed in `ASLR-061` / Phase 9 |
| route/event/schema and composition/shutdown facts | compact machine-readable architecture baseline | per-slice integration gates and final architecture guard/baseline in `ASLR-091..092` |

A large presenter fake created only to restate this table is not an acceptable substitute for the assigned typed
contract. E2E remains limited to user-observable smoke coverage; module and real-boundary integration tests are
the primary proof.

## 7. Test gates by boundary

### Control plane/data

- `test/main/presenter/agentRepository.test.ts`
- `test/main/presenter/agentSessionPresenter/agentRegistry.test.ts` (retired after replacement contract exists)
- `test/main/presenter/agentSessionPresenter/agentSessionPresenter.test.ts`
- `test/main/presenter/agentSessionPresenter/integration.test.ts`
- session/table/import/search/export/usage tests touched by the slice
- malformed agent-row fixtures covering catalog visibility, default merge, filtering, unavailable errors and
  current collision precedence

### Loop/tool/context

- all tests under `test/main/presenter/agentRuntimePresenter/`
- all tests under `test/main/agent/shared/` and `test/main/agent/deepchat/`
- relevant `test/main/presenter/toolPresenter/agentTools/` tests
- focused lifecycle-order/golden integration fixtures added by Phase 0

Critical existing coverage includes simple/tool/multi-round loop, skill refresh, prompt order, rate limit,
ViewManifest sequence/failure, context overflow recovery, compaction, queue/steer, permission/question resume,
ACP compatibility branches and stale-run cancellation.

### ACP

- `test/main/presenter/acpProvider.test.ts`
- `test/main/agent/acp/**`
- `test/main/presenter/sqlitePresenter/acpSessions.test.ts`
- agent-session ACP draft/subagent/transfer tests

`ASLR-071` additionally requires focused proof for shared-owner lifetime, shutdown/refresh ordering,
descriptor-identity single-flight, prepare/workdir rollback, mode/config/command mapping, protocol-exit eviction,
permission settlement, regular/subagent prompt isolation, first-turn readiness, pending queue/steer ordering,
production prompt/projection/trace/rate/hook adapters and compatibility-provider reuse. Shutdown fixtures must
prove lazy materialization is fenced, in-flight identity hydration/prepare/send are drained, cleanup failure still
evicts the cache, and process shutdown is attempted after earlier cleanup failure. Rate fixtures must keep direct
waiters in the shared ACP QPS order while compatibility waiters are cancelled on provider rebuild/disable/remove.
The real session-manager fixture must replay initialization-time mode/config/command/session-info/usage updates
after record publication, discard updates emitted by failed resume/load attempts even when they share a persisted
session id, and replay only the successful attempt in original order. Cancellation fixtures must prove one caller
aborts all callers sharing a conversation-scoped initialization, owner shutdown completes without resolving a
stuck session-open RPC, and late SDK resolve/reject cannot publish, persist, restore a live map, leak handlers or
raise an unhandled rejection. Process-manager fixtures must also prove shutdown synchronously fences new
warmup/connection work without waiting for an unresolved spawn, late handles are disposed exactly once without
republication, and stale expected-handle cleanup preserves the replacement bound handle.

`ASLR-072` route proof additionally covers:

- real repository -> app-session lookup -> manager -> direct backend -> façade composition, including strict
  missing/source-mismatched ACP config failure with zero DeepChat/provider fallback;
- ACP title projection invoking `summaryTitles` once without re-dispatching the primary turn through the
  compatibility provider;
- exactly one ACP-backed subagent initialization retry with a new app-session id and failed-id runtime/shared
  state/row cleanup;
- app-level pending queue/steer selection, remote active-generation cancel through manager generation facets,
  and Cron detached-session/send wiring;
- lightweight list state without direct runtime hydration, direct transfer post-commit close, ACP target
  pre-mutation rejection and direct-before-shared-owner shutdown order;
- descriptor-independent delete across missing agent rows, malformed/manual-commandless ACP rows, missing or
  disabled registry rows and descriptor-valid/current-config-missing rows, with zero input resolution/process
  launch/DeepChat message processing; malformed child recursion, normal DeepChat/direct deletion, durable ACP
  metadata cleanup and runtime-error ordering are also locked by fixtures.

`ASLR-073` contract proof additionally covers:

- compile-time absence of migrated ACP runtime methods from `ILlmProviderPresenter` and explicit ownership by
  session-control, permission and admin ports;
- zero compatibility-provider session-control calls for direct `kind=acp` routes;
- positive DeepChat + ACP-provider workdir, config/commands, permission and clear paths;
- provider admin warmup/process-config/debug routes through their explicit port;
- architecture rejection of retired legacy ACP backend symbols and factory overloads.

### Tape

- `tapeService.test.ts`
- `tapeFacts.test.ts`
- `tapeViewAssembler.test.ts`
- `tapeViewManifest.test.ts`
- `tapeViewPolicy.test.ts`
- structured message/session Tape tests

### Memory

- all `test/main/**` Memory tests, including runtime integration;
- `memoryInjectionPort.test.ts` for budget/sanitization;
- `memoryExtraction.test.ts`, `agent/deepchat/memory/memoryRuntimeCoordinator.test.ts` and
  `agent/deepchat/memory/memoryExtractionChunks.test.ts` for cursor/serialization/chunking;
- `sqlitePresenter/deepchatMemoryIngestionProjection.test.ts` for projection/Tape/transaction behavior;
- `pnpm run test:main:memory-perf`;
- the dedicated native Memory CI job.

## 8. Command gates

### ASLR-062 Memory close-out record

Comparison range: `c600f51b2adedb2147008bd1822cf8c72dac5f6c` (the parent of `ASLR-059`) through
the Phase 9 implementation head `c435746fc`. The ASLR-062 commit itself changes only documentation and test
stability, so the production comparison remains valid after it is applied.

Contract comparison:

- the complete `src/shared/contracts/routes` and `src/shared/contracts/events` trees are unchanged
  (`1ac2dbd3c0aa3f91ab8a86ddf56bb3f52bea9b95` and
  `3a62c4fa3a29e9883b39848ce26d2764360b79d5` respectively), proving no route/event DTO or Memory wire diff;
- `schemaCatalog.ts`, `schemaCatalogMetadata.ts`, `schemaTypes.ts` and the complete SQLite `tables` tree have
  identical Git object IDs before and after Phase 9; the tables tree remains
  `98e855ee04a5a362d4b62b76ef160b2fb51851d3`;
- Memory config surfaces remain identical: `agent-interface.d.ts`, `configPresenter/index.ts`,
  `sqlitePresenter/tables/agents.ts` and `shared/types/agent-memory.ts` have no diff;
- the DuckDB sidecar implementation remains blob `cd2c68de92681b57c0075eca4aedc69750dae917`;
- `DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION` is `1` at both endpoints and its source file has no diff.

Validation results:

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint` and `pnpm run typecheck`: pass;
- focused coordinator/contributor/observer coverage: 3 files, 242 tests passed;
- `pnpm run test:memory:scope`: 56 classified, 4 exempt, pass;
- `pnpm run test:memory`: 43 files, 601 tests passed;
- native SQLite smoke plus `DEEPCHAT_REQUIRE_NATIVE_SQLITE=1` native suite: 6 files, 150 tests passed after
  rebuilding the installed binding for local Node ABI 137 with the repository's CI command; no lockfile or
  dependency manifest changed;
- `pnpm run test:memory:eval`: 1 file, 7 tests passed; hybrid Recall@5 `1.0`, MRR@10 `0.95`, nDCG@10
  `0.9630929753571458`;
- `pnpm run test:main:memory-perf`: the first run shared the machine with other suites and hit one recall-growth
  timing assertion (`3.3584 > 3.3380`); the required isolated rerun passed 6 files and 12 tests. The same
  implementation head also passed the isolated CI performance gate;
- `pnpm run test:main -- --run`: 353 files, 3850 tests passed;
- `pnpm run test:renderer -- --run`: 165 files, 1244 tests passed;
- `git diff --check`: pass.

The local native rebuild exposed two pre-existing full-main test-harness assumptions. The Cron fixture now uses
the real temporary-directory API instead of the global mocked `fs`, and receipt assertions keep exact cardinality
plus both success/failure outcomes without assuming an order for equal timestamps. Production code and behavior
contracts are unchanged. The same implementation head is independently covered by
[PR run 29214356434, memory-native-validation job 86707391042](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/29214356434/job/86707391042),
where scope, portable Memory, native rebuild/smoke/storage, retrieval eval and performance all passed. The x64
build-check for that head also passed. This slice does not regenerate the architecture baseline; final baseline
regeneration remains assigned to `ASLR-092`.

### ASLR-092 final close-out record

Final validation ran on 2026-07-13 from `1e79ddc017a0e71d851f50d536b0ac59b5881105`, with
`origin/dev` verified as an ancestor. The canonical `pnpm run architecture:baseline` write produced the
schema-version-2 agent baseline from a clean relevant working tree:

- all 24 expected current-owner and retained-boundary files exist;
- all 14 owner declarations exist exactly once;
- the 3 retired paths and 9 retired symbols/runtime-kind patterns have zero production matches;
- all DeepChat loop forbidden-import metrics are zero for Presenter, SQLite, Electron, routes and ACP;
- all eight refreshed report artifacts are included:
  `agent-system-layered-runtime-baseline.json`, `archive-reference-report.md`,
  `dependency-report.md`, `main-kernel-boundary-baseline.md`,
  `main-kernel-bridge-register.md`, `main-kernel-migration-scoreboard.json`,
  `main-kernel-migration-scoreboard.md` and `zero-inbound-candidates.md`.
  The tracked `main-kernel-bridge-register.json` was also regenerated and remained byte-identical.

Contract and storage comparison:

- from the Phase 9 pre-Memory endpoint `c600f51b2` through the final implementation head, the route tree
  remains Git object `1ac2dbd3c0aa3f91ab8a86ddf56bb3f52bea9b95`, the event tree remains
  `3a62c4fa3a29e9883b39848ce26d2764360b79d5`, the SQLite tables tree remains
  `98e855ee04a5a362d4b62b76ef160b2fb51851d3`, and the DuckDB sidecar remains
  `cd2c68de92681b57c0075eca4aedc69750dae917`;
- `origin/dev...HEAD` has no route/event diff. Its only SQLite-table source diff exports the existing
  `AgentCreateInput` and `AgentUpdateInput` TypeScript types; it changes no SQL, table identifier, migration or
  stored row shape;
- `DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION` remains `1`;
- the schema-version-2 aggregate hashes are
  `38ab13b229502d09977b531d58ba33498f80b01e63656ea00b451e20fb33f594` for 59 route/event
  contract files, `eb97de4264ffe061beaaaa7870051c8a808b81a056221de1f552e0c14f123e7f` for
  42 SQLite schema files and 51 table identifiers, and
  `56d7d6a66e770ff389431935b67505199a7b8c01abc2fdf7be20f98bde8cf0c6` for the Memory
  DuckDB sidecar. The old schema-version-1 JSON captured `8548b89a3`, before the latest `dev` baseline; its
  aggregate hashes are not used as the migration diff. The Git object comparisons above prove the scoped
  no-schema/no-wire result.

Final gates:

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`,
  `pnpm run lint:architecture`, `pnpm run lint:agent-cleanup` and `git diff --check`: pass;
- architecture baseline/guard tests: 2 files, 24 tests passed;
- `pnpm run test:memory:scope`: 56 classified, 4 exempt, pass;
- `pnpm run test:memory`: 43 files, 601 tests passed;
- `pnpm run test:memory:eval`: 1 file, 7 tests passed; hybrid Recall@5 `1.0`, MRR@10 `0.95`,
  nDCG@10 `0.9630929753571458`;
- `pnpm run test:main:memory-perf`: 6 files, 12 tests passed;
- native SQLite smoke plus the required native Memory suite: 6 files, 151 tests passed after the repository CI
  command rebuilt the installed binding for local Node ABI 137; no lockfile or dependency manifest changed;
- `pnpm run test:main -- --run`: 354 files, 3856 tests passed;
- `pnpm run test:renderer -- --run`: 165 files, 1244 tests passed;
- `pnpm run build`: pass. Its required prebuild refresh updated the tracked provider database, ACP registry and
  generated icon collection/whitelist, which are included as expected repository maintenance;
- `pnpm run e2e:smoke:ci`: 2 tests passed; a separate no-retry launch run passed 1 test; the credential-free
  `09-main-ipc-boundary`, `17-acp-readonly-route` and `26-deepchat-agent-crud` run passed 3 tests.
  Credential-required `02-chat-basic` and `03-session-persistence` were not configured and were not run.

The first local E2E attempt exposed an environment transition and a real diagnostic weakness: the native
SQLite binding was still on Node ABI 137 while Electron 40 required ABI 143, and the startup alert caused
`electronApp.close()` to hide the 60-second main-window failure behind the 300-second test timeout. The binding
was explicitly rebuilt for Electron with the installed `@electron/rebuild`, after which all required E2E runs
passed. The shared Electron fixture now bounds graceful close to 10 seconds and force-kills the child before a
final bounded settle, so future startup failures retain their original cause.

### Phase 3 composition order

The mechanical owner moves retain the existing lifecycle ordering:

```text
READY: presenter-initialization
  -> AFTER_START: acp-registry-migration (priority 0)
  -> AFTER_START: window-creation (priority 1)

BEFORE_QUIT: mcp-shutdown (priority 5)
  -> acp-cleanup (priority 6)
  -> presenter-destroy (priority Number.MAX_VALUE)
```

`test/main/presenter/lifecyclePresenter/compositionOrder.test.ts` locks these relative boundaries. Hooks
with the same priority remain intentionally parallel under `LifecycleManager`; ASLR-033 does not impose a new
order inside a priority group.

Focused PR gate:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck:node
pnpm run test:main -- --run <focused tests>
```

Phase gate:

```bash
pnpm run typecheck
pnpm run test:main -- --run
pnpm run test:renderer -- --run
```

Final gate:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main -- --run
pnpm run test:renderer -- --run
pnpm run test:main:memory-perf
pnpm run e2e:smoke:ci
```

If a local native binding prevents the native Memory job, CI remains required; the skipped local result is not
treated as a pass.

## 9. Rollback policy

- Each slice keeps one active owner; no long-lived dual writers.
- New facades/adapters may delegate backward, so rollback is code-only.
- No phase writes a new mandatory row/payload version before old readers can ignore it.
- This goal writes no new Tape lifecycle entry. Any future interaction/terminal entry requires a separate
  data/behavior SDD and rollback contract.
- A failed phase is reverted before the next dependent phase starts; do not stack work on a red parity gate.
- A discovered behavior defect is recorded separately and the refactor preserves the baseline until that fix is
  approved.

## 10. Final architecture audit

Before retirement completes, verify mechanically:

- no import of retired presenter/runtime paths;
- no `kind=acp` session dispatch branch inside DeepChat loop/resource code; generic provider selection may
  still resolve the ACP adapter for a DeepChat descriptor;
- no internal use of `agentType ?? type`;
- no shared optional capability mega-interface;
- no LoopEngine import of presenter root/Electron/route/concrete SQLite modules;
- no cross-session mutable map in LoopEngine;
- no second Tape store or raw request duplication;
- no MemoryPresenter dependency on DeepChat implementation;
- no stale active SDD plan competing with this goal.
