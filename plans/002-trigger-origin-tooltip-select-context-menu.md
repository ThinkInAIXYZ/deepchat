# 002 — Add trigger transform-origin to Tooltip, Select, ContextMenu content

- **Status**: DONE (implemented via `src/dc-ui/styles/motion.css`; `src/shadcn` intentionally unchanged)
- **Commit**: aefcb11cd
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 3 shadcn class strings, no logic changes

## Problem

Three shadcn-vue popups animate `zoom-in-95`/`zoom-out-95` (scale 0.95) **without a
transform-origin**, so they scale from their own center instead of from the trigger they grew out
of. The sibling `DropdownMenuContent` already carries the correct origin class — these three are
the only ones missing it. This runs on the app's highest-frequency surfaces: every tooltip hover,
every select, every right-click menu.

Playbook: popovers/dropdowns/tooltips scale from their trigger, not center.

Current code:

`src/shadcn/components/ui/tooltip/TooltipContent.vue:27` — no origin class at all:

```html
:class="cn('bg-black/75 backdrop-blur-sm text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance', props.class)"
```

`src/shadcn/components/ui/select/SelectContent.vue:38` — zoom classes but no origin:

```html
'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-[80] max-h-(--reka-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border shadow-md',
```

`src/shadcn/components/ui/context-menu/ContextMenuContent.vue:27` — same gap:

```html
'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--reka-context-menu-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
```

## Target

Add the reka-provided origin variable class to each content string. reka-ui injects
`--reka-<component>-content-transform-origin` on the content element itself (verified in
`node_modules/reka-ui/dist/Tooltip/TooltipContentImpl.js:128` and the same pattern in Select /
ContextMenu), so consuming it with a Tailwind `origin-(…)` class works exactly like the existing
DropdownMenu pattern.

- TooltipContent.vue:27 — insert `origin-(--reka-tooltip-content-transform-origin)` into the class string.
- SelectContent.vue:38 — insert `origin-(--reka-select-content-transform-origin)`.
- ContextMenuContent.vue:27 — insert `origin-(--reka-context-menu-content-transform-origin)`.

## Repo conventions to follow

- Exemplar (verbatim, do not modify): `src/shadcn/components/ui/dropdown-menu/DropdownMenuContent.vue:35`
  already has `origin-(--reka-dropdown-menu-content-transform-origin)` in its class list.
- Note: the design-system rule "never edit `src/shadcn`" (docs/design-system.md #5) governs
  **theme/color tokens**. This change is a motion class of the same kind as the `zoom-in-95`
  classes already present in these files; no color token is touched.

## Steps

1. `src/shadcn/components/ui/tooltip/TooltipContent.vue:27` — add
   `origin-(--reka-tooltip-content-transform-origin)` after `z-50` in the class string.
2. `src/shadcn/components/ui/select/SelectContent.vue:38` — add
   `origin-(--reka-select-content-transform-origin)` after `z-[80]`.
3. `src/shadcn/components/ui/context-menu/ContextMenuContent.vue:27` — add
   `origin-(--reka-context-menu-content-transform-origin)` after `z-50`.
4. Keep all other classes byte-for-byte.

## Boundaries

- Do NOT touch `DropdownMenuContent.vue` or `PopoverContent.vue` (already correct).
- Do NOT change any color/duration/easing values in these files.
- Do NOT touch the tooltip/select/context-menu `.ts` index files or reka imports.

## Verification

- **Mechanical**: `pnpm run typecheck` passes; `pnpm exec oxfmt --check` clean on the 3 files.
  Run `pnpm exec vitest run test/renderer/components/chat/ChatTopBar.test.ts`
  (dropdown-heavy) and `test/renderer/components/ModelChooser.test.ts` (select-heavy) if present.
- **Feel check** (Animations panel, 10% playback):
  - Hover any icon button: the tooltip scales up from its trigger edge (bottom edge grows toward
    the cursor), not from its middle.
  - Open any select: the list grows from the select trigger corner.
  - Right-click a message: the context menu grows from the pointer position.
- **Done when**: all three popups visually scale from their anchor, and rapid open/close shows no
  center-pivot wobble.
