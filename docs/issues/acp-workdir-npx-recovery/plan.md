# Implementation Plan

## Renderer

- Add a `FileClient.isDirectory` check in `NewThreadPage`.
- Track directory status as `none`, `checking`, `valid`, or `invalid`.
- Use a monotonically increasing request sequence so late async results are ignored.
- Render a `lucide:circle-alert` icon with a localized title when the selected project path is invalid.
- Include ACP workdir unavailability in `submit-disabled`, toolbar `send-disabled`, submit handlers, and the ACP draft watcher.

## Main

- Replace ACP spawn cwd HOME fallback with explicit directory validation.
- Keep fallback workdir behavior only for empty workdir input.
- Wrap ACP process spawn in one npx repair retry.
- Parse `_npx/<hash>/package.json` ENOENT from stderr/error text, rename only that hash directory, and retry once.

## Tests

- Extend NewThreadPage tests for universal warning, DeepChat non-blocking behavior, ACP blocking behavior, and draft suppression.
- Add AcpProcessManager tests for missing cwd rejection and npx repair gating/rename/retry behavior.
