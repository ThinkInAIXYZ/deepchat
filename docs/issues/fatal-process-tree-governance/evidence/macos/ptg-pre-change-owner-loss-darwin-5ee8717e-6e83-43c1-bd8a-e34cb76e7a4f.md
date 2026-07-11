# PTG marked-tree harness result

- Run: `5ee8717e-6e83-43c1-bd8a-e34cb76e7a4f`
- Phase: `pre-change`
- Mode: `owner-loss`
- Started: `2026-07-11T01:46:04.126Z`
- Completed: `2026-07-11T01:46:10.099Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `a6e29c99acdd24ae7e898e5df15ae845c638a2502fe792be9c5509b0676a92a7`
- Owner exit: code `17`, signal `null`
- Contract satisfied before cleanup: `false`
- Expected owner exit: code `17`, signal `null`
- Utility callbacks: none observed
- Utility callback probes: none registered
- Utility settlements: none observed
- Cleanup left no marked process: `true`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 25147 | 25138 | command-line | Sat Jul 11 09:46:04 2026 | absent |
| utility | 25150 | 25147 | process-title | Sat Jul 11 09:46:04 2026 | absent |
| shell | 25151 | 25150 | command-line | Sat Jul 11 09:46:04 2026 | match |
| grandchild | 25152 | 25151 | command-line | Sat Jul 11 09:46:04 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity.
