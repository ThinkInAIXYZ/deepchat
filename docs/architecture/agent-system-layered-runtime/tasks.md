# Agent System Layered Runtime — Tasks

> 状态：implementation in progress。
> 每个 task 是最小可独立验证的 delivery slice。任务只在依赖全部完成后进入 `ready`。

## Documentation baseline

- [x] `ASLR-000` Audit current manager/session/loop/ACP/Tape/Memory ownership.
- [x] `ASLR-001` Write master before/after architecture and locked decisions.
- [x] `ASLR-002` Write module contracts, migration plan and validation gates.
- [x] `ASLR-003` Map existing compatibility coverage, add only stable-seam high-value
  characterization gaps, and capture the machine-readable architecture baseline. Temporary
  parity/import/private-shape tests and generated audit reports must be removed after validation.

## Control plane and contracts

- [x] `ASLR-010` Add internal kind/source descriptors, tolerant catalog codec, strict executable codec and route compatibility mapper.
  Depends on: `ASLR-003`.
- [ ] `ASLR-011` Split shared agent row codec, DeepChat repository and ACP repository without schema change.
  Depends on: `ASLR-010`.
- [ ] `ASLR-012` Separate generic catalog notifications from ACP process refresh.
  Depends on: `ASLR-011`.
- [ ] `ASLR-013` Introduce explicit app-session and ACP-remote-session id types at internal boundaries.
  Depends on: `ASLR-010`.

## AgentManager and existing session façade

- [ ] `ASLR-020` Create `AgentManager` catalog lookup and explicit kind router with legacy backends.
  Depends on: `ASLR-011`, `ASLR-013`.
- [ ] `ASLR-021` Add a thin existing app-session data port for CRUD/binding/list; do not split services by noun.
  Depends on: `ASLR-020`.
- [ ] `ASLR-022` Route common send/cancel/close/snapshot calls through typed legacy backend handles and preserve `MessageStartResult`.
  Depends on: `ASLR-021`.
- [ ] `ASLR-023` Replace transfer/subagent optional-method routing in place with required kind facets.
  Depends on: `ASLR-021`.
- [ ] `ASLR-024` Keep title/export/search/usage/backfill/import in the façade and remove their fake-registry re-resolution only.
  Depends on: `ASLR-021`.
- [ ] `ASLR-025` Route remote/cron/hot-path consumers through AgentManager ports.
  Depends on: `ASLR-022`, `ASLR-023`.
- [ ] `ASLR-026` Remove fake AgentRegistry/NewMessageManager production resolution.
  Depends on: `ASLR-020`, `ASLR-025`.

## Mechanical ownership cleanup

- [ ] `ASLR-030` Consolidate ACP process/session/persistence/protocol classes under one module owner.
  Depends on: `ASLR-020`.
- [ ] `ASLR-031` Converge ACP live event/content mappers and retain one compatibility provider adapter.
  Depends on: `ASLR-030`.
- [ ] `ASLR-034` Assign ACP catalog/install/launch/alias/migration/debug/model-refresh/lifecycle paths to explicit ACP domain owners or boundary adapters.
  Depends on: `ASLR-030`.
- [ ] `ASLR-032` Move process/shell/search/question/path/prompt utilities out of `lib/agentRuntime`.
  Depends on: `ASLR-021`; may be split by disjoint owner.
- [ ] `ASLR-033` Verify composition startup/shutdown order after mechanical moves.
  Depends on: `ASLR-030`, `ASLR-032`.

## DeepChat instance ownership

- [ ] `ASLR-040` Add lazy `DeepChatAgentRuntime.getOrHydrate()` and instance façade.
  Depends on: `ASLR-020`, `ASLR-021`.
- [ ] `ASLR-041` Move identity/project/effective settings and status/readiness state.
  Depends on: `ASLR-040`.
- [ ] `ASLR-042` Move generation/cancel/abort/stale-run state.
  Depends on: `ASLR-041`.
- [ ] `ASLR-043` Move pending input/queue/drain/steer state.
  Depends on: `ASLR-042`.
- [ ] `ASLR-044` Move ordered interaction queue and deferred-tool cancellation state; create a fresh run only after the final item.
  Depends on: `ASLR-042`.
- [ ] `ASLR-045` Move runtime skills and prompt/tool cache ownership.
  Depends on: `ASLR-041`.
- [ ] `ASLR-046` Move compaction state and keep the legacy Memory orchestrator behind a session handle without moving its maps.
  Depends on: `ASLR-043`, `ASLR-044`.

## Loop engine and lifecycle

- [ ] `ASLR-050` Define per-turn `LoopRun`, preserve the late active-generation registration point, and add narrow provider/tool/output/Tape/context ports.
  Depends on: `ASLR-042`, `ASLR-045`.
- [ ] `ASLR-051` Extract current provider round/tool loop into `DeepChatLoopEngine`.
  Depends on: `ASLR-050`.
- [ ] `ASLR-052` Move existing Tape/message/output commits into the fixed lifecycle without adding entry kinds.
  Depends on: `ASLR-051`.
- [ ] `ASLR-053` Move base prompt contributors before compaction and summary/reconstruction after compaction; keep the legacy Memory call fixed in its post-compaction slot.
  Depends on: `ASLR-052`.
- [ ] `ASLR-054` Move context/preflight/compaction coordinator.
  Depends on: `ASLR-053`.
- [ ] `ASLR-055` Move tool catalog/execution/result normalization adapters.
  Depends on: `ASLR-054`.
- [ ] `ASLR-056` Move pre-check, question, post-call permission and skill-draft outcomes into an
  ordered batch; add narrow typed-outcome ordering/no-replay/final-item-resume contracts;
  intermediate responses stay paused.
  Depends on: `ASLR-055`, `ASLR-044`.
- [ ] `ASLR-057` Adapt external hook notifications as non-blocking observers.
  Depends on: `ASLR-052`.

## ACP direct backend

- [ ] `ASLR-070` Implement `AcpAgentInstance`, regular/subagent prompt builder, existing message/Tape/event adapter and request trace port.
  Depends on: `ASLR-031`, `ASLR-034`, `ASLR-022`, `ASLR-052`.
- [ ] `ASLR-071` Reach parity for regular ACP and ACP-backed subagent paths.
  Depends on: `ASLR-070`.
- [ ] `ASLR-072` Switch only `kind=acp` routing with message/Tape/event/trace parity, retaining DeepChat + ACP-provider compatibility.
  Depends on: `ASLR-071`.
- [ ] `ASLR-073` Remove migrated ACP runtime methods from generic LLM provider contracts.
  Depends on: `ASLR-072`.

## Observability over existing stores

- [ ] `ASLR-080` Build the causal observation slice from existing Tape/message/status/event/trace data with no new writes.
  Depends on: `ASLR-052`, `ASLR-056`.
- [ ] `ASLR-081` Prove the observation adapter does not affect effective view, replay privacy or Memory ingestion.
  Depends on: `ASLR-080`.

## Memory integration last

- [ ] `ASLR-059` Extract the sole `MemoryRuntimeCoordinator` owner for chains/epochs/cooldown/access dedupe; instances keep session handles.
  Depends on: `ASLR-046`, `ASLR-054`, `ASLR-072`, `ASLR-081`.
- [ ] `ASLR-060` Add `MemoryPromptContributor` with injection/access/view-anchor parity.
  Depends on: `ASLR-053`, `ASLR-054`, `ASLR-059`.
- [ ] `ASLR-061` Add `MemoryIngestionObserver` with extraction/projection/cursor parity and narrow
  `MEM-13` / `MEM-14` outcome contracts.
  Depends on: `ASLR-059`, `ASLR-060`.
- [ ] `ASLR-062` Run Memory correctness/privacy/performance/native gates and prove no schema/config diff.
  Depends on: `ASLR-061`.

## Retirement

- [ ] `ASLR-090` Remove `IAgentImplementation`, legacy backends and old runtime façade internals.
  Depends on: `ASLR-062`, `ASLR-073`, `ASLR-081`.
- [ ] `ASLR-091` Update current architecture/flow/tool/session docs and architecture guards.
  Depends on: `ASLR-090`.
- [ ] `ASLR-092` Run full validation, regenerate final architecture baseline and close the goal.
  Depends on: `ASLR-091`.

## Task file rule for implementation

When implementation starts, each task should be copied into the repository's active delivery mechanism with:

```yaml
id: ASLR-xxx
status: pending | ready | in-progress | done | blocked
depends-on: [ASLR-yyy]
```

Each task must name exact code/doc paths and focused verification. Do not mark a task done solely because code
moved; its integration connection and rollback condition must also pass.
