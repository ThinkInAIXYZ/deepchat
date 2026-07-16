# Implementation Plan

## MCP Marketplace

- Add a typed batch route accepting a source and unique source IDs and returning installed IDs.
- Resolve the batch with one configuration read in `McpPresenter`; keep the existing single-item
  method unchanged.
- Query only the newly returned marketplace page in the renderer, merge installed IDs into local
  state, and track installation by server key.
- Replace overscroll-based retry with explicit error and retry UI while retaining near-bottom
  pagination.

## Renderer Motion And Access

- Commit side-panel layout width once, animate only the panel surface with transform and opacity,
  and remove the orphaned workspace-nav width-motion CSS.
- Convert tool-call and error disclosure triggers to buttons with `aria-expanded` and controlled
  body IDs. Keep bodies mounted through collapse motion before unmounting expensive content.
- Reveal message toolbars on `focus-within`, enlarge action hit areas, and keep toolbar actions visible
  for coarse pointers.
- Track a pending settings route around `router.push`, show a row-level spinner, and prefetch a route
  component from pointer or keyboard focus.

## Compatibility And Validation

- No stored-data migration is required.
- Extend route-dispatcher, renderer-client, and component tests around the new behavior.
- Run formatting, generated i18n types, lint, typecheck, and focused renderer/main tests before the
  full relevant test pass.
