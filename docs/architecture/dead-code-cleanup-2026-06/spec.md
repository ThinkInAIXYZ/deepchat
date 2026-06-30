# Dead Code Cleanup 2026-06 - Spec

## Problem

Two confirmed dead-code candidates remain:

- `readDirectoryTree` in `src/main/presenter/workspacePresenter/directoryReader.ts`
- `src/renderer/src/composables/usePageCapture.example.ts`

They are not used by production code or tests except for self-reference/commented example references.

## Goal

Remove confirmed dead code without changing runtime behavior.

## Evidence

- `rg readDirectoryTree src test docs` only finds the deprecated function and its recursive self-call.
- Production message capture imports `@/composables/message/useMessageCapture`, not `usePageCapture.example`.
- `usePageCapture.example.ts` is an example file under `src/renderer/src`, which keeps it in source search/typecheck scope.

## Acceptance Criteria

1. `rg readDirectoryTree src test docs` returns no live production/test references after cleanup.
2. `rg usePageCapture.example src test docs` returns no live production/test references after cleanup.
3. No runtime imports are changed except removing dead exports/files.
4. Typecheck and lint pass.

## Non-Goals

- Do not run a broad dead-code sweep.
- Do not refactor workspace directory loading.
- Do not rewrite page capture implementation.

