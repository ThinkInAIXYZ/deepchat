# Configurable Agent Output Limits Implementation Plan

## Status

Implemented and verified on `codex/configurable-agent-output-limits` against `dev`.

## Engineering Context

### Target

- User-visible behavior: configure three effective output limits per DeepChat Agent.
- Current renderer: `DeepChatAgentsSettings.vue`.
- Logical owner: the existing `DeepChatAgentConfig` form and config JSON.
- Trigger path: Agent editor save -> typed config route -> Agent repository -> session Agent lookup ->
  read/command/tool-result runtime.
- Existing patterns: auto-compaction numeric settings, Agent config diff patches, session identity,
  tool-output offload stubs, and context preflight batch fitting.

### Context map

- Vue owner chain: Settings route -> `DeepChatAgentsSettings` -> existing Agent form controls.
- State source: persisted `DeepChatAgentConfig`.
- Derived state: normalized numeric form values and resolved runtime defaults.
- Events: normal form input and save; no new watcher or global store event.
- Side effects: Agent config persistence and later tool output file writes.
- Layout: one collapsed subsection inside the existing Tools card.
- Accessibility: labeled native number inputs, semantic trigger, keyboard access, and descriptions.
- Electron boundary: existing typed config client and route contracts.
- Main-process sensitivity: no synchronous work is added to high-frequency renderer paths; config is
  resolved once per relevant tool operation.

### Diagnosis

- Root cause: user-visible limits are split across fixed constants in three runtime owners.
- Correct ownership: store policy on the Agent, normalize it in shared code, and inject only the
  relevant value into each existing runtime owner.
- Constraint: command disk spooling and model context fitting are safety mechanisms and must not be
  weakened by a large user value.
- Existing pattern to reuse: optional Agent config fields with renderer normalization and typed
  route validation.

### Decision

- Add three flat optional fields to `DeepChatAgentConfig`; do not add a nested settings object or
  migration.
- Add one small shared normalization module because renderer, tool manager, and output guard need
  the same defaults and bounds.
- Resolve per-session Agent values at tool-call time so existing sessions observe saved changes.
- Keep internal spooling capped at 10,000 characters and lower it only when the Agent preview is
  lower.
- Remove `exec` from generic threshold offloading; use context fallback to reuse its generated log.
- Keep a focused contract test at each ownership boundary and remove temporary white-box probes.

## Implementation Slices

### 1. Shared contract

- Add config fields and strict integer bounds to the shared types and route schema.
- Add defaults, bounds, and a pure `resolveAgentOutputLimits` helper.
- Cover defaults and defensive normalization with a focused shared-unit test.

### 2. Runtime consumption

- Resolve the active session's Agent output limits in `AgentToolManager`.
- Supply the read limit to raw-text and prepared-document pagination.
- Supply the command limit to `AgentBashHandler` and `SkillExecutionService`.
- Allow the background execution manager to use a per-session offload threshold and foreground
  completion preview, bounded by its fixed internal ceiling.
- Preserve the session preview for background completion and resolve the current Agent command
  limit for explicit `process` polls.
- Supply a per-session generic limit resolver to `ToolOutputGuard`.
- On context overflow, offload eligible inline results before downgrading them; reuse generated
  command logs when present.
- Fit deferred results against the effective model context budget, propagate cancellation, verify
  turn ownership before persistence, and clean only guard-owned fallback files.
- Preserve all three optional fields in the production repository merge path.

### 3. Renderer

- Add the collapsed advanced-output section under Tools.
- Extend form initialization, dirty-state diffing, load, save, reset, and numeric normalization.
- Add locale keys with native copy to every settings locale.

### 4. Regression coverage and cleanup

- Preserve tests for default and custom file-read behavior.
- Preserve tests for generic tool threshold resolution and context fallback path reuse.
- Preserve tests for command preview/spooling behavior and Agent form persistence.
- Delete any temporary tests that only expose internal helper call order or duplicate an observable
  contract.

## Verification

Run the smallest relevant suites while implementing, then run the repository handoff checks:

```text
pnpm exec vitest run --config vitest.config.ts --reporter=dot --silent=passed-only \
  test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts \
  test/main/agent/deepchat/deepChatAgentRepository.test.ts \
  test/main/agent/deepchat/runtime/dispatch.test.ts \
  test/main/agent/deepchat/runtime/process.test.ts \
  test/main/agent/deepchat/runtime/toolAdapters.test.ts \
  test/main/agent/deepchat/runtime/toolOutputGuard.test.ts \
  test/main/agent/shared/process/backgroundExecSessionManager.test.ts \
  test/main/shared/agentOutputLimits.test.ts \
  test/main/skill/skillExecutionService.test.ts \
  test/main/tool/agentTools/agentBashHandler.test.ts \
  test/main/tool/agentTools/agentToolManagerRead.test.ts
pnpm exec vitest run --config vitest.config.renderer.ts --reporter=dot --silent=passed-only \
  test/renderer/components/DeepChatAgentsSettings.test.ts
pnpm format
pnpm i18n
pnpm lint
pnpm typecheck
```

The main suite passed 572 tests across 11 files. The renderer suite passed 27 tests. Final diff
inspection found no generated or temporary artifacts.
