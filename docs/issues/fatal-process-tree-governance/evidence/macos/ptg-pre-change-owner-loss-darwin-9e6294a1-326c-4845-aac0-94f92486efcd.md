# PTG marked-tree harness result

- Run: `9e6294a1-326c-4845-aac0-94f92486efcd`
- Phase: `pre-change`
- Mode: `owner-loss`
- Started: `2026-07-11T02:08:23.432Z`
- Observation window: `5000ms`
- Platform: `darwin/arm64` (25.5.0)
- Distribution: `development-fixture` (packaged: `false`)
- Electron: `40.10.5`
- Harness SHA-256: `f5769e9f93eefb216d1544a746f8e658d7f6b20f22a7f682afc9e59de56421c0`
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
| owner | 60890 | 60869 | command-line | Sat Jul 11 10:08:23 2026 | absent |
| utility | 60893 | 60890 | process-title | Sat Jul 11 10:08:23 2026 | absent |
| shell | 60894 | 60893 | command-line | Sat Jul 11 10:08:23 2026 | match |
| grandchild | 60895 | 60894 | command-line | Sat Jul 11 10:08:23 2026 | match |

The result is a measurement, not a containment success assertion. Cleanup signals only a process
whose PID, marker, and OS start identity still match the captured identity. A role whose marker
cannot be externally verified is never signalled and is recorded for manual cleanup if it survives.
