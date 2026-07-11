# PTG marked-tree harness result

- Run: `819e4f5f-d8aa-4a08-9e9f-3a17a4c082c0`
- Phase: `pre-change`
- Mode: `owner-loss`
- Started: `2026-07-11T02:40:26.415Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `2aee227418e97c2898c9de8e7dea47e6bb3a163be20ea6d3b183f4a682f84cfc`
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
| owner | 18806 | 18797 | command-line | Sat Jul 11 10:40:26 2026 | absent |
| utility | 18809 | 18806 | process-title | Sat Jul 11 10:40:26 2026 | absent |
| shell | 18810 | 18809 | command-line | Sat Jul 11 10:40:26 2026 | match |
| grandchild | 18811 | 18810 | command-line | Sat Jul 11 10:40:26 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
