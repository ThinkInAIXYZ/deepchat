# Main Kernel Boundary Baseline

Generated on 2026-06-11.
Current phase: P5.

## Metric Snapshot

| Metric | Value |
| --- | --- |
| `renderer.usePresenter.count` | 0 |
| `renderer.business.usePresenter.count` | 0 |
| `renderer.quarantine.usePresenter.count` | 0 |
| `renderer.windowElectron.count` | 0 |
| `renderer.business.windowElectron.count` | 0 |
| `renderer.quarantine.windowElectron.count` | 0 |
| `renderer.windowApi.count` | 0 |
| `renderer.business.windowApi.count` | 0 |
| `renderer.quarantine.windowApi.count` | 0 |
| `renderer.quarantine.sourceFile.count` | 0 |
| `hotpath.presenterEdge.count` | 10 |
| `runtime.rawTimer.count` | 157 |
| `migrated.rawChannel.count` | 4 |
| `bridge.active.count` | 0 |
| `bridge.expired.count` | 0 |

## Renderer Single-Track Split

- Business layer: `src/renderer/src/**`, `src/renderer/settings/**`
- Retired quarantine layer: `src/renderer/api/legacy/**` must remain deleted

| Legacy surface | Business layer | Quarantine layer | Total |
| --- | --- | --- | --- |
| legacy presenter helper | 0 | 0 | 0 |
| `window.electron` | 0 | 0 | 0 |
| `window.api` | 0 | 0 | 0 |

## Quarantine Exit Snapshot

- Retained capability family: none; `renderer legacy transport` is retired
- Source files: 0 / 0
- Delete condition: already satisfied; a recreated quarantine directory is a regression.

- None

## Phase Gates

| Phase | Gate indicator | Current signal | Status |
| --- | --- | --- | --- |
| `P0` | Retired quarantine path `src/renderer/api/legacy/**` must remain deleted and baseline emits business/retired split metrics | `src/renderer/api/legacy/**` deleted; split metrics emitted | ready |
| `P1` | Business layer direct legacy presenter helper / `window.electron` / `window.api` counts must reach `0` | legacyPresenter=0, window.electron=0, window.api=0 | ready |
| `P2` | Business layer `configPresenter` and `llmproviderPresenter` hits must reach `0` | configPresenter=0, llmproviderPresenter=0 | ready |
| `P3` | Business layer window/device/workspace/project/file/browser/tab presenter hits must reach `0` | window=0, device=0, workspace=0, project=0, file=0, browser=0, tab=0 | ready |
| `P4` | Business layer session residual / skill / mcp / sync / upgrade / dialog / tool presenter hits must reach `0` | agentSession=0, skill=0, mcp=0, sync=0, upgrade=0, dialog=0, tool=0 | ready |
| `P5` | Business layer direct legacy access must be `0`, and retired quarantine source files must stay at `0` | businessLegacy=0/0/0, quarantineSourceFiles=0/0 | ready |

## Hot Path Direct Dependencies

- Direct edge count: 10

- `src/main/presenter/agentRuntimePresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/agentSessionPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/index.ts -> src/main/presenter/agentRuntimePresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/llmProviderPresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/sessionPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/sessionPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/sessionPresenter/index.ts -> src/main/presenter/index.ts`

## Renderer legacy presenter helpers

- Total count: 0

- None

## Renderer window.electron

- Total count: 0

- None

## Renderer window.api

- Total count: 0

- None

## Raw Timers

- Total count: 157

- `src/main/presenter/githubCopilotDeviceFlow.ts`: 6
- `src/main/presenter/browser/BrowserTab.ts`: 5
- `src/main/presenter/devicePresenter/index.ts`: 5
- `src/main/presenter/llmProviderPresenter/aiSdk/runtime.ts`: 5
- `src/renderer/src/components/message/MessageToolbar.vue`: 4
- `src/renderer/src/composables/message/useMessageScroll.ts`: 4
- `src/main/lib/agentRuntime/backgroundExecSessionManager.ts`: 3
- `src/main/presenter/configPresenter/acpInitHelper.ts`: 3
- `src/main/presenter/lifecyclePresenter/SplashWindowManager.ts`: 3
- `src/main/presenter/skillPresenter/skillExecutionService.ts`: 3
- `src/main/presenter/tabPresenter.ts`: 3
- `src/main/presenter/upgradePresenter/index.ts`: 3

## Migrated Path Raw Channel Literals

- Total count: 4

- `src/main/presenter/windowPresenter/index.ts`: 4

