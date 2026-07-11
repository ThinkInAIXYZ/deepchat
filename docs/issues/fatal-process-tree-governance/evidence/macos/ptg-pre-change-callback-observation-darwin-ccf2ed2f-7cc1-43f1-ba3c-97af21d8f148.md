# PTG marked-tree harness result

- Run: `ccf2ed2f-7cc1-43f1-ba3c-97af21d8f148`
- Phase: `pre-change`
- Mode: `callback-observation`
- Started: `2026-07-11T02:08:29.300Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `f5769e9f93eefb216d1544a746f8e658d7f6b20f22a7f682afc9e59de56421c0`
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
| owner | 61153 | 61142 | command-line | Sat Jul 11 10:08:29 2026 | absent |
| utility | 61157 | 61153 | process-title | Sat Jul 11 10:08:29 2026 | absent |
| shell | 61159 | 61157 | command-line | Sat Jul 11 10:08:29 2026 | match |
| grandchild | 61160 | 61159 | command-line | Sat Jul 11 10:08:29 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
