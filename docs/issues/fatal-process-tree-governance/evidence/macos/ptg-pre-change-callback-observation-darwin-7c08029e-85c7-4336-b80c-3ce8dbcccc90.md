# PTG marked-tree harness result

- Run: `7c08029e-85c7-4336-b80c-3ce8dbcccc90`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T02:20:34.857Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `4e5291fa28af9a35c5ad99c7032fc49e577b3d46f85eb337de178b13609a4140`
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
| owner | 85086 | 85077 | command-line | Sat Jul 11 10:20:34 2026 | absent |
| utility | 85089 | 85086 | process-title | Sat Jul 11 10:20:34 2026 | absent |
| shell | 85102 | 85089 | command-line | Sat Jul 11 10:20:35 2026 | match |
| grandchild | 85103 | 85102 | command-line | Sat Jul 11 10:20:35 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
