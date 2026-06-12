# Console Log Cleanup — Plan

## Approach

Codemod (one-off script, not committed) over `src/main/**/*.ts`:

1. Skip `src/main/lib/scrollCapture.ts` and `src/main/presenter/githubCopilotDeviceFlow.ts`
   (contain injected-code strings); handle by hand if they also have statement-position calls.
2. Replace `/^([ \t]*)console\.log\(/gm` → `$1logger.info(` — statement position only, so
   `console.log` inside template literals or mid-line stays untouched.
3. If a file changed and has no existing `shared/logger` import, prepend
   `import logger from '@shared/logger'`.
4. Manually review the ~9 non-statement-position call sites left behind.
5. Add `no-console` (allow `warn`, `error`, `info`, `debug`) for `src/main/**` via an oxlint
   override; lint output identifies any survivors.
6. Verify: `pnpm run lint`, `pnpm run typecheck:node`, `pnpm run format`.

## Risks

- A `console.log` at statement position inside a multi-line template literal would be wrongly
  rewritten → mitigated by reviewing the diff of the two known injected-code files (skipped) and
  grepping for `logger.info` inside backticks after the run.
- Import insertion at top of file may violate formatting → `pnpm run format` normalizes.

## Tasks

See [tasks.md](tasks.md).
