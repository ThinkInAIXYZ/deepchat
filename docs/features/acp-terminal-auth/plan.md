# ACP Terminal Authentication Implementation Plan

## Objective

Implement the protocol-correct terminal-authentication flow in
[`spec.md`](./spec.md) for Registry and manual ACP agents, with direct process execution, scoped PTY
ownership, reconnect/reinitialize behavior, and a one-shot session preparation retry.

Implementation owns the current feature branch. Validation is implementation-first: existing checks
may run during development, but durable tests are selected and added after the behavior is complete.

## Ownership Boundary

- `src/main/agent/acp/runtime/acpProcessManager.ts`: capability advertisement, immutable launch
  snapshot, method validation, auth run serialization, connection replacement, and auth challenge
  lifecycle.
- `src/main/agent/acp/runtime/acpSessionManager.ts`: numeric `auth_required` detection before
  resume/load/new fallback and retry eligibility.
- `src/main/agent/acp/instance/*`: expose `auth_required` without duplicating authentication logic.
- `src/main/agent/acp/auth/acpTerminalAuthRunner.ts`: replace the unused shell-injection path with a
  narrow direct PTY auth runner.
- `src/shared/contracts/*` and `src/renderer/api/*`: renderer-safe auth routes/events and client.
- `src/renderer/src/pages/NewThreadPage.vue` and `src/renderer/settings/components/AcpSettings.vue`:
  onboarding/auth-required entry points and one-shot retry.
- A small shared renderer component owns the method chooser and xterm dialog; it contains no launch
  or protocol decisions.
- `src/main/provider/providers/acpProvider.ts` delegates compatibility actions to the shared runtime.

## Plan

### 1. Align Capability and Auth Types

- [x] Add renderer-safe auth method, challenge, run-state, and draft-result types without exposing raw
      SDK objects or environment values.
- [x] Inject `terminalAuthAvailable` into ACP runtime composition and pass it to
      `buildClientCapabilities`.
- [x] Normalize missing auth type to `agent`, `terminal` to supported terminal auth, and legacy or
      unknown types to `unsupported`.
- [x] Add numeric `RequestError.code === -32000` detection shared by session preparation paths.
- [x] Completion: initialization advertises no capability beyond the constructed product surface,
      and auth-required can be represented without parsing error messages.

### 2. Share the Materialized Launch

- [x] Extract command rewrite, args, environment, PATH, Registry/toolchain settings, cwd validation,
      and signature generation from protocol spawning into one materialization function.
- [x] Store an immutable materialized launch snapshot on each initialized handle.
- [x] Keep environment values redacted from logs and renderer payloads.
- [x] Make settings or installation changes invalidate challenges through the existing launch
      signature refresh path.
- [x] Completion: protocol and auth processes consume the same verified command, base args, env, and
      cwd snapshot.

### 3. Implement the Direct PTY Auth Runner

- [x] Replace or retire the unused `AcpInitHelper` shell-command injection and global active-shell
      singleton.
- [x] Implement `AcpTerminalAuthRunner` with direct `node-pty.spawn(command, args)` execution,
      caller-owned input, targeted output, exit observation, cancellation, and shutdown cleanup.
- [x] Append method args after base args and apply method env after the materialized base env.
- [x] Treat only exit status `0` as terminal-flow success; do not inspect output patterns.
- [x] Bound input/output event payloads and cancel the process when the initiating renderer is
      destroyed.
- [x] Completion: no terminal-auth path invokes a shell or accepts a command from the auth
      descriptor.

### 4. Orchestrate Agent and Terminal Authentication

- [x] Add current-handle method validation, per-agent/workdir serialization, stale challenge
      rejection, and a one-shot draft retry boundary.
- [x] For `agent` methods, call `connection.authenticate({ methodId })` and keep the connection.
- [x] For `terminal` methods, keep the protocol connection during interaction, then on exit `0`
      dispose it, reconnect, and reinitialize without calling `authenticate`.
- [x] Fail the auth run if reconnect/reinitialize fails; never report terminal exit alone as ready.
- [x] Ensure cancellation, non-zero exit, signal termination, app shutdown, and a second
      `auth_required` result consume no additional retry.
- [x] Make the compatibility ACP provider delegate to this shared orchestration.
- [x] Completion: exactly one runtime implementation serves direct and compatibility ACP callers.

### 5. Surface Auth Required and Retry Session Preparation

- [x] Stop resume/load/new fallback immediately on numeric `auth_required` and create a typed
      challenge from the current handle.
- [x] Preserve ACP instance/session state so a reusable local draft can expose `auth_required`
      without claiming a remote session exists.
- [x] Change `sessions.ensureAcpDraft` to return `ready` or `auth_required` as a discriminated result.
- [x] After successful authentication, invoke the same idempotent draft/session preparation once;
      stop on any retry failure.
- [x] Do not replay a user prompt as part of authentication recovery.
- [x] Completion: a first-time user can authenticate and reach a ready ACP draft without manually
      switching agents or restarting DeepChat.

### 6. Add Typed IPC and UI

- [x] Add caller-scoped `acpAuth.inspect/start/input/cancel/status` routes and targeted
      `output/stateChanged` events.
- [x] Remove or migrate the unscoped `acpTerminal.input/kill` routes after updating every reference.
- [x] Add an ACP auth dialog with method selection, xterm output/input, cancellation, reconnecting,
      success, and failure states.
- [x] Integrate the compact auth-required card into `NewThreadPage` and `Check sign-in` into Registry
      and manual cards in `AcpSettings`.
- [x] Add vue-i18n copy and regenerate i18n types; do not add raw user-visible strings.
- [x] Completion: multiple methods are understandable and only the initiating renderer owns the
      terminal interaction.

### 7. Whole-Change Review and Durable Regression Protection

- [x] Review capability truthfulness, method discrimination, launch snapshot freshness, environment
      precedence, shell avoidance, process-tree cleanup, renderer ownership, retry bounds, and log
      redaction against the spec.
- [x] Add focused main tests for capability off/on, numeric auth detection before fallback, agent
      authenticate, terminal non-authenticate, exact direct launch, env precedence, reconnect,
      cancellation, stale challenge, concurrent starts, caller destruction, and one-shot retry.
- [x] Add renderer tests for single/multiple/unsupported methods, terminal states, cancellation,
      auth-required draft retry, and settings probe behavior.
- [x] Run a manual interoperability matrix with one fake deterministic ACP agent and, when locally
      available, `mcode acp`; keep MiniMax observations out of product conditionals.
- [x] Remove temporary probes, terminal transcripts, and implementation-coupled tests.
- [x] Completion: acceptance criteria have durable evidence without broad unrelated coverage.

### 8. Quality Gates

- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run the smallest relevant main ACP and renderer suites, including the new auth tests.
- [x] Confirm normal DeepChat agents, pre-authenticated ACP agents, and ACP agent-requested terminals
      retain existing behavior.
- [x] Update this plan's checkboxes only when the corresponding implementation slice and its selected
      validation are complete.
