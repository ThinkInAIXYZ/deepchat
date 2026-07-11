# PTG marked-tree harness result

- Run: `34acb1e8-22a2-4775-87e8-e13b7063e2b5`
- Phase: `pre-change`
- Mode: `owner-loss`
- Started: `2026-07-11T01:56:41.809Z`
- Completed: `2026-07-11T01:56:47.450Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `86c318069dd2cd0b0b7deb2ee3d7ea11044fb1c498e7bbd84f026d4ed6c42b9f`
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
| owner | 41015 | 41006 | command-line | Sat Jul 11 09:56:41 2026 | absent |
| utility | 41018 | 41015 | process-title | Sat Jul 11 09:56:41 2026 | absent |
| shell | 41019 | 41018 | command-line | Sat Jul 11 09:56:42 2026 | match |
| grandchild | 41020 | 41019 | command-line | Sat Jul 11 09:56:42 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
