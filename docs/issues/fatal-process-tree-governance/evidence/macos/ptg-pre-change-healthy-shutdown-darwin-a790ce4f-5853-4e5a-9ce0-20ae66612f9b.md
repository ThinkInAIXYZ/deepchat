# PTG marked-tree harness result

- Run: `a790ce4f-5853-4e5a-9ce0-20ae66612f9b`
- Phase: `pre-change`
- Mode: `healthy-shutdown`
- Started: `2026-07-11T02:32:13.252Z`
- Observation window: `250ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `15f2d20f906a9ffe907766ed7eb8c8efd4cad5374c4bf10a216dd0d2b13f55a9`
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
| owner | 6011 | 5990 | command-line | Sat Jul 11 10:32:13 2026 | absent |
| utility | 6026 | 6011 | process-title | Sat Jul 11 10:32:13 2026 | absent |
| shell | 6027 | 6026 | command-line | Sat Jul 11 10:32:13 2026 | absent |
| grandchild | 6028 | 6027 | command-line | Sat Jul 11 10:32:13 2026 | absent |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
