# PTG marked-tree harness result

- Run: `ac0b9aee-4482-4b6c-92a1-f0a87c137093`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T02:08:22.345Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `f5769e9f93eefb216d1544a746f8e658d7f6b20f22a7f682afc9e59de56421c0`
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
| owner | 60639 | 60630 | command-line | Sat Jul 11 10:08:22 2026 | absent |
| utility | 60666 | 60639 | process-title | Sat Jul 11 10:08:22 2026 | absent |
| shell | 60667 | 60666 | command-line | Sat Jul 11 10:08:22 2026 | absent |
| grandchild | 60668 | 60667 | command-line | Sat Jul 11 10:08:22 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
