# Remaining Scroll Validation and Performance Work

The maintained viewport, ownership, and compatibility contracts are in [spec.md](./spec.md).
The deterministic real Electron long-history scenario exercises history, bounded rendering,
reading-position preservation, Session switching, and loaded-message search without a provider.
It does not replace the matrix and physical-device measurements below.

- [ ] Capture per-frame reason, request ID, Session epoch, expected/actual top, scroll/client
  height, anchor identity, and committed-write counts for the rollback and delayed-layout cases.
- [ ] Complete the real Chromium compatibility matrix with anchor drift at or below one CSS
  pixel: restore interruption; enabled/disabled auto-follow and streaming; pending-assistant and
  rate-limit transitions; Markdown/images/tools; composer resize, focus, IME, and TipTap containment;
  search and Spotlight/trace; history prepend and cursor continuity; Memory, interactions, queue,
  read-only sessions, and capture/export of all loaded messages.
- [ ] Verify bounded heavy-row mounting while preserving loaded-history/search counts and
  composer/input readiness during Session switches.
- [ ] Measure cold first load, cached and uncached switches, rapid-switch races, recent-cache
  memory, repaint/compositor work, long tasks, and scroll writes against the specified budgets
  on the reference machine.
- [ ] Manually verify mouse-wheel and trackpad inertia in short and long macOS conversations.

Header, viewport, and composer already use isolated grid rows inside ChatPage; separate component
files are unnecessary for that geometry contract. Further feature-local extraction is tracked in
[Renderer boundaries](../renderer-application-boundaries/plan.md). Close each remaining gate only
with its own observed evidence.
