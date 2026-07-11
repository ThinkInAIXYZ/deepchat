# PTG marked-tree harness result

- Run: `d980735c-5282-4667-90b6-b19d7cd6478d`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T01:56:47.685Z`
- Completed: `2026-07-11T01:56:53.300Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `86c318069dd2cd0b0b7deb2ee3d7ea11044fb1c498e7bbd84f026d4ed6c42b9f`
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
| owner | 41356 | 41347 | command-line | Sat Jul 11 09:56:47 2026 | absent |
| utility | 41359 | 41356 | process-title | Sat Jul 11 09:56:47 2026 | absent |
| shell | 41360 | 41359 | command-line | Sat Jul 11 09:56:47 2026 | match |
| grandchild | 41361 | 41360 | command-line | Sat Jul 11 09:56:47 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
