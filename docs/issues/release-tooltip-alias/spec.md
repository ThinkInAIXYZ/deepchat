# Release Tooltip Alias Build Failure Spec

## Problem

The `v1.0.6-beta.1` release workflow fails during macOS arm64 `pnpm run build` because
`vue-tsgo` cannot resolve imports from `@shadcn/components/ui/tooltip`.

## Goal

Make tooltip component imports resolve consistently in release CI without changing UI behavior.

## Requirements

- Keep existing tooltip component exports unchanged.
- Avoid rewriting existing imports across the app.
- Preserve the release flow by preparing a new beta tag instead of moving `v1.0.6-beta.1`.

## Non-Goals

- Refactor the shadcn component directory layout.
- Change tooltip styling or runtime behavior.
