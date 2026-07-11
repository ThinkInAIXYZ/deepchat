# PTG marked-tree harness result

- Run: `b3338007-9264-477f-ad1a-36579e373bd9`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T01:56:40.743Z`
- Completed: `2026-07-11T01:56:41.571Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `86c318069dd2cd0b0b7deb2ee3d7ea11044fb1c498e7bbd84f026d4ed6c42b9f`
- Owner exit: code `0`, signal `null`
- Contract satisfied before cleanup: `true`
- Expected owner exit: code `0`, signal `null`
- Utility callbacks: none observed
- Utility callback probes: none registered
- Utility settlements: shell-close:0:null / code 0 / count 1
- Cleanup left no marked process: `true`
- Manual cleanup required: `false`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 40799 | 40778 | command-line | Sat Jul 11 09:56:40 2026 | absent |
| utility | 40802 | 40799 | process-title | Sat Jul 11 09:56:40 2026 | absent |
| shell | 40803 | 40802 | command-line | Sat Jul 11 09:56:40 2026 | absent |
| grandchild | 40804 | 40803 | command-line | Sat Jul 11 09:56:40 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
