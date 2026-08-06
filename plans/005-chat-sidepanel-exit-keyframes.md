# 005 — Fix backwards exit keyframes in ChatSidePanel fullscreen

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 scoped style block

## Problem

The side panel's fullscreen expand/collapse exit keyframes animate **in the wrong direction**: on
exit, opacity goes from 0.96 → 1 (the panel fades *in* while it's leaving) and scale goes from
1.01 → 1. The exit should fade out and shrink slightly, matching the enter (0.94 → 1 opacity,
0.985 → 1 scale). The enter is correct; only the exit is backwards.

Current code (`src/renderer/src/components/sidepanel/ChatSidePanel.vue:429-439`):

```css
@keyframes workspace-panel-fullscreen-exit {
  from {
    opacity: 0.96;
    transform: translateZ(0) scale(1.01);
  }

  to {
    opacity: 1;
    transform: translateZ(0) scale(1);
  }
}
```

Also, the surface transition-property list (lines 400-401) includes paint properties:

```css
.chat-side-panel-surface {
  backface-visibility: hidden;
  transform: translateZ(0);
  transition-duration: var(--dc-motion-default);
  transition-property: transform, opacity, box-shadow, border-radius;
  transition-timing-function: var(--dc-ease-out-express);
  will-change: transform, opacity;
}
```

## Target

Exit mirrors the enter: fade out and shrink, using the same in-band scale values (0.985 / 1.01
are both inside the playbook's 0.9–0.97+ band — keep them, they are already good):

```css
@keyframes workspace-panel-fullscreen-exit {
  from {
    opacity: 1;
    transform: translateZ(0) scale(1);
  }

  to {
    opacity: 0.94;
    transform: translateZ(0) scale(0.985);
  }
}
```

And narrow the surface transition to GPU-friendly properties — `box-shadow` and `border-radius`
snap instantly, masked by the 180ms opacity fade:

```css
transition-property: transform, opacity;
```

## Repo conventions to follow

- Keep `180ms var(--dc-ease-out-express)` on the keyframes (lines 409-410) — already token-correct.
- Keep the existing reduced-motion block (lines 441-450) untouched.

## Steps

1. `src/renderer/src/components/sidepanel/ChatSidePanel.vue:429-439` — replace the exit
   keyframes with the from/to values above.
2. `src/renderer/src/components/sidepanel/ChatSidePanel.vue:400` — change
   `transition-property: transform, opacity, box-shadow, border-radius;` to
   `transition-property: transform, opacity;`.
3. Do not touch enter keyframes, durations, or the reduced-motion block.

## Boundaries

- Do NOT convert these keyframes to transitions (mode switches are occasional; the keyframes'
  restart behavior is acceptable here).
- Do NOT touch the resize logic or `.chat-side-panel-shell--resizing` rule.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/ChatSidePanel.test.ts` must pass;
  `pnpm exec oxfmt --check` clean.
- **Feel check** (Animations panel, 10% playback): toggle the panel to fullscreen and back:
  - Enter: panel grows from 0.985 → 1 while fading in.
  - Exit: panel shrinks to 0.985 and fades **out** — it must never brighten while leaving.
- **Done when**: exit visually mirrors enter (shrink + fade out), and no border-radius/shadow
  animation is visible during the toggle.
