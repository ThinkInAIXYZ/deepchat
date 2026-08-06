# 002 — Add trigger transform-origin to Tooltip, Select, ContextMenu content

- **Status**: DONE (implemented via `src/dc-ui/styles/motion.css`; `src/shadcn` intentionally unchanged)
- **Commit**: aefcb11cd
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 3 selectors in `src/dc-ui/styles/motion.css`; shadcn primitives are verification-only

## Problem

Tooltip, select, and context-menu content scale during open and close. Without a trigger-based
`transform-origin`, that motion pivots around the popup center instead of the control or pointer.
These are high-frequency surfaces: tooltip hover, select opening, and context-menu invocation.

Playbook: popovers/dropdowns/tooltips scale from their trigger, not center.

## Target

Add only the following three selectors to `src/dc-ui/styles/motion.css`. They target the
`data-slot` attributes emitted by the existing shadcn primitives; this plan does not change those
primitives:

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

1. Add the three Reka transform-origin selectors to `src/dc-ui/styles/motion.css` only.
2. Verify (without editing) that the existing renderer and browser-overlay entries import
   `motion.css`.
3. Verify (without editing) that the existing tooltip, select, and context-menu primitives retain
   their respective `data-slot` attributes.

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
