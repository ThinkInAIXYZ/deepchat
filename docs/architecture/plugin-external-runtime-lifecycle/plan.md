# Remaining Plugin Runtime Release Gates

The maintained ownership and supervision contract is in [spec.md](./spec.md). The pinned CUA
catalog, policy, and projection contract is in [CUA Driver Contract](../cua-driver-0-17-contract-migration/spec.md).

- [ ] Generate and verify the current pinned native catalog and packaged artifact on every
  supported target; compare platform-scoped policies with the actual catalog.
- [ ] Run native driver ownership smoke with a disposable process on each supported platform.
- [ ] Validate bundled and preinstalled custom cursor themes, including current v2 loading and
  explicit retired-v1 rejection.
- [ ] Run the native Calculator action-and-postcondition verification scenario.
- [ ] Vendor and lock Feishu's runtime dependency closure as the remaining security follow-up.
- [ ] macOS arm64 and x64: signed/notarized app, TCC, screen capture, input, restart, crash/recovery.
- [ ] Windows x64 and arm64: clean consumer install with Defender enabled, recording protection
  status and history.
- [ ] Linux x64 X11: reproduce the #2039 activation path without desktop/session loss.
- [ ] Linux x64 X11: measure warm-daemon idle CPU, handle/file-descriptor count, and residual
  windows with and without a compositor.
- [ ] Linux x64 Wayland: validate discovery, input, capture, restart, current and older manually
  installed helper states, and documented limitations.

A CI package or development signature does not satisfy native interaction or release-signing gates.
Optional CUA artifact validation does not block building the Linux application itself.
