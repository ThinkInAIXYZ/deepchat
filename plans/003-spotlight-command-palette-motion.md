# 003 — Reduce spotlight (command palette) open/close motion

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 scoped style block

## Problem

The spotlight is the app's command palette — a keyboard-driven tool opened dozens of times a day.
It currently animates in two phases: a 140ms backdrop fade plus a 220ms panel opacity+transform
entrance (translate `-10px`, scale 0.98). Every open feels delayed, and the two different
durations make the backdrop and panel finish at different times. Playbook §1: command-palette
toggles are the highest-frequency affordance and should have **no animation** (Raycast has none).

Current code (`src/renderer/src/components/spotlight/SpotlightOverlay.vue:336-357`):

```css
.dc-spotlight-enter-active,
.dc-spotlight-leave-active {
  transition: opacity var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.dc-spotlight-enter-active .spotlight-panel,
.dc-spotlight-leave-active .spotlight-panel {
  transition:
    opacity var(--dc-motion-default) var(--dc-ease-out-express),
    transform var(--dc-motion-default) var(--dc-ease-out-express);
}

.dc-spotlight-enter-from,
.dc-spotlight-leave-to {
  opacity: 0;
}

.dc-spotlight-enter-from .spotlight-panel,
.dc-spotlight-leave-to .spotlight-panel {
  opacity: 0;
  transform: translate3d(0, -10px, 0) scale(0.98);
}
```

## Target

One single, near-instant opacity fade for the whole overlay — no transform, no two-phase timing.
Keep the existing `@media (prefers-reduced-motion: reduce)` block (lines 359-371) as-is; it stays
valid and its `transform: none` becomes redundant but harmless.

```css
.dc-spotlight-enter-active,
.dc-spotlight-leave-active {
  transition: opacity 80ms var(--dc-ease-out-soft);
}

.dc-spotlight-enter-active .spotlight-panel,
.dc-spotlight-leave-active .spotlight-panel {
  transition: opacity 80ms var(--dc-ease-out-soft);
}

.dc-spotlight-enter-from,
.dc-spotlight-leave-to {
  opacity: 0;
}

.dc-spotlight-enter-from .spotlight-panel,
.dc-spotlight-leave-to .spotlight-panel {
  opacity: 0;
  transform: none;
}
```

Rationale: 80ms is under the perceptible-delay threshold (playbook tooltip floor is 125ms), kills
the transform entirely (nothing moves), and removes the phase mismatch. The `80ms` literal is
deliberate here — the `--dc-motion-fast` token (140ms) is still slower than a command palette
should be. If the team wants Raycast-exact behavior, both transitions may be set to `none`; 80ms
opacity-only is the maximum acceptable value.

## Repo conventions to follow

- Keep using the `--dc-ease-out-soft` token for the remaining fade.
- Reduced-motion is already handled in this file (lines 359-371) — leave it untouched.

## Steps

1. In `src/renderer/src/components/spotlight/SpotlightOverlay.vue:336-346`, replace the two
   transition rules with the two 80ms rules above.
2. In `src/renderer/src/components/spotlight/SpotlightOverlay.vue:353-357`, replace the panel
   enter/leave-from block with `opacity: 0; transform: none;`.
3. Do not touch the reduced-motion block (lines 359-371) or any markup.

## Boundaries

- Do NOT touch `SpotlightOverlay.vue` markup or the panel's `backdrop-filter` styling.
- Do NOT touch the spotlight's tooltip/command-list internals.
- Do NOT change the 80ms to a token without re-measuring the feel — the token is 140ms and the
  whole point is speed.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/spotlight` (if present) and
  `pnpm run typecheck` pass; `pnpm exec oxfmt --check` clean.
- **Feel check**: trigger spotlight with its keyboard shortcut (for example, `⌘K`):
  - From keydown, both the backdrop and panel are visibly present within 80ms; no panel drift.
  - Backdrop and panel become visible in the same 80ms interval (no two-phase entry).
  - Toggle `prefers-reduced-motion: reduce` — instant show/hide, no fade.
- **Done when**: open/close feels instant and the panel never translates or scales.
