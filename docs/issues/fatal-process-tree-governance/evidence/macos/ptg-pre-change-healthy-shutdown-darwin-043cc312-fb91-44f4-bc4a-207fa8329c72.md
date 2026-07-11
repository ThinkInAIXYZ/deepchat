# PTG marked-tree harness result

- Run: `043cc312-fb91-44f4-bc4a-207fa8329c72`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T02:40:25.341Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `2aee227418e97c2898c9de8e7dea47e6bb3a163be20ea6d3b183f4a682f84cfc`
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
| owner | 18638 | 18629 | command-line | Sat Jul 11 10:40:25 2026 | absent |
| utility | 18641 | 18638 | process-title | Sat Jul 11 10:40:25 2026 | absent |
| shell | 18642 | 18641 | command-line | Sat Jul 11 10:40:25 2026 | absent |
| grandchild | 18643 | 18642 | command-line | Sat Jul 11 10:40:25 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
