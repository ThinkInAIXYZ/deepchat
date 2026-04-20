# Main Kernel Migration Scoreboard

Generated on 2026-04-20.
Current phase: P5.

Phase 0 establishes the comparison baseline. Later phases should update this report and compare against this checkpoint.

| Metric | Value | Status |
| --- | --- | --- |
| `renderer.usePresenter.count` | 86 | baseline |
| `renderer.business.usePresenter.count` | 86 | baseline |
| `renderer.quarantine.usePresenter.count` | 0 | baseline |
| `renderer.windowElectron.count` | 95 | baseline |
| `renderer.business.windowElectron.count` | 95 | baseline |
| `renderer.quarantine.windowElectron.count` | 0 | baseline |
| `renderer.windowApi.count` | 33 | baseline |
| `renderer.business.windowApi.count` | 33 | baseline |
| `renderer.quarantine.windowApi.count` | 0 | baseline |
| `hotpath.presenterEdge.count` | 10 | baseline |
| `runtime.rawTimer.count` | 123 | baseline |
| `migrated.rawChannel.count` | 5 | baseline |
| `bridge.active.count` | 0 | baseline |
| `bridge.expired.count` | 0 | baseline |

## Phase Gate Status

| Phase | Status | Current signal |
| --- | --- | --- |
| `P0` | ready | `src/renderer/api/legacy/**` exists; split metrics emitted |
| `P1` | pending | usePresenter=86, window.electron=95, window.api=33 |
| `P2` | pending | configPresenter=26, llmproviderPresenter=4 |
| `P3` | pending | window=9, device=8, workspace=5, project=2, file=2, browser=2, tab=2 |
| `P4` | pending | agentSession=13, skill=4, mcp=2, sync=1, upgrade=1, dialog=1, tool=1 |
| `P5` | pending | businessLegacy=86/95/33, quarantineSourceFiles=0 |

