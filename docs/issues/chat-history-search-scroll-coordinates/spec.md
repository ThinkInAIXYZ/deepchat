# Chat history physical scroll acceptance

Status: pending macOS trackpad and mouse-inertia acceptance.

The maintained ownership and coordinate contract is in
[Chat scroll ownership](../../architecture/chat-scroll-ownership/spec.md). This issue tracks the
remaining physical-input acceptance rather than duplicating that design or completed implementation
steps.

## Remaining acceptance

Use a disposable profile with a conversation long enough to span multiple history pages. Record the
macOS version, input device, steps and observed outcome for each scenario:

- [ ] Repeated physical wheel/trackpad gestures across at least two history pages preserve the
  reading anchor, including inertia, without a reverse correction or delayed rollback.
- [ ] `Cmd/Ctrl+F` next/previous navigation reaches visible and off-window results. Physical
  scrolling with search open does not recenter the active result; a search jump near the top does
  not itself request older messages.
- [ ] Row measurement and composer-height changes during and after a gesture do not produce a
  second correction. A gesture during asynchronous session restore preserves the user's reading
  position instead of restoring the bottom afterward.

Existing auto-follow, spotlight, virtual layout spacing and request-scoped interruption contracts
remain defined by the maintained architecture spec. Closing this issue requires passing physical
input evidence; automated scroll writes alone do not satisfy it.

## Existing automated protection

[The Electron scroll smoke](../../../test/e2e/specs/31-chat-scroll-ownership.smoke.spec.ts) uses a
closed disposable SQLite profile containing 240 ordered user/assistant messages and a second
conversation. It runs without provider credentials or an integration opt-in and exercises actual
Chromium pagination, virtualization, conversation switching, passive reading position, automated
wheel input and loaded-history search.

That scenario and the renderer ownership regressions protect their observable paths. They do not
measure physical macOS trackpad inertia or replace the remaining manual matrix above.

No GitHub issue is linked; creating one requires explicit developer authorization.
