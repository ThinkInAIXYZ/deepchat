# Main Kernel Boundary Baseline

Generated on 2026-07-29.
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
| `hotpath.directEdge.count` | 2 |
| `runtime.rawTimer.count` | 209 |
| `migrated.rawChannel.count` | 0 |
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
| `P2` | Business layer `configPresenter` and `providerRuntime` hits must reach `0` | configPresenter=0, providerRuntime=0 | ready |
| `P3` | Business layer window/device/workspace/project/file/browser/tab presenter hits must reach `0` | window=0, device=0, workspace=0, project=0, file=0, browser=0, tab=0 | ready |
| `P4` | Business layer session residual / skill / mcp / sync / upgrade / dialog / tool presenter hits must reach `0` | agentSession=0, skill=0, mcp=0, sync=0, upgrade=0, dialog=0, tool=0 | ready |
| `P5` | Business layer direct legacy access must be `0`, and retired quarantine source files must stay at `0` | businessLegacy=0/0/0, quarantineSourceFiles=0/0 | ready |

## Hot Path Direct Dependencies

- Direct edge count: 2

- `src/main/app/composition.ts -> src/main/provider/index.ts`
- `src/main/app/composition.ts -> src/main/routes/index.ts`

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

- Total count: 209

- `src/main/ocr/lightOcrProcessHost.ts`: 10
- `src/main/provider/auth/githubCopilotDeviceFlow.ts`: 6
- `src/main/desktop/browser/BrowserTab.ts`: 5
- `src/main/provider/aiSdk/runtime.ts`: 5
- `src/main/remote/index.ts`: 5
- `src/main/memory/infra/vectorStoreManager.ts`: 4
- `src/main/memory/services/maintenanceService.ts`: 4
- `src/main/agent/acp/launch/acpInitHelper.ts`: 3
- `src/main/agent/shared/process/backgroundExecSessionManager.ts`: 3
- `src/main/app/splashWindow.ts`: 3
- `src/main/desktop/window/index.ts`: 3
- `src/main/platform/fileWatcher/watcherHost.ts`: 3

## Migrated Path Raw Channel Literals

- Total count: 0

- None
