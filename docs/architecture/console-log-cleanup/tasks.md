# Console Log Cleanup — Tasks

- [x] T1: Codemod statement-position `console.log` → `logger.info` in `src/main` (+ imports)
- [x] T2: Manually migrate remaining non-statement-position call sites
- [x] T3: Add oxlint `no-console` override for `src/main/**` (allow warn/error/info/debug)
- [x] T4: Verify template-literal call sites were untouched (scrollCapture, githubCopilotDeviceFlow)
- [x] T5: `pnpm run format` + `pnpm run lint` + `pnpm run typecheck:node` clean

## Outcome

- 582 call sites migrated across 69 files; injected-code strings in `scrollCapture.ts` and
  `githubCopilotDeviceFlow.ts` left untouched (the latter uses `console.log` as a renderer→main
  message channel via `console-message`).
- Global `@shared/logger` mock added to `test/setup.ts` so importing logger never pulls
  electron's `app` into partially-mocked tests.
- 4 test files that asserted on `console.log` spies updated to assert on `vi.mocked(logger.info)`.
- `test:main` back to the pre-change baseline (15 pre-existing failures on dev, unrelated).
