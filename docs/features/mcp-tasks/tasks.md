# MCP Tasks Extension Tasks

## Upstream Gate

- [ ] Re-check extension status, stable revisions, packages, and current schema.
- [ ] Require a public modern-wire result/dispatch/notification API from the SDK or official
      extension package.
- [ ] Stop with no code, schema vendoring, migration, setting, UI, or advertisement if the SDK
      compatibility gate is absent.
- [ ] Update this SDD before implementation if stable artifacts exist.
- [ ] Otherwise pin commit `2c1425d9a288b9b1f489430fe1e00bb392b47e48`.

## Schema And Core

- [ ] Add the experimental setting after Gate 0 passes and do not advertise while it is off.
- [ ] Vendor or consume official task schemas with commit/hash/license provenance.
- [ ] Integrate public Tasks result, get, update, cancel, and notification APIs.
- [ ] Add `notifications/tasks` validation.
- [ ] Handle task results through the public adapter without changing synchronous tool behavior.
- [ ] Reject task results for unsupported request methods.
- [ ] Keep v1 SDK types out of MCP core.
- [ ] Prove there is no direct transport write, SDK registry patch, or cast around protocol-version
      enforcement.

## Persistence

- [ ] Add the encrypted `mcp_tasks` table and migration.
- [ ] Use random local `record_id`, unique immutable server/binding/task identity, and unique
      `(message_id, tool_call_id)` history identity.
- [ ] Store server generation and pause on generation/binding mismatch; preserve rename.
- [ ] Audit and reject duplicate/missing tool-call history locators without block-index fallback.
- [ ] Insert durable task state before returning a pending tool projection.
- [ ] Add active-by-server load and compare/update operations.
- [ ] Persist outstanding/handled input keys and response acknowledgement.
- [ ] Atomically locate by `(messageId, toolCallId)`, verify local record ID, compare-and-set
      task/transcript revisions, and finalize the task row plus original assistant block.
- [ ] Integrate conversation and server deletion.

## Coordinator

- [ ] Add one main-process `McpTaskCoordinator`.
- [ ] Add one earliest-due polling scheduler.
- [ ] Respect server interval, minimum, jitter, backoff, TTL, and server lifecycle.
- [ ] Add task subscription acknowledgement and polling fallback.
- [ ] Reject stale updates and terminal regression.
- [ ] Enforce active task, payload, input key, and status message limits.

## Mid-Flight Input

- [ ] Add a shared direct/Task MRTR input router.
- [ ] Route sampling through the existing sampling service.
- [ ] Add host-owned elicitation form and URL interactions.
- [ ] Return truthful empty roots.
- [ ] Deduplicate stable keys across polls, notifications, remounts, and restart.
- [ ] Persist response intent and retry only unacknowledged `tasks/update`.

## Cancellation And Lifecycle

- [ ] Persist cancel intent before `tasks/cancel`.
- [ ] Continue observation after acknowledgement until a terminal state.
- [ ] Resume valid tasks after restart and enabled-server connection.
- [ ] Pause disabled, missing, and auth-required servers.
- [ ] Best-effort cancel on confirmed conversation/server deletion.
- [ ] Persist without mass cancellation on app shutdown.

## Tool History And Renderer

- [ ] Write one pending tool response for provider compatibility.
- [ ] Replace that response atomically with the terminal result/error.
- [ ] Never append a duplicate provider tool response.
- [ ] Add working/input/cancel/terminal/paused/unavailable task UI.
- [ ] Use only local record/interaction IDs in renderer routes/events; keep `taskId` and remote
      identity in main/SQLCipher.
- [ ] Add user-controlled Continue with result.
- [ ] Preserve final text, image, diff, structured content, and MCP App rendering.
- [ ] Add i18n and keyboard/screen-reader coverage.

## Verification

- [ ] Run format, i18n validation, lint, typecheck, and focused Tasks suites.
- [ ] Run fake-timer scheduling and subscription fallback tests.
- [ ] Run sampling/elicitation/roots and input dedupe tests.
- [ ] Run restart, auth pause, deletion, TTL, and cooperative cancellation tests.
- [ ] Run atomic history and no-duplicate-result tests.
- [ ] Run message-block rewrite, stale-revision, duplicate-locator, and route-context isolation
      tests.
- [ ] Keep `MV-TASK-01` in the ecosystem manual verification runbook `BLOCKED` while Gate 0 is
      absent.
- [ ] After Gate 0 passes, run and archive the deterministic packaged long-running task smoke.
