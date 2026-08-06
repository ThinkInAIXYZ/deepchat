# 016 — Crossfade ChatSidePanel tab content swaps (opportunity)

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: LOW (opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file, template + scoped CSS

## Problem

The side panel's shell animates open/close, but its **content** — Workspace / Browser / MCP-app
panels — swaps via bare `v-if`/`v-else-if` with zero transition. Spatially-connected panels from
the same segmented trigger change with no motion explaining the swap. Playbook §8: state changes
that teleport are the canonical missed opportunity.

Current code (`src/renderer/src/components/sidepanel/ChatSidePanel.vue:88-107`):

```html
<WorkspacePanel
  v-if="activeTab === 'workspace'"
  ...
/>
<BrowserPanel
  v-else-if="activeTab === 'browser'"
  ...
/>
<div v-else-if="activeTab === 'mcp-app'">
  ...
</div>
```

## Target

Wrap the three branches in a single `<Transition mode="out-in">` (opacity only — no transform, to
avoid scrollbar flash on full-size panels):

```html
<Transition name="panel-content" mode="out-in">
  <WorkspacePanel
    v-if="activeTab === 'workspace'"
    ...
  />
  <BrowserPanel
    v-else-if="activeTab === 'browser'"
    ...
  />
  <div v-else-if="activeTab === 'mcp-app'">
    ...
  </div>
</Transition>
```

Scoped CSS:

```css
.panel-content-enter-active,
.panel-content-leave-active {
  transition: opacity var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.panel-content-enter-from,
.panel-content-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .panel-content-enter-active,
  .panel-content-leave-active {
    transition: none;
  }
}
```

`mode="out-in"` guarantees old and new panels never overlap (important for iframe-based panels
where overlap would show double scrollbars).

## Repo conventions to follow

- `mode="out-in"` + token pattern: `src/renderer/settings/components/control-center/UsageNostalgiaCard.vue:8`
  plus its `220ms ease` fade — use `var(--dc-motion-fast)` (140ms) + `var(--dc-ease-out-soft)` here.
- The file already has a reduced-motion block at line 441 — add this one alongside it.

## Steps

1. Wrap the three `v-if/v-else-if` branches in `<Transition name="panel-content" mode="out-in">`.
2. Add the scoped CSS block.
3. Verify each branch still receives its own key (single root per branch — `v-else-if` branches
   are already distinct elements; add `:key="activeTab"` on the Transition's children only if Vue
   warns about identical element types between branches).

## Boundaries

- Do NOT animate transform on the panels (scrollbar flash).
- Do NOT touch the panel shells' open/close animation (already correct, plan 005 covers it).
- Do NOT convert `v-show` (panels should unmount so iframes unload — current behavior).

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/ChatSidePanel.test.ts` must pass;
  `pnpm run typecheck`.
- **Feel check**: switch between Workspace / Browser / MCP-app tabs:
  - Old panel fades out 140ms, new panel fades in 140ms; never both visible at once.
  - No scrollbar flash or iframe overlap during the swap.
  - Toggle `prefers-reduced-motion: reduce`: instant swap.
- **Done when**: tab swaps crossfade cleanly with no overlap, and the panel shell motion is
  unchanged.
