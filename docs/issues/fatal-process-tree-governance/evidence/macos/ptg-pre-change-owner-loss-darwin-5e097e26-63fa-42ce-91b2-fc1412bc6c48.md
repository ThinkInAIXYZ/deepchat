# PTG marked-tree harness result

- Run: `5e097e26-63fa-42ce-91b2-fc1412bc6c48`
- Phase: `pre-change`
- Mode: `owner-loss`
- Started: `2026-07-11T02:20:28.998Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `4e5291fa28af9a35c5ad99c7032fc49e577b3d46f85eb337de178b13609a4140`
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
| owner | 84729 | 84720 | command-line | Sat Jul 11 10:20:29 2026 | absent |
| utility | 84732 | 84729 | process-title | Sat Jul 11 10:20:29 2026 | absent |
| shell | 84733 | 84732 | command-line | Sat Jul 11 10:20:29 2026 | match |
| grandchild | 84734 | 84733 | command-line | Sat Jul 11 10:20:29 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
