# PTG marked-tree harness result

- Run: `b674c2b8-1623-498c-85f3-02586a5f350f`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T02:20:27.927Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `4e5291fa28af9a35c5ad99c7032fc49e577b3d46f85eb337de178b13609a4140`
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
| owner | 84561 | 84552 | command-line | Sat Jul 11 10:20:27 2026 | absent |
| utility | 84564 | 84561 | process-title | Sat Jul 11 10:20:28 2026 | absent |
| shell | 84565 | 84564 | command-line | Sat Jul 11 10:20:28 2026 | absent |
| grandchild | 84566 | 84565 | command-line | Sat Jul 11 10:20:28 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
