# Renderer Performance Diagnostics

## Ownership and Data Flow

Chat main exposes a local diagnostic chain for startup, startup workload, and Session viewport
readiness. It uses the existing startup owner and optional local logging setting:

```text
ChatMainApp shell phases
ChatTabView bootstrap / route / interactive / deferred phases
ChatPage Session viewport phases
  -> renderer performance reporter
  -> performance.recordRenderer typed route
  -> RendererPerformanceLogService
  -> logs/renderer-performance.ndjson
```

`ChatMainApp` owns shell phases. `ChatTabView` owns bootstrap, route, interactive, and deferred phases.
The ChatPage feature owns Session viewport phases. Main validates and persists records; it does not
reschedule startup or Session work. The renderer Performance Timeline remains available independently.

## Record and Privacy Contract

Main adds `recordedAt` to each independent NDJSON object. Allowed fields are limited to schema
version, fixed renderer source, scope, controlled phase/outcome, bounded `startupRunId`, elapsed
milliseconds capped at 24 hours, and optional fallback, Session epoch, workload task id/state.

Records never contain conversation text, Session ids, project paths, model/provider configuration,
raw errors, credentials, arbitrary Performance API detail, or persistent user identifiers.

Main parses the schema again and enqueues writes only when `loggingEnabled` is true. Writes are
serialized, use a separate 10 MiB rotation policy, and share the existing logs directory with
`main.jsonl` without sharing its schema or transport. Failure emits only a safe diagnostic and cannot
reject the renderer operation or block startup, restoration, or user input.

## Observable Contract

- A startup may record `shell-mounted`, `app-stores-ready`, `bootstrap-ready` or
  `bootstrap-fallback`, `route-ready`, `interactive`, and `deferred-settled`.
- Successful bootstrap supplies the authoritative `startupRunId`.
- Each terminal workload task is reported at most once per `(runId, taskId)`, using existing task
  timestamps for elapsed time and excluding task payloads.
- Session phases correlate through a Session epoch without persisting the Session id.
- Disabled logging, missing performance APIs, unavailable routes, and file failures leave product
  behavior intact.

## Validation Boundary

Route/schema, main persistence, renderer reporter, and startup integration tests protect strict field
validation, disabled logging, ordered writes, failure isolation, phase timing, and deduplication.
These tests protect the diagnostic mechanism; real Electron/Chromium measurements establish user
latency and rendering budgets. This specification records no claim that an unexecuted suite passed.

No telemetry upload, extra network request, performance panel, toast, shared renderer store, IPC
facade, or change to preload authority is part of this contract.
