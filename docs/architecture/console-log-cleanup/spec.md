# Console Log Cleanup — Spec

## Goal

Replace ad-hoc `console.log` calls in the main process with explicit `logger` (electron-log)
usage, and add a lint rule to prevent regression.

## Background

- `src/shared/logger.ts` already hooks `console.*` in the main process as a safety net, but the
  file header states the intent: "Use logger for recording instead of console".
- 591 `console.log` call sites exist in `src/main` (663 across the repo). Explicit logger calls
  give correct levels, survive refactors of the hook, and make intent clear.
- Renderer (68 sites) is out of scope: it has no logger infrastructure today; forwarding renderer
  logs to the main log file requires `electron-log` renderer IPC initialization, which is a
  separate design decision.

## Requirements

1. All statement-position `console.log(...)` in `src/main` become `logger.info(...)` with
   `import logger from '@shared/logger'` added where missing.
2. `console.log` inside injected-code strings (`executeJavaScript` payloads in
   `src/main/lib/scrollCapture.ts`, `src/main/presenter/githubCopilotDeviceFlow.ts`) must NOT be
   rewritten — they execute in a renderer context.
3. oxlint `no-console` rule enabled for `src/main/**` allowing `warn`/`error`/`info`/`debug`
   (those remain redirected by the console hook and are out of scope for this goal).
4. Behavior note: direct `logger.info` writes to the console transport even when user logging is
   disabled (the hook gates on `loggingEnabled || is.dev`); for a packaged GUI app stdout is
   inert, so this is accepted.

## Non-goals

- Migrating `console.error` / `console.warn` (1235 sites) — separate effort.
- Renderer/preload logging infrastructure.
- Removing the console hook in `src/shared/logger.ts` (kept as safety net).
