# PTG marked-tree harness result

- Run: `4093fa8a-6616-443c-80ab-289c487908e9`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T02:40:32.265Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `2aee227418e97c2898c9de8e7dea47e6bb3a163be20ea6d3b183f4a682f84cfc`
- Owner exit: code `17`, signal `null`
- Contract satisfied before cleanup: `false`
- Expected owner exit: code `17`, signal `null`
- Utility callbacks: none observed
- Utility callback probes: parentPort.close (registered: true, documented: false), parentPort.disconnect (registered: true, documented: false), parentPort.exit (registered: true, documented: false), parentPort.error (registered: true, documented: false), process.disconnect (registered: true, documented: true), process.beforeExit (registered: true, documented: true), process.exit (registered: true, documented: true), process.SIGTERM (registered: true, documented: true), process.SIGHUP (registered: true, documented: true), process.SIGINT (registered: true, documented: true)
- Utility settlements: none observed
- Cleanup left no marked process: `true`
- Manual cleanup required: `false`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 19133 | 19124 | command-line | Sat Jul 11 10:40:32 2026 | absent |
| utility | 19136 | 19133 | process-title | Sat Jul 11 10:40:32 2026 | absent |
| shell | 19137 | 19136 | command-line | Sat Jul 11 10:40:32 2026 | match |
| grandchild | 19138 | 19137 | command-line | Sat Jul 11 10:40:32 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
