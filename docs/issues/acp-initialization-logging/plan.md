# ACP Initialization Logging Plan

## Scope

Implement a focused diagnostics increment in the existing ACP runtime:

- `AcpProcessManager` owns subprocess startup, JSON-RPC stream creation, initialize, and lifecycle monitoring.
- `AcpSessionManager` owns normal chat session setup through `loadSession` and `newSession`.
- `AcpProvider` owns normal chat prompt dispatch through `session/prompt`.

## Implementation

1. Replace the direct SDK `ndJsonStream` use with an equivalent traced NDJSON stream wrapper inside `AcpProcessManager`.
   - Log inbound and outbound JSON-RPC summaries as messages pass through the same stream used by the SDK.
   - Track request ids to correlate responses with methods.
   - Record parse failures from stdout as ACP debug errors.

2. Attach subprocess stderr/error/exit monitoring before `initialize`.
   - Keep the monitor after initialization so process exits still clear handles.
   - Race initialization with process exit and connection closure in addition to the existing timeout.

3. Add session and prompt logs.
   - Record summarized `session/load`, `session/new`, and `session/prompt` request/response/error events.
   - Avoid storing full prompt text or full MCP server/env payloads.

## Test Strategy

- Run focused ACP main-process tests for the touched runtime paths where practical.
- Run repository formatting/i18n/lint gates after implementation as required by project instructions.
