# 004 — Minimize sidebar-shell width animation cost

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file, 1 class change

## Problem

The primary sidebar shell animates its own `width` (288px ↔ 48px) on every collapse/expand. A
width transition triggers layout+paint for the shell and its subtree on every frame — the app's
most frequently toggled structural element. The inner session column (line 142) already does it
right with `transition-[opacity,transform]`; only the shell lags behind the pattern.

Playbook §5: animate `transform` and `opacity` only. A full transform-only collapse would be a
structural redesign (the chat area must reclaim the reclaimed space, which requires reflow), so
this plan minimizes the unavoidable layout window instead of pretending it away: shorter duration
+ explicit reduced-motion. This is the accepted pattern for sidebar collapse (spatial consistency
purpose, playbook §1).

Current code (`src/renderer/src/components/WindowSideBar.vue:5`):

```html
<div
  data-testid="window-sidebar"
  class="window-sidebar-shell flex flex-row h-full shrink-0 overflow-hidden window-drag-region transition-[width] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
  :class="collapsed ? 'w-12' : 'w-[288px]'"
>
```

## Target

```html
<div
  data-testid="window-sidebar"
  class="window-sidebar-shell flex flex-row h-full shrink-0 overflow-hidden window-drag-region transition-[width] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
  :class="collapsed ? 'w-12' : 'w-[288px]'"
>
```

- `--dc-motion-fast` is 140ms. Relative to the prior 220ms duration, it reduces the width
  transition window by **80ms (about 36%)**; it does not make the transition 80ms. The 140ms value
  is an intentional structural-snap exception to the playbook's 200–500ms standard-animation band
  for modals and drawers.
- `motion-reduce:transition-none` makes the shell width change discrete under
  `prefers-reduced-motion`; it does not animate. The existing session-column reduced-motion rule
  likewise removes its transform and opacity transitions.

## Repo conventions to follow

- Token syntax: `duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)]` — same file,
  line 142, is the exemplar.
- `motion-reduce:transition-none` exemplar:
  `src/renderer/src/components/message/MessageBlockToolCall.vue:64,72`.

## Steps

1. `src/renderer/src/components/WindowSideBar.vue:5` — change
   `duration-[var(--dc-motion-default)]` to `duration-[var(--dc-motion-fast)]` and append
   `motion-reduce:transition-none`.
2. Leave line 142 (session column) untouched.

## Boundaries

- Do NOT attempt a transform-only redesign of the shell width (layout must reflow).
- Do NOT touch the rail buttons or the session-column classes.
- Do NOT add `will-change: width` — it is ineffective for layout properties.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/WindowSideBar.test.ts` (50 tests)
  must pass — collapse/expand behavior is covered there.
- **Performance trace**: record five collapse/expand toggles in DevTools Performance:
  - For each toggle, sidebar width changes begin and end within one ~140ms transition interval;
    no second width-transition interval is recorded.
  - The trace contains no main-thread long task (over 50ms) and no frame longer than 16.7ms during
    each transition interval.
  - Layout invalidation is limited to the expected sidebar/chat geometry; there is no additional
    layout shift or repeated reflow after the transition has ended.
  - With `prefers-reduced-motion: reduce`, the width and session-column state each change
    discretely, with no transition interval recorded.
- **Done when**: all five traced toggles meet the interval, frame, long-task, and post-transition
  layout criteria above.
