# 007 — Replace session pin-dock margin-left animation with transform

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 scoped style block

## Problem

Pin/dock feedback on session rows shifts content by animating `margin-left` — a layout property
reflowing the row on every frame — and declares `will-change: margin-left`, which is ineffective
(`will-change` only helps transform/opacity/filter). The dock shift is purely visual (the pin
button is absolutely positioned), so it can be a transform.

Current code (`src/renderer/src/components/WindowSideBarSessionItem.vue:283-297`):

```css
.session-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  margin-left: 0;
  transition: margin-left 280ms;
}

.session-item[data-pin-state='docked'] .session-content {
  margin-left: var(--pin-text-shift);
}

.session-item[data-pin-fx] .session-content {
  will-change: margin-left;
}
```

## Target

Animate `transform: translateX(...)` instead, with tokens (280ms → `--dc-motion-default` 220ms,
bare default easing → `--dc-ease-out-express`), and `will-change: transform` only during the
pin-fx window:

```css
.session-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  transform: translateX(0);
  transition: transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.session-item[data-pin-state='docked'] .session-content {
  transform: translateX(var(--pin-text-shift));
}

.session-item[data-pin-fx] .session-content {
  will-change: transform;
}
```

## Repo conventions to follow

- Transform+token exemplar in the same component family:
  `src/renderer/src/components/WindowSideBar.vue:142` uses
  `transition-[opacity,transform] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]`.
- `will-change` is used sparingly and only on transform/opacity:
  `src/renderer/src/components/WindowSideBar.vue:1842` (`willChange: 'transform'`).

## Steps

1. `WindowSideBarSessionItem.vue:283-297` — replace the block above with the target block.
2. Verify the `.pin-button` (line 317, `position: absolute; top: 50%; …`) does not depend on the
   content margin for its position — it is positioned against the `.session-item` box, so it does
   not.

## Boundaries

- Do NOT touch the pin keyframes, glow animations, or the `--pin-text-shift` variable definition.
- Do NOT change markup.
- If truncation/ellipsis width changes visually after the transform swap (content box stays full
  width while shifting), do NOT widen the scope — report back instead of improvising a layout fix.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/WindowSideBar.test.ts`
  (pin-flight and dock behavior is covered) must pass.
- **Feel check**: pin and unpin a session:
  - The row content slides horizontally with a smooth 220ms express ease; DevTools Computed shows
    only `transform` transitioning (no `margin-left`).
  - Rapid re-pin/un-pin retargets smoothly (transitions retarget; they don't restart from zero).
  - Text truncation and the pin button don't overlap at either end of the shift.
- **Done when**: no layout property animates during pin/dock, and docked rows look identical to
  the previous margin-based rendering at rest.
