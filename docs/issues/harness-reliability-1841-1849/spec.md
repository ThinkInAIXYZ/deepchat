# Harness Reliability Issues 1841-1849 — Spec

## User Need

DeepChat should stay responsive and testable in long agent sessions. The current issues point to
the same product risk: slow chat rendering, blocking main-process work, noisy tests, and
background polling make the agent harness harder to trust.

## Goal

Address issues #1841-#1849 with the smallest production changes that improve correctness and
performance signal without broad rewrites.

## Acceptance Criteria

- #1843: stable main and renderer test drift is corrected:
  - MCP install deeplinks test the current chat-window route.
  - hidden settings plugin sidebar expectations match the plugins hub behavior.
  - renderer mocks satisfy current `useSkillsData` and router contracts.
- #1849/#1847: the mock-only performance test is removed and replaced by a minimal production-path
  performance signal with realistic message fixtures.
- #1841: long loaded chat histories do not mount every loaded message row; visible DOM is bounded
  by the active scroll window plus overscan.
- #1844: chat search no longer clears and rewrites highlights across the whole loaded history on
  each message update; highlighting is scoped to rendered rows while match counting stays
  data-driven.
- #1842: agent skill read paths remain async and cached; no new synchronous hot-path skill IO is
  introduced.
- #1846: remote status polling is not a fixed always-on 2s workload when windows are hidden or no
  remote channel is enabled.
- #1845: backup archive compression/extraction is moved off synchronous zip/unzip calls and uses
  async file IO where it handles large backup payloads.
- #1848: the refactor issue is converted into a concrete split plan/state map without performing a
  risky multi-thousand-line move in the same performance/test fix.

## Constraints

- Preserve existing presenter, IPC, and renderer API contracts.
- Keep UI strings in existing i18n paths; do not add visible copy unless required.
- Avoid new dependencies. Use existing Vue, Pinia, Electron, and `fflate` APIs.
- Keep mutation paths that rely on single-thread sequencing stable unless the change is clearly
  safe.
- Do not add broad fallback behavior that hides real failures.

## Non-Goals

- Full dynamic-height virtual scrolling.
- Complete `agentRuntimePresenter` or `routes/index.ts` extraction.
- New remote event subscription IPC.
- Redesigning backup restore UX beyond making the heavy zip path async.

## Open Questions

None for this pass. #1848 full extraction remains a separate architecture task by design.
