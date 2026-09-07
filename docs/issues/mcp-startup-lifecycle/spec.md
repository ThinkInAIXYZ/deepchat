# MCP Startup Lifecycle Stabilization

Status: Implemented

## Issue

An enabled remote MCP server can appear stopped or failed during application startup and work after
a manual restart. A direct connection with the same configuration succeeds, and startup logs can
show a successful connection while the settings page still projects only a stale boolean status.

## Root Cause

Proxy initialization is fire-and-forget, so MCP startup has no explicit readiness dependency on the
network configuration it consumes. The main process already publishes a detailed MCP lifecycle,
but the renderer client narrows the event to `isRunning`, and initial settings hydration queries only
that boolean. Failed clients are removed immediately, so diagnostics opened after the event also
lose the terminal lifecycle and its error.

Remote HTTP negotiation also used an eight-second probe with zero timeout retries. A transiently
slow router therefore turned a short `server/discover` timeout into a terminal failure even when the
same legacy endpoint responded normally later. One retry alone was still insufficient while each
attempt retained the same short timeout.

## Required Behavior

- Start MCP initialization only after the current proxy resolution attempt settles.
- Keep MCP initialization behind the main-window startup path; proxy resolution must not block
  window creation.
- Preserve failed inactive clients until an explicit restart or stop so diagnostics retain their
  terminal state.
- Expose lifecycle status and the bounded last error through MCP diagnostics.
- Hydrate renderer server state from diagnostics and consume the complete lifecycle event.
- Render `connecting`, `timeout`, and `retrying` as starting; render `failed` as error.
- Preserve existing authentication precedence and manual toggle behavior.
- Give HTTP negotiation 20 seconds per probe and retry one timeout before failing the connection.

## Non-Goals

- Arbitrary fixed startup sleeps.
- Unbounded automatic retries.
- Treating an HTTP timeout as proof that a server is legacy.
- Retrying authentication or invalid configuration failures.
- Changing general MCP request, startup-soft, hard-connection, or transport timeouts.

## Tasks

- [x] Add an awaitable proxy readiness snapshot and use it before MCP initialization.
- [x] Preserve terminal MCP client diagnostics after startup failure.
- [x] Extend diagnostics and renderer state with lifecycle/error data.
- [x] Allow one bounded SDK negotiation retry for transient HTTP probe timeouts.
- [x] Add focused main-process, store, and component regressions.
- [x] Run renderer, MCP, architecture, and static checks.

## Validation

- MCP initialization waits for the proxy resolution already started during main-process bootstrap.
- A settings page mounted during connection shows starting instead of stopped.
- A settings page mounted after failure shows error and the retained failure message.
- A later successful manual restart replaces the failed client and clears the error.
- An HTTP probe gets up to two 20-second attempts within the existing startup budget; repeated
  timeouts still fail.

Focused MCP, startup-boundary, proxy, renderer-store, and component suites passed. Formatting,
i18n validation, lint, and node type checking passed. Web type checking remains blocked by the
pre-existing readonly Monaco theme tuple mismatch in `MarkdownRenderer.vue`.
