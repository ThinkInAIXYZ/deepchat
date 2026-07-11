# PTG marked-tree harness result

- Run: `6b192c34-6589-427a-8a10-e9a41aa56860`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T01:46:02.550Z`
- Completed: `2026-07-11T01:46:03.682Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `a6e29c99acdd24ae7e898e5df15ae845c638a2502fe792be9c5509b0676a92a7`
- Owner exit: code `0`, signal `null`
- Contract satisfied before cleanup: `true`
- Expected owner exit: code `0`, signal `null`
- Utility callbacks: none observed
- Utility callback probes: none registered
- Utility settlements: shell-close:0:null / code 0 / count 1
- Cleanup left no marked process: `true`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 24951 | 24931 | command-line | Sat Jul 11 09:46:02 2026 | absent |
| utility | 24954 | 24951 | process-title | Sat Jul 11 09:46:02 2026 | absent |
| shell | 24967 | 24954 | command-line | Sat Jul 11 09:46:02 2026 | absent |
| grandchild | 24968 | 24967 | command-line | Sat Jul 11 09:46:02 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity.
