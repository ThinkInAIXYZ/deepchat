# 009 — Convert McpTabHeader underline to scaleX and token durations

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM
- **Category**: Performance / Easing & duration
- **Estimated scope**: 1 file, template classes only

## Problem

The MCP tab header animates the active-tab underline by changing `width` through
`transition-all duration-300` — layout animation on a hot path (tab switching), at the 300ms
ceiling, with `transition-all` on the tab buttons and icons too. Playbook: animate transform
only; hover/entrance stays under 300ms with the strong custom curve.

Current code (`src/renderer/src/components/mcp-config/components/McpTabHeader.vue:34-58`):

```html
<button
  v-for="tab in tabs"
  :key="tab.id"
  :class="[
    'group flex items-center px-1 py-1.5 text-xs font-medium transition-all duration-300 ease-out',
    ...
  ]"
>
  <Icon
    :icon="tab.icon"
    :class="[
      'mr-2 h-3.5 w-3.5 transition-all duration-300',
      ...
    ]"
  />
  <span class="relative">
    {{ t(tab.label) }}
    <div
      :class="[
        'absolute -bottom-1.5 left-0 h-0.5 bg-primary transition-all duration-300 ease-out',
        activeTab === tab.id
          ? 'w-full opacity-100'
          : 'w-0 opacity-0 group-hover:w-full group-hover:opacity-50'
      ]"
    />
  </span>
</button>
```

## Target

Tab button and icon: color-only transition at 140ms with the soft curve. Underline: scaleX with
`origin-left` (grows from the left edge), transform+opacity at 140ms express:

```html
'group flex items-center px-1 py-1.5 text-xs font-medium transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]'
```

```html
'mr-2 h-3.5 w-3.5 transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]'
```

```html
'absolute -bottom-1.5 left-0 h-0.5 bg-primary origin-left transition-[transform,opacity] duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none',
activeTab === tab.id
  ? 'scale-x-100 opacity-100'
  : 'scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-50'
```

The underline keeps its full width in layout (`h-0.5` + `left-0` + implicit full-width via the
span's relative parent) — `scale-x-100`/`scale-x-0` shrink it visually without layout reflow.

## Repo conventions to follow

- 140ms token for hover/fast feedback: `--dc-motion-fast`; soft curve for color,
  express for transform — see `src/renderer/src/components/message/MessageToolbar.vue:5` and
  `src/renderer/src/components/WindowSideBar.vue:142`.
- `motion-reduce:transition-none` exemplar:
  `src/renderer/src/components/message/MessageBlockToolCall.vue:64,72`.

## Steps

1. `McpTabHeader.vue:34` — replace `transition-all duration-300 ease-out` with
   `transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]`.
2. `McpTabHeader.vue:45` — replace `transition-all duration-300` with
   `transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]`.
3. `McpTabHeader.vue:53-56` — replace the underline classes per the target above.

## Boundaries

- Do NOT touch the nav container, `space-x-6`, or tab content markup.
- Do NOT change the hover intent (hover shows a 50% underline) — only its mechanics.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/McpTabHeader.test.ts` (if
  present) and `pnpm run typecheck` pass; `pnpm exec oxfmt --check` clean.
- **Feel check** (Animations panel, 10% playback): switch MCP tabs:
  - The underline grows from the left edge (scaleX) instead of stretching its width; no layout
    shift in the header row.
  - Tab label/icon color crossfades in 140ms; hover preview underline is instant-feeling.
- **Done when**: no `transition-all`, `width` animation, or `300` duration remains in this file.
