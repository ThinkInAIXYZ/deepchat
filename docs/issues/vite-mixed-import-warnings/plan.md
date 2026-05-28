# Vite Mixed Import Warnings Plan

## Approach

- Replace ineffective dynamic imports with ordinary static imports when the target is already part
  of the eager main-process graph.
- For file MIME detection, move the detection helpers into a small dependency-free module so
  `BaseFileAdapter` can import them statically without creating a direct adapter registry cycle.
- Keep `mime.ts` as the adapter registry facade by re-exporting the MIME detection helpers.

## Validation

- Search for remaining dynamic imports of the warned modules.
- Run formatting, i18n validation, lint, and a main build check to confirm the warnings are gone.

## Risks

- Static presenter imports are cyclic with `presenter/index.ts`; this project already uses the
  exported singleton through static imports in several presenter modules. The changed call sites
  only read the binding inside methods after initialization.
- Extracting MIME detection must preserve the existing exported symbols from `mime.ts` so current
  callers do not need behavioral changes.
