# PTG marked-tree harness result

- Run: `a759e653-2c70-4857-b159-3b9886c892f1`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T01:27:54.925Z`
- Completed: `2026-07-11T01:28:00.680Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `c0c9cf353b6b535b4e57bb0202794f3ebd153194f51e5bee33fcc7e19f5b263c`
- Owner exit: code `17`, signal `null`
- Contract satisfied before cleanup: `false`
- Utility callbacks: none observed
- Cleanup left no marked process: `true`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 89968 | 89959 | command-line | Sat Jul 11 09:27:54 2026 | absent |
| utility | 89983 | 89968 | utility-event | Sat Jul 11 09:27:55 2026 | absent |
| shell | 89984 | 89983 | command-line | Sat Jul 11 09:27:55 2026 | match |
| grandchild | 89985 | 89984 | command-line | Sat Jul 11 09:27:55 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity.
