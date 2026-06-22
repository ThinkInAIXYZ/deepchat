# Session Start Lag

Status: implemented
Date: 2026-06-22

## User Need

Sending a new DeepChat message should not freeze the main process for several seconds before the
provider stream starts.

## Current Behavior

Logs show one or more seconds between `processMessage` and `[ProcessStream] start`. The lag is
before provider streaming and after session creation. Diagnostic logging isolated the slow path to
`SystemEnvPromptBuilder` while reading `AGENTS.md`, both when the file is missing and when it exists.

## Acceptance Criteria

- No-project sessions still start with `projectDir=<none>`.
- Pre-stream preparation logs identify the slow step before any behavioral optimization.
- Missing `AGENTS.md` files are treated as an expected state and do not emit heavy warning logs.
- Slow `AGENTS.md` reads do not hold the pre-stream path for the full filesystem latency.
- Repeated messages for the same `AGENTS.md` path reuse cached instruction content while refreshing
  stale content in the background.
- No-project sessions keep the existing agent/code tools; performance must not be fixed by removing
  tools from the session.
- No new dependencies.

## Non-goals

- Reworking tool routing caches.
- Changing provider streaming behavior.
- Adding timeouts or skipping memory/tool work before the slow step is confirmed.

## Open Questions

None.
