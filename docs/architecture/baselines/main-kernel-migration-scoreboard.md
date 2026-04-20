# Main Kernel Migration Scoreboard

Generated on 2026-04-20.
Current phase: P5.

Phase 0 establishes the comparison baseline. Later phases should update this report and compare against this checkpoint.

| Metric | Value | Status |
| --- | --- | --- |
| `renderer.usePresenter.count` | 17 | baseline |
| `renderer.business.usePresenter.count` | 0 | baseline |
| `renderer.quarantine.usePresenter.count` | 17 | baseline |
| `renderer.windowElectron.count` | 2 | baseline |
| `renderer.business.windowElectron.count` | 0 | baseline |
| `renderer.quarantine.windowElectron.count` | 2 | baseline |
| `renderer.windowApi.count` | 2 | baseline |
| `renderer.business.windowApi.count` | 0 | baseline |
| `renderer.quarantine.windowApi.count` | 2 | baseline |
| `renderer.quarantine.sourceFile.count` | 3 | baseline |
| `hotpath.presenterEdge.count` | 10 | baseline |
| `runtime.rawTimer.count` | 122 | baseline |
| `migrated.rawChannel.count` | 4 | baseline |
| `bridge.active.count` | 0 | baseline |
| `bridge.expired.count` | 0 | baseline |

## Phase Gate Status

| Phase | Status | Current signal |
| --- | --- | --- |
| `P0` | ready | `src/renderer/api/legacy/**` exists; split metrics emitted |
| `P1` | ready | legacyPresenter=0, window.electron=0, window.api=0 |
| `P2` | ready | configPresenter=0, llmproviderPresenter=0 |
| `P3` | ready | window=0, device=0, workspace=0, project=0, file=0, browser=0, tab=0 |
| `P4` | ready | agentSession=0, skill=0, mcp=0, sync=0, upgrade=0, dialog=0, tool=0 |
| `P5` | ready | businessLegacy=0/0/0, quarantineSourceFiles=3/3 |

