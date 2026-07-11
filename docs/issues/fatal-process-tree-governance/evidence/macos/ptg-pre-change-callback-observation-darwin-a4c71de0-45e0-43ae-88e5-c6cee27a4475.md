# PTG marked-tree harness result

- Run: `a4c71de0-45e0-43ae-88e5-c6cee27a4475`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T02:32:21.281Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `15f2d20f906a9ffe907766ed7eb8c8efd4cad5374c4bf10a216dd0d2b13f55a9`
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
| owner | 6557 | 6548 | command-line | Sat Jul 11 10:32:21 2026 | absent |
| utility | 6572 | 6557 | process-title | Sat Jul 11 10:32:21 2026 | absent |
| shell | 6573 | 6572 | command-line | Sat Jul 11 10:32:21 2026 | match |
| grandchild | 6574 | 6573 | command-line | Sat Jul 11 10:32:21 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
