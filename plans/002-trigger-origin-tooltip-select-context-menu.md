# 002 — Add trigger transform-origin to Tooltip, Select, ContextMenu content

- **Status**: DONE (implemented via `src/dc-ui/styles/motion.css`; `src/shadcn` intentionally unchanged)
- **Commit**: aefcb11cd
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 1 shared dc-ui stylesheet, no logic changes

## Problem

Tooltip, select, and context-menu content scale during open and close. Without a trigger-based
`transform-origin`, that motion pivots around the popup center instead of the control or pointer.
These are high-frequency surfaces: tooltip hover, select opening, and context-menu invocation.

Playbook: popovers/dropdowns/tooltips scale from their trigger, not center.

## Target

Apply the Reka transform-origin variables through the shared dc-ui stylesheet. The selectors target
the slots rendered by the unmodified shadcn primitives:

```css
[data-slot='tooltip-content'] {
  transform-origin: var(--reka-tooltip-content-transform-origin);
}

[data-slot='select-content'] {
  transform-origin: var(--reka-select-content-transform-origin);
}

[data-slot='context-menu-content'] {
  transform-origin: var(--reka-context-menu-content-transform-origin);
}
```

## Repo conventions to follow

- Keep motion overrides in `src/dc-ui/styles/motion.css`, which is imported by both renderer entry
  points.
- `src/shadcn` is verification-only; do not edit its generated primitives.

## Steps

1. Add the three Reka transform-origin selectors to `src/dc-ui/styles/motion.css`.
2. Import that stylesheet from the renderer and browser-overlay entries.
3. Verify the existing tooltip, select, and context-menu content retains its respective `data-slot`.

## Boundaries

- Do NOT edit `src/shadcn` content components.
- Do NOT change popup color, duration, easing, or Reka imports.

## Verification

- **Mechanical**: `pnpm run typecheck` passes; `pnpm exec oxfmt --check` is clean on the stylesheet
  and entry points.
- **Feel check** (Animations panel, 10% playback):
  - Hover any icon button: the tooltip scales up from its trigger edge, not its middle.
  - Open any select: the list grows from the select trigger corner.
  - Right-click a message: the context menu grows from the pointer position.
- **Done when**: all three popups visually scale from their anchor, and rapid open/close shows no
  center-pivot wobble.
