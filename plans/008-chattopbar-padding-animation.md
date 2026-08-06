# 008 — Tokenize ChatTopBar collapsed-button and padding transitions

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM
- **Category**: Performance / Easing & duration
- **Estimated scope**: 1 file, shell class + scoped transition CSS

## Problem

Two motion issues in the top bar:

1. The shell animates `padding-left` (48px spacer for the collapsed-sidebar new-chat button) with
   `transition-[padding]` at the default 220ms — a layout reflow of the whole bar row on a
   structural toggle.
2. The collapsed-new-chat button itself animates with a bare `200ms ease-out` (weak built-in
   curve, off-token) — `ease-out` is the playbook-correct *direction* for an entrance but must use
   the strong custom curve, and 200ms is above the hover/tooltip band for a small button.

Current code (`src/renderer/src/components/chat/ChatTopBar.vue`):

```html
<div
  v-bind="attrs"
  class="dc-blur-panel sticky top-0 z-[var(--dc-z-sticky)] flex h-12 items-center justify-between bg-background/60 px-4 window-drag-region transition-[padding] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
  :class="{ 'pl-12': showCollapsedNewChatSpacer }"
>
```

```css
.collapsed-new-chat-button-enter-active,
.collapsed-new-chat-button-leave-active {
  transition:
    opacity 200ms ease-out,
    transform 200ms ease-out;
}
```

## Target

Keep the padding transition (removing it would teleport the title row — see plan 014 for why
teleports are findings) but shorten it to `--dc-motion-fast` (140ms) and add explicit
reduced-motion. Tokenize the button transition to `--dc-motion-fast` + `--dc-ease-out-soft` and
add its reduced-motion block:

```html
class="dc-blur-panel sticky top-0 z-[var(--dc-z-sticky)] flex h-12 items-center justify-between bg-background/60 px-4 window-drag-region transition-[padding] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
```

```css
.collapsed-new-chat-button-enter-active,
.collapsed-new-chat-button-leave-active {
  transition:
    opacity var(--dc-motion-fast) var(--dc-ease-out-soft),
    transform var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.collapsed-new-chat-button-enter-from,
.collapsed-new-chat-button-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.collapsed-new-chat-button-enter-to,
.collapsed-new-chat-button-leave-from {
  opacity: 1;
  transform: translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  .collapsed-new-chat-button-enter-active,
  .collapsed-new-chat-button-leave-active {
    transition: none;
  }
}
```

The `-enter-from/-to` values stay exactly as-is (10px slide is fine); only durations/curves change.

## Repo conventions to follow

- Token syntax exemplar: `src/renderer/src/components/WindowSideBar.vue:5` (same `transition-[…]`
  + token pattern).
- `motion-reduce:transition-none` exemplar:
  `src/renderer/src/components/message/MessageBlockToolCall.vue:64,72`.

## Steps

1. `ChatTopBar.vue:4` — `duration-[var(--dc-motion-default)]` →
   `duration-[var(--dc-motion-fast)]`, append `motion-reduce:transition-none`.
2. `ChatTopBar.vue:553-558` — replace the two `200ms ease-out` with
   `var(--dc-motion-fast) var(--dc-ease-out-soft)`.
3. Append the reduced-motion block after line 570 (after the `-leave-from` rule).

## Boundaries

- Do NOT remove the padding transition entirely (causes a visible title-row teleport).
- Do NOT touch the title-inline-shell rules (lines 585+) in this plan.
- Do NOT touch `handleCollapsedNewChat` logic.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/chat/ChatTopBar.test.ts` must
  pass; `pnpm exec oxfmt --check` clean.
- **Feel check**: collapse the sidebar with a chat open:
  - The floating new-chat button slides in over 140ms with the soft curve; the title row shifts
    right in sync (no double-motion feel, no jump).
  - With `prefers-reduced-motion: reduce`, the button appears instantly and the title row snaps
    without animation.
- **Done when**: no bare `ease-out` keyword remains in this component, and the padding reflow is
  confined to a 140ms window.
