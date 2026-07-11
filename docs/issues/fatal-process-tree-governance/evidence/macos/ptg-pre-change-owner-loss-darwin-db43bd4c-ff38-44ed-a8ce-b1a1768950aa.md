# PTG marked-tree harness result

- Run: `db43bd4c-ff38-44ed-a8ce-b1a1768950aa`
- Phase: `pre-change`
- Mode: `owner-loss`
- Started: `2026-07-11T02:32:14.888Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `15f2d20f906a9ffe907766ed7eb8c8efd4cad5374c4bf10a216dd0d2b13f55a9`
- Owner exit: code `17`, signal `null`
- Contract satisfied before cleanup: `false`
- Expected owner exit: code `17`, signal `null`
- Utility callbacks: none observed
- Utility callback probes: none registered
- Utility settlements: none observed
- Cleanup left no marked process: `true`
- Manual cleanup required: `false`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 6239 | 6230 | command-line | Sat Jul 11 10:32:14 2026 | absent |
| utility | 6266 | 6239 | process-title | Sat Jul 11 10:32:15 2026 | absent |
| shell | 6268 | 6266 | command-line | Sat Jul 11 10:32:15 2026 | match |
| grandchild | 6269 | 6268 | command-line | Sat Jul 11 10:32:15 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
