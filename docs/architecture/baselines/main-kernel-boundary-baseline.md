# Main Kernel Boundary Baseline

Generated on 2026-04-20.
Current phase: P5.

## Metric Snapshot

| Metric | Value |
| --- | --- |
| `renderer.usePresenter.count` | 0 |
| `renderer.business.usePresenter.count` | 0 |
| `renderer.quarantine.usePresenter.count` | 0 |
| `renderer.windowElectron.count` | 2 |
| `renderer.business.windowElectron.count` | 0 |
| `renderer.quarantine.windowElectron.count` | 2 |
| `renderer.windowApi.count` | 2 |
| `renderer.business.windowApi.count` | 0 |
| `renderer.quarantine.windowApi.count` | 2 |
| `renderer.quarantine.sourceFile.count` | 3 |
| `hotpath.presenterEdge.count` | 10 |
| `runtime.rawTimer.count` | 122 |
| `migrated.rawChannel.count` | 4 |
| `bridge.active.count` | 0 |
| `bridge.expired.count` | 0 |

## Renderer Single-Track Split

- Business layer: `src/renderer/src/**`
- Quarantine layer: `src/renderer/api/legacy/**`

| Legacy surface | Business layer | Quarantine layer | Total |
| --- | --- | --- | --- |
| `usePresenter()` | 0 | 0 | 0 |
| `window.electron` | 0 | 2 | 2 |
| `window.api` | 0 | 2 | 2 |

## Quarantine Exit Snapshot

- Retained capability family: `renderer legacy transport`
- Source files: 3 / 3
- Delete condition: remove after settings compatibility surfaces stop importing the quarantine adapters.

- `src/renderer/api/legacy/presenterTransport.ts`
- `src/renderer/api/legacy/presenters.ts`
- `src/renderer/api/legacy/runtime.ts`

## Phase Gates

| Phase | Gate indicator | Current signal | Status |
| --- | --- | --- | --- |
| `P0` | Fixed quarantine path `src/renderer/api/legacy/**` exists and baseline emits business/quarantine split metrics | `src/renderer/api/legacy/**` exists; split metrics emitted | ready |
| `P1` | Business layer direct `usePresenter` / `window.electron` / `window.api` counts must reach `0` | usePresenter=0, window.electron=0, window.api=0 | ready |
| `P2` | Business layer `configPresenter` and `llmproviderPresenter` hits must reach `0` | configPresenter=0, llmproviderPresenter=0 | ready |
| `P3` | Business layer window/device/workspace/project/file/browser/tab presenter hits must reach `0` | window=0, device=0, workspace=0, project=0, file=0, browser=0, tab=0 | ready |
| `P4` | Business layer session residual / skill / mcp / sync / upgrade / dialog / tool presenter hits must reach `0` | agentSession=0, skill=0, mcp=0, sync=0, upgrade=0, dialog=0, tool=0 | ready |
| `P5` | Business layer direct legacy access must be `0`, and quarantine source files must satisfy the exit standard (`<= 3` source files) | businessLegacy=0/0/0, quarantineSourceFiles=3/3 | ready |

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

## Renderer usePresenter

- Total count: 0

- None

## Renderer window.electron

- Total count: 2

- `src/renderer/api/legacy/presenterTransport.ts`: 1
- `src/renderer/api/legacy/runtime.ts`: 1

## Renderer window.api

- Total count: 2

- `src/renderer/api/legacy/runtime.ts`: 2

## Raw Timers

- Total count: 122

- `src/main/presenter/githubCopilotDeviceFlow.ts`: 6
- `src/main/presenter/browser/BrowserTab.ts`: 5
- `src/main/presenter/devicePresenter/index.ts`: 5
- `src/renderer/src/components/message/MessageToolbar.vue`: 4
- `src/renderer/src/composables/message/useMessageScroll.ts`: 4
- `src/main/lib/agentRuntime/backgroundExecSessionManager.ts`: 3
- `src/main/presenter/configPresenter/acpInitHelper.ts`: 3
- `src/main/presenter/skillPresenter/skillExecutionService.ts`: 3
- `src/main/presenter/tabPresenter.ts`: 3
- `src/main/presenter/upgradePresenter/index.ts`: 3
- `src/renderer/src/stores/mcp.ts`: 3
- `src/main/lib/agentRuntime/rtkRuntimeService.ts`: 2

## Migrated Path Raw Channel Literals

- Total count: 4

- `src/main/presenter/windowPresenter/index.ts`: 4

