# Vite Mixed Import Warnings

## Problem

Electron Vite build output reports Rollup warnings when a module is dynamically imported while
also being statically imported elsewhere. The affected modules are:

- `src/main/presenter/filePresenter/mime.ts`
- `src/main/presenter/agentSessionPresenter/legacyImportService.ts`
- `src/main/presenter/index.ts`

Because the modules are already in the static graph, the dynamic imports cannot create separate
chunks and the build remains noisy.

## Acceptance Criteria

- The listed mixed static/dynamic import warnings no longer appear in the main-process build.
- Runtime behavior for file MIME detection, legacy chat import, data reset, shutdown interception,
  and sync import broadcast remains unchanged.
- The fix stays scoped to import structure and avoids broad presenter refactors.

## Non-Goals

- Reworking presenter singleton ownership.
- Changing backup, reset, shutdown, or legacy import behavior.
- Optimizing chunk boundaries beyond removing ineffective dynamic imports.

## Constraints

- Keep the existing presenter and service APIs stable.
- Avoid introducing unresolved circular runtime reads during module initialization.
