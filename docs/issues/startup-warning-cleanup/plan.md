# Startup Warning Cleanup Plan

## Implementation

- Add a lifecycle delay normalization helper and use it before the development-only hook delay timer.
- Add `EventBus.sendToRendererIfAvailable(...)`, sharing the existing renderer dispatch behavior while
  returning `false` silently when `WindowPresenter` is unavailable.
- Update `EventBus.send(...)` to emit to main listeners first and then use the optional renderer send.
- Route ACP/session-list refresh notifications through the optional renderer send when no renderer may
  exist yet.

## Tests

- Unit-test lifecycle delay normalization for missing, empty, invalid, negative, fractional, and valid
  values.
- Extend EventBus tests to cover optional renderer delivery, direct renderer warnings, and main-process
  delivery without a renderer.
