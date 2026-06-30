# Dead Code Cleanup 2026-06 - Plan

## Fix Strategy

Delete only the two confirmed dead-code targets.

## Affected Files

- `src/main/presenter/workspacePresenter/directoryReader.ts`
- `src/renderer/src/composables/usePageCapture.example.ts`

## Steps

1. Remove `readDirectoryTree`.
2. Delete `usePageCapture.example.ts`.
3. Re-run targeted `rg` checks.
4. Run `pnpm run typecheck`.
5. Run `pnpm run lint`.

## Risk

Low. The only risk is an undocumented external import path. The targeted `rg` check is enough for this repo.

