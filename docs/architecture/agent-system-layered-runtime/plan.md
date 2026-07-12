# Agent System Layered Runtime — Implementation Plan

> 实施进行中；当前完成范围与下一项任务以 [tasks.md](./tasks.md) 为准。  
> 所有 phase 以 `dev` 的最新通过基线为起点，按依赖顺序落地。

## 1. Strategy

采用 strangler + delegation：保留当前 route/event façade，在 façade 后建立新 owner；每次只移动一个
状态簇或一个 collaborator，旧路径在同一提交内改为 delegate。禁止先复制一套 runtime 再长期双写。

实施单位遵循三条规则：

1. 每个 PR 只有一个 ownership change，不夹带 behavior fix。
2. 进入 PR 前补 characterization；退出 PR 时新旧入口跑同一 contract tests。
3. 不用 provider/tool side effect 做 dual-run 对比；parity 基于 request draft、event/fact order 和 fake
   provider/tool fixtures。

## 2. Target dependency direction

```text
routes / remote / cron
        -> AgentManager
            -> AgentCatalog + AppSessionService
            -> explicit backend router
                -> DeepChatAgentRuntime -> DeepChatAgentInstance -> LoopEngine
                -> AcpAgentRuntime      -> AcpAgentInstance

LoopEngine
  -> ProviderPort
  -> ToolCatalogPort / ToolExecutionPort
  -> Prompt/Context collaborators
  -> typed ToolInteractionPort / ToolBatchOutcome
  -> TapeRecorder
  -> OutputSink
  -> Memory adapters (last)
```

Forbidden edges are listed in [README.md](./README.md#目标目录模型) and are enforced by architecture guard
in the cleanup phase.

## 3. Phases

### Phase 0 — Baseline and characterization

Objective: freeze current facts before any owner moves.

Deliverables:

- land this SDD set and mark the old presenter-split proposal superseded;
- build the coverage map in [migration-and-validation.md](./migration-and-validation.md), reusing existing
  long-lived contract tests before adding characterization;
- record current route/event/schema tables and composition/shutdown order in a compact machine-readable
  architecture baseline;
- add focused, long-lived tests only where a stable public/port seam exists and the coverage map identifies a
  high-value gap, including malformed agent-row catalog/executable behavior and provider outer-round versus
  per-attempt request sequence;
- keep the following compatibility rows explicit in the coverage map even when existing tests already cover
  them: initial/resume/pause/cancel/compaction lifecycle order, post-call permission, post-success skill draft,
  multiple ordered interactions, ViewManifest failure, fresh-run resume, Memory trigger asymmetries, ACP
  regular/subagent differences, and `kind=deepchat + providerId=acp` versus `kind=acp`;
- do not expose private state, build a large presenter fake graph, add one test per proposed stage, duplicate a
  lower-level contract with E2E, or dual-run provider/tool side effects merely to characterize the baseline;
- defer the complete causal-order, typed interaction-outcome and `MEM-13`/`MEM-14` narrow contract fixtures to
  Phases 6 and 9, where the stable typed seams exist and those fixtures become phase exit gates;
- delete migration-only parity, import-path and private-shape tests after they have served their comparison;
  permanent tests must assert behavior, ordering, error policy or persisted contracts.

Exit gate:

- no production code behavior diff;
- the coverage map names the existing proof or owning future typed-seam task for every compatibility row above;
- focused high-value baseline tests, the machine-readable architecture baseline and `pnpm run test:main` pass;
- no migration-only test or generated audit report remains unless it is an explicit long-lived contract;
- no unresolved `[NEEDS CLARIFICATION]` marker.

Rollback: documentation/test-only revert.

### Phase 1 — Internal descriptors and catalog ownership

Objective: remove mixed internal agent types without changing wire or storage.

Deliverables:

- add internal `DeepChatAgentDescriptor | AcpAgentDescriptor` discriminated by `kind`, with ACP further split
  into required manual and registry descriptors by `source`;
- split tolerant catalog decode from capability-strict executable decode; a malformed row cannot fail the
  whole list or fallback to another kind;
- keep existing `Agent` route DTO behind a compatibility codec that can emit current `type`/`agentType` shape;
- split `AgentRepository` into:
  - shared `AgentRowCodec` over the existing `agents` table;
  - `DeepChatAgentRepository` for config inheritance/CRUD/delete transaction;
  - `AcpAgentRepository` for manual/registry/install/env state;
- move catalog notifications behind generic `AgentCatalogEventSink` plus explicit ACP process refresh;
- stop DeepChat CRUD from calling an ACP-named notifier while preserving the same renderer refresh result;
- introduce explicit `AppSessionId` and `AcpRemoteSessionId` internal aliases/branded types at ACP boundaries;
- keep `ConfigPresenter` methods as delegates so route contracts remain unchanged.

Exit gate:

- no DB migration/version change;
- repository round-trip, malformed-row tolerant-list/strict-open matrix, config inheritance,
  delete-memory transaction and catalog event tests pass;
- route DTO snapshots remain compatible.

Rollback: delegates can point back to the original repository implementation; rows are unchanged.

### Phase 2 — AgentManager and existing session façade

Objective: establish the real top-level control plane and explicit kind routing.

Deliverables:

- create `AgentManager` with catalog lookup, a thin existing app-session data port and
  `switch (descriptor.kind)`;
- retain `AgentSessionPresenter` as the transitional façade; replace registry/backend resolution in place
  before extracting any additional application service;
- keep message/Tape query, transfer/subagent, title/export/search/usage/backfill/import methods where they are
  until a later ownership slice has a proven seam; do not create one service per noun;
- define two backend handles, initially:
  - `LegacyDeepChatSessionBackend` -> current `AgentRuntimePresenter`;
  - `LegacyAcpSessionBackend` -> current outer runtime + `AcpProvider` path;
- delete `NewMessageManager` if it still only re-resolves the fake registry;
- delete `AgentRegistry` only after all production resolution is through explicit kind routing;
- route remote/cron/subagent consumers to the manager port, not to concrete runtime internals.

Exit gate:

- unknown agent fails explicitly; backend kind comes from the current descriptor reached through
  `new_sessions.agent_id`, not `new_sessions.session_kind`;
- current routes/events, draft semantics, transfer restrictions and legacy imports pass;
- ACP still follows its old execution path in this phase.

Rollback: keep the façade and restore its delegate factory; no data changes.

### Phase 3 — Module ownership and ACP consolidation (mechanical)

Objective: put existing logic under honest owners without changing execution.

Deliverables:

- consolidate ACP runtime classes from `acpClientPresenter` and `llmProviderPresenter/acp` under one ACP
  domain module;
- move/assign ACP catalog, registry, install, launch-spec, alias, migration, debug, provider-model refresh and
  lifecycle helpers to explicit sub-owners or compatibility boundaries in the same ACP domain;
- make ACP-only `AgentProcessManager`/`AgentSessionManager` names ACP-specific;
- converge `AcpEventMapper` and `AcpContentMapper` on one live mapping implementation;
- keep a thin `AcpAsLlmProviderAdapter` that delegates to the consolidated module; it remains a supported path
  for DeepChat descriptors selecting the ACP provider;
- move `src/main/lib/agentRuntime` files to real owners according to
  [shared-data-and-io.md](./modules/shared-data-and-io.md#8-libagentruntime-的机械归属);
- update imports/tests in the same mechanical PR; do not add re-export compatibility directories;
- preserve composition-root startup and shutdown ordering.

Exit gate:

- import graph contains one ACP module owner and one live event mapper;
- `src/main/lib/agentRuntime` has no remaining source;
- no runtime/request/event diff.

Rollback: file moves/import changes are reversible; persistence remains untouched.

### Phase 4 — DeepChatAgentInstance state ownership

Objective: replace singleton session-keyed maps with lazy per-session instances while keeping the old loop.

Migration order:

1. identity/project/effective generation settings;
2. status/first-turn readiness;
3. generation registration/cancel/abort and stale-run guard;
4. pending input queue/drain/steer state;
5. ordered permission/question/post-call/skill-draft interactions and deferred tool abort;
6. runtime skill activation and prompt/tool caches;
7. compaction state; keep the legacy Memory orchestrator behind a session handle until Phase 9.

Deliverables:

- `DeepChatAgentRuntime.getOrHydrate(sessionId)` and explicit `dispose/evict`;
- one `DeepChatAgentInstance` per active/hydrated session;
- existing `AgentRuntimePresenter` becomes a façade over the instance runtime;
- each migrated state field has exactly one writer and tests no longer access private presenter maps;
- hydration reads current tables lazily; listing sessions does not instantiate full runtime/history;
- destroy/clear/edit/retry invalidation order remains byte/sequence compatible where observable.
- pre-stream AbortController/status remains distinct from the active generation registered after the assistant
  placeholder is created.

Exit gate:

- no migrated state remains duplicated in presenter and instance;
- queue/cancel/stale-run/interaction/restore/destruction tests pass after each state cluster;
- Memory chain/epoch/cooldown/access-dedupe state has not moved or been duplicated in this phase.

Rollback: route through the presenter façade at the previous cluster boundary.

### Phase 5 — Loop shell and ports

Objective: isolate the existing provider round/tool loop without reordering it.

Deliverables:

- define per-turn `LoopRun` state: run id, abort signal, request sequence, current messages, stream state,
  provider recovery flags and selected resources; keep the current external active-generation registration
  point after context and assistant placeholder creation;
- extract current `processStream` algorithm into `DeepChatLoopEngine.run(run, deps)`;
- introduce narrow `ProviderPort`, `ToolCatalogPort`, `ToolExecutionPort`, `TapeRecorder`, `OutputSink` and
  `ContextCoordinator` adapters;
- keep accumulator and echo cadence unchanged;
- keep `ProcessResult` semantics and current finalize/error/abort behavior;
- move current `dispatch` paths behind the ports before splitting their internals.

Exit gate:

- simple, tool, multi-round, max-round, skill-refresh, rate-limit, pause and cancel tests pass through the new
  engine;
- the engine has no presenter root/Electron/route/concrete SQLite import;
- golden Tape/event order is unchanged.

Rollback: old façade invokes the pre-extraction loop function.

### Phase 6 — Fixed lifecycle and explicit collaborators

Objective: replace ad hoc callbacks with fixed typed stages, one seam at a time.

Order:

1. `TapeRecorder` / `OutputSink` commit callbacks;
2. base prompt contributors and cache invalidation before compaction intent preparation;
3. user-fact/compaction coordinator, then summary/reconstruction context contributors; keep the legacy Memory
   callback fixed at its post-compaction slot until Phase 9;
4. tool catalog/executor and result normalization;
5. typed tool-batch interaction outcomes;
6. external hook notification observer adapter.

Rules:

- stage order is a source-level tuple/list, not priority numbers;
- only the typed tool interaction subsystem may produce persistent pause, through pre-check permission,
  question interception, post-call permission or post-success skill-draft confirmation;
- a pause settles the current run; each response processes/persists the first ordered interaction, remains
  paused while more exist, and starts one fresh resume run only after the final item;
- stage await is cancel-aware and required stages have explicit failure policy;
- ViewManifest is synchronously attempted before a provider request but remains fail-open on write failure;
- raw provider events stay on the accumulator hot path;
- `HooksNotificationsService` stays fire-and-forget.

Exit gate:

- narrow lifecycle tests over the new typed seams assert the complete initial/tool/resume causal call/commit
  order without presenter-private-state assertions;
- typed interaction-outcome tests cover pre-check, question, post-call permission and post-success skill draft,
  including multiple ordered interactions, no side-effect replay and final-item-only fresh resume;
- prompt/request drafts are semantically equivalent at every provider request;
- permission deferred-tool continuation and compaction CAS remain unchanged.

Rollback: each collaborator adapter delegates to the legacy method until its slice passes.

### Phase 7 — ACP direct session backend

Objective: stop routing `kind=acp` sessions through DeepChat LoopEngine without removing the DeepChat +
ACP-provider compatibility path.

Progress after `ASLR-073`: production composition selects the typed direct backend only for `kind=acp`.
`kind=deepchat + providerId=acp` remains on the DeepChat LoopEngine and ACP-provider compatibility adapter, so
the switch has no dual-run window. `AgentManager` stays a small descriptor/session router; common lifecycle,
pending input, settings, interaction and generation behavior lives on discriminated handles, while session
state, transcript mutation and Tape access remain separate shared data ports injected into the façade/backend.
Title projection, ACP-backed subagent initialization retry, app/remote/cron dispatch, transfer commit and
permission-by-request-id are covered at their route boundaries. Compatibility-only ACP session control,
permission and admin operations now use explicit ports instead of the generic LLM provider contract. No Memory
behavior is changed here.

Deliverables:

- implement `AcpAgentInstance` over the consolidated process/session/prompt/protocol module;
- introduce that typed instance as an unselected slice first; production `AgentManager` routing does not
  change until `ASLR-072`;
- add an `AcpCompatibilityProjectionAdapter` over the existing message store, Tape facts/ViewManifest and
  renderer event writer; reproduce current create/update/finalize order so restart/search/export remain valid;
- add `AcpRequestTracePort` over existing trace persistence, preserving endpoint/body correlation,
  redaction/truncation, fail-open behavior and its position before `connection.prompt`;
- keep `acp_turns` as protocol metadata only; do not treat it as transcript storage;
- preserve first-system-prompt behavior, workdir sync, load/resume/new, MCP conversion, process cache and
  permission settlement;
- keep `acp_turns.user_message_id=null`, successful provider-finally cancel and fire-and-forget active-session
  metadata persistence; do not infer an `executeCommand` facet from advertised commands;
- preserve regular ACP compatibility prompt/local-resource behavior and ACP subagent isolation until a separate
  behavior spec changes it;
- add `AcpCompatibilityPromptBuilder` so the direct regular backend reproduces the current first system
  message without pretending the ignored `_tools` array is ACP tool delivery;
- switch AgentManager's ACP backend from the legacy wrapper to `AcpAgentInstance`;
- remove ACP-agent-session conditionals and ACP permission continuation from DeepChat instance/loop;
- retain `AcpAsLlmProviderAdapter` for `kind=deepchat + providerId=acp`; provider selection occurs through the
  generic ProviderPort without an ACP-agent routing branch;
- preserve the regular compatibility prompt/local-resource descriptions on that provider path; ACP still
  ignores the DeepChat `_tools` array, while ACP-backed subagents retain their current bypass.

Delivered by `ASLR-070..071` before routing changes:

- direct instance prompt/projection/trace/permission slice plus typed lifecycle, capability, pending-input,
  readiness and snapshot facets;
- one composition-owned `AcpRuntimeOwner` shared by direct and ACP-provider compatibility paths, with explicit
  refresh/shutdown ordering and an irreversible shutdown fence over lazy materialization and in-flight direct
  operations; the process-manager fence starts synchronously, never waits on unresolved spawn work and disposes
  late or replaced handles exactly once by identity;
- one `AcpSessionController` for workdir/open, mode/config/commands, content mapping, capability publication and
  metadata persistence, including restore-attempt isolation and ordered replay of only the successful remote
  session's process updates after session publication;
- production adapters over the current prompt resources, message/Tape/event projection, trace, rate admission,
  hooks, ACP turn/debug persistence and the existing pending-input coordinator;
- one shared ACP rate-limit state with scoped queue cleanup, so provider adapter rebuild/disable/remove keeps
  direct waiters and global QPS ordering intact;
- focused regular/subagent, timeout/cancel/process-exit, prompt-once, queue/steer, workdir/capability,
  provider-lifetime, shutdown-fence/in-flight drain, stuck/late session-open cancellation, fallback-attempt update
  isolation and composition-order fixtures.

Delivered by `ASLR-072` at the atomic routing switch:

- production root composition maps `kind=acp` to `AcpAgentRuntime` and keeps DeepChat descriptors, including
  `providerId=acp`, on `DeepChatAgentRuntime`;
- strict catalog/alias/config/source/command and cached-identity validation fails closed without DeepChat
  fallback; lightweight session-list snapshots do not hydrate the direct runtime;
- `AgentSessionPresenter` no longer resolves ACP through `IAgentImplementation` or compatibility provider
  orchestration; typed handles cover lifecycle, pending/steer, permission, settings, generation, ACP controls,
  transfer and subagent operations;
- direct title generation reads the shared transcript projection and invokes the existing ACP provider
  `summaryTitles` path once; the primary turn is not re-dispatched through the compatibility backend;
- failed ACP subagent initialization gets exactly one retry with a new app-session id after runtime/shared-state
  cleanup; direct ACP -> DeepChat closes the old runtime only after the existing ownership commit, while ACP
  targets are rejected before mutation;
- session deletion uses a descriptor-independent backend cleanup seam: both backend caches are inspected without
  hydrating or launching, direct ACP durable remote bindings are deleted, then shared state, permission, skills and
  the app-session row are removed in the existing order; missing, disabled or malformed agent rows cannot block it;
- route fixtures cover app pending/steer, remote active-generation cancel, Cron send, no-fallback composition and
  direct-before-shared-owner shutdown ordering.

Delivered by `ASLR-073` after the routing switch:

- `ILlmProviderPresenter` and the core presenter contract no longer expose ACP workdir, prepare, mode,
  config, command, permission, debug or cleanup methods;
- DeepChat descriptors selecting `providerId=acp` reach compatibility session control and permission through
  explicit ACP-provider ports, while provider admin routes use a separate admin port;
- the direct `kind=acp` route has zero compatibility-provider session-control calls, while workdir,
  config/commands, permission and clear behavior remain covered on the DeepChat + ACP-provider path;
- unreachable `SessionPresenter` ACP wrappers, prepare/session-mode provider wrappers, legacy ACP backend
  overloads/handles and compatibility implementation aliases are removed;
- architecture and compile-contract guards prevent the retired generic methods and legacy ACP backend symbols
  from returning. DeepChat legacy backend/`IAgentImplementation` retirement remains assigned to `ASLR-090`.

Exit gate:

- `kind=acp` parity matrix passes without invoking DeepChat LoopEngine;
- DeepChat + ACP-provider request/system-prompt/resource fixtures remain equivalent;
- no unresolved ACP permission promise on timeout/cancel/close;
- outer/remote session id mapping and current legacy remote sync behavior remain intact.

Rollback: revert the direct routing and explicit-port slices together; no stored data conversion is needed.

### Phase 8 — Observability convergence over existing stores

Objective: make the resulting loop causally inspectable by joining existing persisted facts without adding a
new event store or Tape entry kind.

Progress after `ASLR-080`: `DeepChatTapeService` exposes one pure-read causal observation slice over the existing
replay DTO, effective Tape view, message row and trace table. It never bootstraps/backfills Tape or publishes an
event. Request correlation is exact by session/message/request sequence; output facts remain explicitly
`message_only`. Historical renderer events are reported as `not_persisted`, and runtime status is current-only
when a caller supplies a non-hydrating peek. `ASLR-081` remains responsible for the full non-interference matrix.

Deliverables:

- inventory which semantic boundaries are already covered by message/tool facts, ViewManifest, trace and
  existing anchors;
- expose/read a causal observation slice using existing session/message/request identifiers and current
  message terminal status plus optional current runtime status;
- report renderer event history as not persisted instead of inferring terminal events;
- preserve metadata-only replay defaults and content-free operational observability;
- prove no new Tape payload, effective-view input or Memory ingestion source was introduced.

Exit gate:

- the persisted causal chain in README is observable from existing Tape/message status/trace data, while the
  historical event gap is explicit;
- no raw token stream or duplicated request body in Tape;
- old sessions remain valid with no backfill requirement;
- any proven need for interaction/terminal Tape facts is recorded as a separate data/behavior SDD.

Rollback: remove the read/observation adapter; no persisted data needs rollback.

### Phase 9 — Memory integration last

Objective: after control plane, both backends, loop lifecycle and Tape boundaries are stable, connect Memory
without changing Memory internals.

Deliverables:

- extract one runtime-scoped `MemoryRuntimeCoordinator` as the sole owner of the current extraction chains,
  epochs, projection retry cooldown and injection-access dedupe maps;
- expose `MemoryPromptContributor` and `MemoryIngestionObserver` ports from that coordinator; instances keep
  only a session handle;
- preserve current queue timing: enqueue captures trigger/epoch and the current compaction upper bound where
  applicable; each serialized task reads the latest cursor/tail and builds its effective Tape window when it
  begins, then treats that built window as immutable;
- preserve the current initial-turn/resume and compaction-attempt asymmetries as characterization behavior,
  including compaction extraction only for initial/context-pressure normal returns and none for resume/manual;
- leave `MemoryPresenter`, schemas, vector store, retrieval, write coordinator and maintenance services
  unchanged;
- preserve shutdown/delete fencing and composition-root order.

Exit gate:

- all invariants in [memory-integration.md](./modules/memory-integration.md) pass;
- narrow tests over `MemoryPromptContributor` / `MemoryIngestionObserver` cover the complete `MEM-13` turn
  outcome matrix and `MEM-14` compaction return/throw matrix without calling presenter-private helpers;
- `pnpm run test:main:memory-perf` and the native CI contract remain at baseline;
- no Memory table/version/config/wire diff.

Rollback: restore the instance's legacy Memory callback adapter; stored data remains valid.

### Phase 10 — Retirement and documentation convergence

Objective: remove transitional surfaces after every backend is stable.

Deliverables:

- remove `IAgentImplementation`, legacy backend adapters and old presenter runtime internals;
- point hot-path ports and remaining consumers at `AgentManager`;
- reduce/retire `AgentSessionPresenter` and `AgentRuntimePresenter` compatibility façades;
- remove ACP-only methods from generic `ILlmProviderPresenter` only when no caller remains; retain the ACP
  stream adapter required by DeepChat descriptors selecting that provider;
- quarantine legacy wire DTO mapping to route/client boundaries;
- update `docs/ARCHITECTURE.md`, `docs/FLOWS.md`, `docs/architecture/agent-system.md`, tool/session docs and
  architecture guards;
- regenerate architecture baseline only after the new graph is final;
- mark all tasks done only after full validation.

Exit gate:

- all acceptance criteria in `spec.md` pass;
- no old path import or parallel active plan remains;
- full formatting, i18n, lint, typecheck, main/renderer tests and smoke suites pass.

## 4. Integration enumeration

每条连接都需要真实实现 integration test；module unit tests 不能替代。

| Connection | Integration proof |
| --- | --- |
| typed chat/session routes -> AgentManager | create/restore/send/stop/interaction route tests |
| AgentManager -> descriptor repository -> backend router | DeepChat/ACP manual/ACP registry/unknown resolution tests |
| AgentManager -> app session shell -> concrete instance | create, lazy hydrate, activate, delete, restart tests |
| DeepChat instance -> LoopEngine | initial/resume/retry/queued turn tests |
| LoopEngine -> ProviderPort | request draft, rate gate, streaming, overflow recovery tests |
| LoopEngine -> Tool ports -> ToolPresenter -> MCP/local tools | collision, source routing, side-effect serialization tests |
| LoopEngine -> prompt/skill adapters -> SkillPresenter | pinned/runtime activation and refresh tests |
| LoopEngine -> ordered tool interactions -> UI response -> final-item fresh resume run | pre/post permission, question, skill draft, multiple/cancel tests |
| LoopEngine -> TapeRecorder/OutputSink -> SQLite/events | golden causal order and replay tests |
| Loop lifecycle -> Memory adapters -> MemoryPresenter | injection/access/extraction/cursor/rewind tests |
| AgentManager -> AcpAgentInstance -> ACP process | new/load/resume/prompt/cancel tests |
| ACP mapping -> existing message/Tape/event projection adapter | restart/search/export + text/tool/plan/config/permission/terminal parity tests |
| subagent orchestrator -> AgentManager -> child backend | DeepChat and ACP target tests + Tape merge/discard |
| remote/cron -> AgentManager | detached run/status/delivery tests |
| app lifecycle -> MCP/Memory/ACP/SQLite shutdown | order, timeout and late-write fencing tests |

## 5. Review and merge discipline

- Phases are dependency-ordered; do not implement Phase 8 ACP switch while Phase 2/3 contracts are unstable.
- Within Phase 4 and Phase 6, only disjoint state/collaborator slices may run in parallel worktrees.
- A verify agent/reviewer checks docs-code parity and real integration paths before each merge.
- Blocking findings are contract mismatch, changed order, duplicate owner, unresolved continuation, stubbed
  integration or missing rollback path.
- Non-blocking style cleanup goes to a separate backlog; it does not expand the current PR.

## 6. Verification strategy

The authoritative matrix is [migration-and-validation.md](./migration-and-validation.md). Minimum per
implementation PR:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck:node
pnpm run test:main -- --run <focused paths>
```

Before each phase completes:

```bash
pnpm run typecheck
pnpm run test:main -- --run
pnpm run test:renderer -- --run
```

Memory-touching phase additionally runs:

```bash
pnpm run test:main:memory-perf
```

Native Memory validation remains a CI gate because local Electron ABI and disposable Node ABI environments are
not interchangeable.
