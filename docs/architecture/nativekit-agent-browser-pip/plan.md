# Remaining Native PiP Validation

The maintained ownership, delivery, capability, and performance contract is in [spec.md](./spec.md).
Automated integration and macOS arm64 development evidence do not replace these target runs.

- [ ] Verify the native panel can move completely outside DeepChat and remains work-area-clamped.
- [ ] Measure direct native drag on 60 Hz and 120 Hz macOS displays.
- [ ] Measure warm first-frame p95 at or below 300 ms and active frame-age p95 at or below 250 ms.
- [ ] Measure `pushImage()` p95 at or below 8 ms and p99 at or below 25 ms, with no PiP presentation
  task longer than 50 ms.
- [ ] Smoke-test macOS x64, Windows x64, and Linux X11/XWayland.
- [ ] Verify the unavailable-capability behavior on a physical native Wayland session.

Record the target, addon/app artifact, display refresh rate, measurements, and observed behavior
before closing the corresponding acceptance criterion.
