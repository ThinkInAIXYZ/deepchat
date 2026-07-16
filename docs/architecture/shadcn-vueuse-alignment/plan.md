# Plan: shadcn-vue + VueUse Alignment

## Approach

Incremental, high-ROI waves. Wave 1 is independent and mergeable.

### Wave 1

1. Document standing rule in this SDD + `Agents.md`.
2. Skeleton: chat placeholders, session skeleton, sidebar list loading, key settings page skeletons.
3. Spinner: model check dialog CSS spinner, media blocks, MCP/artifact/popup loaders, button loading patterns.
4. Empty: Memory empty state, sidebar empty session list.
5. VueUse: `useWindowSize` in sidepanel store, `refDebounced` in provider model search, low-risk `useEventListener` / `useIntervalFn`.
6. Remove dead `ScrollablePopover.vue`.

### Wave 2+

Form primitives (`AgentTransferDialog`), Tooltip migration, remaining settings skeletons/empties, clipboard, resize observers — see repository session plan if present.

## Interfaces / reuse

| Need | Use |
|------|-----|
| Loading icon | `@shadcn/components/ui/spinner` |
| Placeholder blocks | `@shadcn/components/ui/skeleton` |
| Empty states | `@shadcn/components/ui/empty` |
| Button loading | `Button` + `Spinner` + `disabled` + `data-icon` |
| Window size | `useWindowSize` from `@vueuse/core` |
| Debounced ref | `refDebounced` from `@vueuse/core` |
| Event listeners | `useEventListener` from `@vueuse/core` |
| Polling | `useIntervalFn` from `@vueuse/core` |

## Compatibility

- Preserve `data-testid` attributes.
- Keep debounce delays and clamp logic equivalent.
- Do not change IPC or store public APIs except internal listener implementation.

## Test strategy

- Lint / format / i18n / typecheck on changed code.
- Manual smoke: chat skeleton, model check dialog, memory empty, sidebar empty/loading, sidepanel resize, model search debounce.
