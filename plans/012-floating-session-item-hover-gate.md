# 012 — Gate FloatingSessionItem hover lift to fine pointers

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: LOW
- **Category**: Accessibility
- **Estimated scope**: 1 scoped style block

## Problem

The floating-window session card lifts 1px on `:hover` with no `(hover: hover) and (pointer: fine)`
gating. On touch, the tap fires a synthetic hover and the card jumps. The component also has no
local reduced-motion handling for this transform, and it uses the weak built-in `ease` curve with
a hardcoded `140ms` instead of the `--dc-motion-fast` token.

Current code (`src/renderer/floating/components/FloatingSessionItem.vue:116-138`):

```css
.session-card {
  position: relative;
  overflow: hidden;
  backface-visibility: hidden;
  transform: translateZ(0);
  transition:
    transform 140ms ease,
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.session-card:hover {
  transform: translateY(-1px);
}
```

## Target

Tokenize the curves and confine the positional hover to fine pointers. Keep color/border feedback
for all input types (playbook §6: keep opacity/color, drop movement on touch):

```css
.session-card {
  position: relative;
  overflow: hidden;
  backface-visibility: hidden;
  transform: translateZ(0);
  transition:
    transform var(--dc-motion-fast) var(--dc-ease-out-soft),
    border-color 180ms var(--dc-ease-out-soft),
    background-color 180ms var(--dc-ease-out-soft),
    box-shadow 180ms var(--dc-ease-out-soft);
}

@media (hover: hover) and (pointer: fine) {
  .session-card:hover {
    transform: translateY(-1px);
  }
}
```

## Repo conventions to follow

- `--dc-motion-fast` / `--dc-ease-out-soft` tokens: `src/renderer/src/assets/style.css:122-126`.
- The playbook's gating pattern (verbatim):
  `@media (hover: hover) and (pointer: fine)`.

## Steps

1. `FloatingSessionItem.vue:122-126` — replace the four `140ms ease`/`180ms ease` values with the
   tokenized ones above.
2. `FloatingSessionItem.vue:136-138` — wrap `.session-card:hover` in the
   `@media (hover: hover) and (pointer: fine)` block.

## Boundaries

- Do NOT add a reduced-motion block here — the global nuke (style.css:929-941) already applies to
  this window (it imports `assets/main.css`), and the 1px lift at 1ms duration is imperceptible.
- Do NOT touch the card layout or the `::before` decoration.

## Verification

- **Mechanical**: no dedicated test for this component; run `pnpm run typecheck`.
- **Feel check** (Chrome DevTools, Device Mode with touch emulation):
  - Emulated touch: tapping the card never lifts it; hover-style tap still shows color feedback.
  - Real mouse: card lifts 1px with the 140ms soft curve as before.
  - Toggle `prefers-reduced-motion: reduce` — lift effectively disappears (1ms transition).
- **Done when**: no `ease` keyword or hardcoded ms duration remains in this style block, and the
  positional hover only exists for fine pointers.
