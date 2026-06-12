# Plan

## Approach

- Use bundler module resolution in the web typecheck config so TypeScript honors package `exports` type conditions used by current frontend dependencies.
- Re-run the release checks after the config is updated.

## Compatibility

The typecheck config change is scoped to the renderer/web project and matches the Vite bundling environment.
