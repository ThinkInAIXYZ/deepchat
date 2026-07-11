# PTG marked-tree harness result

- Run: `ec261a44-9056-46fd-9a5c-aef4ed5d21de`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T01:46:10.412Z`
- Completed: `2026-07-11T01:46:16.210Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `a6e29c99acdd24ae7e898e5df15ae845c638a2502fe792be9c5509b0676a92a7`
- Owner exit: code `17`, signal `null`
- Contract satisfied before cleanup: `false`
- Expected owner exit: code `17`, signal `null`
- Utility callbacks: none observed
- Utility callback probes: parentPort.close (registered: true, documented: false), parentPort.disconnect (registered: true, documented: false), parentPort.exit (registered: true, documented: false), parentPort.error (registered: true, documented: false), process.disconnect (registered: true, documented: true), process.beforeExit (registered: true, documented: true), process.exit (registered: true, documented: true), process.SIGTERM (registered: true, documented: true), process.SIGHUP (registered: true, documented: true), process.SIGINT (registered: true, documented: true)
- Utility settlements: none observed
- Cleanup left no marked process: `true`

| Role | PID | Parent PID | Marker source | Start identity | Status after observation |
| --- | ---: | ---: | --- | --- | --- |
| owner | 25473 | 25464 | command-line | Sat Jul 11 09:46:10 2026 | absent |
| utility | 25476 | 25473 | process-title | Sat Jul 11 09:46:10 2026 | absent |
| shell | 25477 | 25476 | command-line | Sat Jul 11 09:46:10 2026 | match |
| grandchild | 25478 | 25477 | command-line | Sat Jul 11 09:46:10 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity.
