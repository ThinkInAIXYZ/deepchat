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
- protocol permission promises settle on decision, timeout, cancel, clear and shutdown;
- transfer into ACP remains rejected; supported ACP -> DeepChat transfer clears the ACP binding at the current
  commit point;
- regular ACP keeps its current compatibility prompt/local-resource behavior;
- ACP-backed subagent keeps current isolation/bypass/retry behavior;
- remote ACP sync's legacy conversation behavior is not silently unified with `new_sessions`.
- direct `kind=acp` uses the existing structured message/Tape/event writers so restart/search/export remain
  compatible; `acp_turns` remains metadata-only.
- direct `kind=acp` writes the same fail-open `acp://session/prompt` request trace with current
  message/request correlation, redaction/truncation and trace-before-prompt order;
- DeepChat descriptors selecting `providerId=acp` keep the DeepChat outer loop, regular compatibility
  system-prompt/resource descriptions and ACP-as-provider adapter.

### Tape

- user/final/tool facts remain monotonic and idempotent by provenance;
- edit/delete are replacement/retraction facts, not in-place Tape mutation;
- effective view, bootstrap/backfill, anchors, handoff/fork/merge/discard remain compatible;
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
| `MEM-07` | Extraction stays background and per-session serial; sibling sessions may progress independently. Enqueue captures trigger/epoch and the existing compaction upper bound only; the task reads the latest cursor/tail when it starts. |
| `MEM-08` | Cursor advances only after `ok: true`; failed/disabled work cannot consume the range. |
| `MEM-09` | Projection validation/rebuild failure falls back to authoritative Tape without committing cursor and keeps the retry cooldown. |
| `MEM-10` | Edit/delete/retry/pending rollback/clear/destroy invalidate stale epochs and rewind/rebuild at the current boundary. |
| `MEM-11` | Agent delete clears Memory rows/audit transactionally before best-effort vector sidecar cleanup. |
| `MEM-12` | App shutdown aborts and drains Memory before SQLite closes; late writes remain fenced. |
| `MEM-13` | Initial and resume terminal triggers preserve the outcome matrix below; returned abort and thrown AbortError are distinct. |
| `MEM-14` | A non-null compaction intent triggers extraction after any normal `applyCompactionIntent` return, including `succeeded=false`; any throw, including AbortError, triggers nothing. No intent triggers nothing. |

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

| Intent/apply outcome | Enqueue compaction extraction | Upper bound |
| --- | --- | --- |
| no intent | no | none |
| `applyCompactionIntent` returns with `succeeded=true` | yes | intent target cursor |
| `applyCompactionIntent` returns with `succeeded=false` | yes | intent target cursor |
| apply throws AbortError or another error | no | none |

Memory service internals are out of scope. The one runtime-scoped `MemoryRuntimeCoordinator` moves the current
chains/epochs/cooldown/access-dedupe orchestration and exposes prompt/ingestion ports; instances only keep a
session handle.

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

## 6. Test gates by boundary

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
- relevant `test/main/presenter/toolPresenter/agentTools/` tests
- focused lifecycle-order/golden integration fixtures added by Phase 0

Critical existing coverage includes simple/tool/multi-round loop, skill refresh, prompt order, rate limit,
ViewManifest sequence/failure, context overflow recovery, compaction, queue/steer, permission/question resume,
ACP compatibility branches and stale-run cancellation.

### ACP

- `test/main/presenter/acpProvider.test.ts`
- `test/main/presenter/acpSessionManager.test.ts`
- `test/main/presenter/acpMcpPassthrough.test.ts`
- `test/main/presenter/llmProviderPresenter/acp/**`
- `test/main/presenter/sqlitePresenter/acpSessions.test.ts`
- agent-session ACP draft/subagent/transfer tests

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
- `memoryExtraction.test.ts` and `memorySessionExtractionLock.test.ts` for cursor/serialization;
- `sqlitePresenter/deepchatMemoryIngestionProjection.test.ts` for projection/Tape/transaction behavior;
- `pnpm run test:main:memory-perf`;
- the dedicated native Memory CI job.

## 7. Command gates

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

## 8. Rollback policy

- Each slice keeps one active owner; no long-lived dual writers.
- New facades/adapters may delegate backward, so rollback is code-only.
- No phase writes a new mandatory row/payload version before old readers can ignore it.
- This goal writes no new Tape lifecycle entry. Any future interaction/terminal entry requires a separate
  data/behavior SDD and rollback contract.
- A failed phase is reverted before the next dependent phase starts; do not stack work on a red parity gate.
- A discovered behavior defect is recorded separately and the refactor preserves the baseline until that fix is
  approved.

## 9. Final architecture audit

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
