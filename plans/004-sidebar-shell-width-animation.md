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

- `--dc-motion-fast` (140ms) shortens the current 220ms layout-animation window by 80ms
  (about 36%) while staying inside the playbook's standard-animation band (modals/drawers
  200-500ms; this is a structural snap, so 140ms is appropriately snappy).
- `motion-reduce:transition-none` drops the shell movement entirely under `prefers-reduced-motion`.
  The session column's reduced-motion rule also removes both its transform and opacity transitions.

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
- **Feel check**: collapse/expand the sidebar repeatedly:
  - Record a DevTools Performance trace while repeatedly toggling the sidebar: layout work stays
    within each ~140ms transition window, frames remain responsive, and no visible jank occurs.
  - With `prefers-reduced-motion: reduce`, the width and session-column state change instantly.
- **Done when**: collapse feels responsive (not laggy), and DevTools Performance shows the width
  layout work confined to a single ~140ms window per toggle.
