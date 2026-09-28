# ACP Lody Extension Delivery

Contract: [spec.md](./spec.md). Branch: `codex/acp-lody-extensions`. PR target: `dev`.
The direct ACP consumer owns interaction and projection; the external agent owns execution.

## Implementation

- [x] Pin SDK 1.4.0 and Core 0.1.9; replace private SDK imports with public typed APIs.
- [x] Negotiate each capability independently; scope callbacks, host tools and protocol requests to
      the actual connection; preserve ordinary ACP and ACP-provider compatibility.
- [x] Implement ephemeral session/request elicitation, typed IPC, question dock/global dialog,
      single/multiple selection, notes, custom answers, previews, private values, URL consent,
      validation, cancellation, deadlines and reload hydration.
- [x] Preserve legacy plans and add keyed items/markdown/file plans; expose context, titles,
      message phase, notices, activity, canonical tool names and existing boolean configuration.
- [x] Persist cumulative model/scope usage with replay deduplication, unknown costs, reconnect
      uncertainty and inherited fork baseline; display quota windows and wallet details.
- [x] Isolate remote child streams; preserve task/run ancestry, support flags, bounded tails and
      disconnect state; use only observed fresh task IDs for list/output/cancel.
- [x] Implement native request/same/active steering with durable accepted/applied/failed/unknown
      receipts and no automatic replay; keep ordinary ACP handoff behavior.
- [x] Keep goal set/resume inside the local prompt lifecycle and pause/clear on control transport.
- [x] Stage idle history without side effects/accounting, atomically import verified complete
      snapshots, and fork from a verified source anchor using target-history IDs.
- [x] Persist recoverable fork outcomes; bound RPC/replay; inherit source MCP/cwd and negotiated
      trusted project metadata without changing workspace permissions.
- [x] Review connection cleanup, ownership, persistence races, IPC serialization, private answer
      handling, unknown versions and malformed payloads; update maintained architecture docs.
- [x] Remove the model-using temporary probe; retain bounded protocol and UI regression tests.
- [x] Keep normal build-generated ACP registry refreshes. Provider refresh used its existing
      snapshot when the upstream fetch failed.

## Validation

- [x] Format and format check, including explicit formatting of changed nested runtime files that
      the repository's default `runtime` ignore pattern excludes.
- [x] i18n validation: 23 locales, 483 namespaces, 4,732 source message contracts; no missing or
      invalid translations. Added copy is English by default with Simplified/Traditional Chinese.
- [x] Lint, agent cleanup guard, alert-dialog contract guard, node/web typecheck.
- [x] Main regression: 77 files / 1,531 tests covering ACP runtime/provider/contracts, session
      persistence/lifecycle, route dispatch and the native agent harness.
- [x] Renderer regression: 10 files / 262 tests covering questions, chat page/status, receipts,
      message blocks, MCP elicitation and plan/interaction stores.
- [x] Full application/CLI build and final Electron bundle build.
- [x] Electron E2E: ACP settings plus a local stdio extension peer. Real transport/IPC submits
      single/multiple answers, redacts a private echo, continues the original prompt, displays
      context/usage/plans, and keeps child output separate. Form/status screenshots inspected.
- [x] Production consumers against DimCode 0.5.12: structured question request accepted;
      request steering confirmed applied; quota/task queries; complete history replay without
      accounting changes; remote fork with rewritten target anchors and zero incremental usage;
      bounded goal set/pause/clear. Temporary sessions/processes from the successful probe closed.
- [x] Import regression: same snapshot idempotent, existing different transcript rejected,
      target anchors retained, no usage entries created.
- [x] Recovery regression: unknown native steering is not replayed after restart; a remotely
      created fork is reused after local persistence failure.

DimCode evidence (2026-09-28): one structured request, 4 source history entries, 4 target entries,
`steeringStatus=applied`, `goalSetPauseAndClear=true`, all incremental fork token counters zero.
The latest subagent event protocol is covered by deterministic SDK/controller/Electron fixtures;
DimCode 0.5.12 does not advertise it.

## Intentional capability gates

| Capability | Gate |
| --- | --- |
| Prompt-transport steering | Uses existing handoff until concurrent prompt/output attribution is verified for that adapter |
| History import and anchored remote fork | Enabled for wire-verified DimCode 0.5.12; other history producers get read-only preview |
| Child controls | Agent capability plus fresh real taskId and linked run support; runId alone is read-only |
| worktreeProject | Only an already-known trusted project relationship is transmitted |

Unobserved real-agent scenarios are not reported as validated: latest subagent events, actual
scheduled/background task production, nonempty provider quotas, compaction/retry, plan_mode,
worktreeProject, and prompt-transport steering. No remote process is impersonated by a local loop.

## Delivery

Draft PR targeting `dev`, with BEFORE/AFTER ASCII, validation evidence and the capability gates above.
No merge or release is part of this task.
