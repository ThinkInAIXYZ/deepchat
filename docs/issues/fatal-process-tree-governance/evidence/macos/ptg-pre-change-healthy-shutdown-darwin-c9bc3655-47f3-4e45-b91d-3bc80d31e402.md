# PTG marked-tree harness result

- Run: `c9bc3655-47f3-4e45-b91d-3bc80d31e402`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T01:28:00.992Z`
- Completed: `2026-07-11T01:28:01.981Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `c0c9cf353b6b535b4e57bb0202794f3ebd153194f51e5bee33fcc7e19f5b263c`
- Owner exit: code `0`, signal `null`
- Contract satisfied before cleanup: `true`
- Utility callbacks: none observed
- Cleanup left no marked process: `true`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 90207 | 90198 | command-line | Sat Jul 11 09:28:01 2026 | absent |
| utility | 90212 | 90207 | utility-event | Sat Jul 11 09:28:01 2026 | absent |
| shell | 90213 | 90212 | command-line | Sat Jul 11 09:28:01 2026 | absent |
| grandchild | 90214 | 90213 | command-line | Sat Jul 11 09:28:01 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity.
