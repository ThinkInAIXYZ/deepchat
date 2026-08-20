# ACP Terminal Authentication Specification

> Status: implemented. Tracks [#2144](https://github.com/ThinkInAIXYZ/deepchat/issues/2144).
> This document is authoritative for the terminal-authentication slice of
> `docs/features/acp-v1-reliability/`.

## Context

DeepChat can start ACP v1 agents, initialize a connection, preserve the returned `authMethods`, and
execute agent-requested terminal commands. It cannot complete the separate interactive terminal
login flow defined by ACP. The normal process initializer currently advertises filesystem and
terminal capabilities, but omits `clientCapabilities.auth.terminal`; an agent therefore cannot
advertise a `terminal` authentication method to the normal product flow.

The missing product path affects both Registry agents and manual agents. A user with credentials
already stored by an agent can create sessions, while a first-time user receives an authentication
failure without an actionable login surface.

The current repository already contains the required foundations:

- `@agentclientprotocol/sdk` is `0.16.1` and includes the v1 `AuthMethodTerminal` and
  `clientCapabilities.auth.terminal` types.
- `buildClientCapabilities` already accepts `enableTerminalAuth`.
- `AcpProcessHandle` already retains `authMethods` from `initialize`.
- `AcpLaunchSpecService` and `AcpProcessManager` already resolve Registry and manual launch specs and
  start the protocol process without a shell.
- `node-pty` and `@xterm/xterm` are already dependencies.
- Typed ACP terminal routes/events exist, but their old shell-injection helper is not connected to a
  renderer product flow and is not safe to reuse unchanged.

No new dependency or ACP SDK upgrade is required. The feature is implementable on the current
`dev` branch.

## Protocol Sources and Correction

The normative references are:

- [ACP v1 authentication](https://agentclientprotocol.com/protocol/v1/draft/authentication)
- [Terminal Authentication RFD](https://agentclientprotocol.com/rfds/auth-methods)
- [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)

Terminal authentication is currently a Preview capability carried by the v1 draft schema. The
installed TypeScript SDK still marks the relevant generated types as unstable, so the feature must
remain isolated behind capability negotiation and protocol-shaped tests.

The implementation intentionally corrects one requirement in issue #2144: after a terminal login
process succeeds, DeepChat **must not** call `authenticate` with the terminal method ID. ACP defines
terminal authentication as an out-of-band flow:

1. initialize and receive a `terminal` auth method;
2. run the configured agent program interactively with the method's additional arguments and
   environment;
3. treat only exit status `0` as success;
4. reconnect and reinitialize the ACP agent;
5. retry the operation that received `auth_required`.

`authenticate({ methodId })` remains valid only for an `agent` auth method, including a method with
no explicit `type` discriminator.

## Goals

- Advertise `clientCapabilities.auth.terminal=true` only when the bundled desktop runtime can
  direct-spawn and present the interactive login flow.
- Preserve and expose all returned authentication methods without treating their presence as proof
  that authentication is required.
- Convert ACP error code `-32000` into a typed, actionable auth-required state.
- Let the user select among multiple methods and complete `agent` or `terminal` authentication.
- Run terminal authentication with the exact materialized launch command used by the live ACP
  connection, base arguments followed by method arguments, and method environment overriding the
  base environment.
- Reconnect after successful terminal login and retry one blocked session preparation exactly once.
- Handle cancellation, non-zero exit, process failure, stale challenges, window closure, and app
  shutdown without leaking processes or retrying unexpectedly.
- Apply the same behavior to Registry and manual agents without agent-specific branches.

## Non-Goals

- Do not add MiniMax Code or any other agent as a DeepChat-specific built-in. Discovery remains an
  ACP Registry concern.
- Do not implement ACP v2.
- Do not parse terminal output to infer success. ACP defines the exit status as the interoperable
  signal.
- Do not collect or persist credentials in DeepChat. The interactive agent process owns them.
- Do not productize the legacy `env_var` auth descriptor in this change. It is rendered as
  unsupported with guidance to use the existing manual environment override.
- Do not automatically choose a method when the agent advertises more than one supported method.
- Do not automatically replay a user prompt. Only session preparation blocked before a prompt is
  eligible for the one-shot retry.
- Do not reuse `AcpTerminalManager`; it implements agent-to-client `terminal/*` requests inside an
  ACP session, not the client-owned out-of-band authentication process.

## Ownership

Direct ACP execution remains owned by `AcpRuntimeOwner`, `AcpAgentRuntime`, and
`AcpAgentInstance`. `AcpProvider` remains a compatibility adapter and must delegate authentication
to the shared runtime instead of adding a second flow.

```text
NewThreadPage / AcpSettings / AcpAuthDialog
                    |
              typed acpAuth routes
                    |
              AcpRuntimeOwner
                    |
             AcpProcessManager
              /             \
  live ACP connection   AcpTerminalAuthRunner
              \             /
             reconnect + reinitialize
                    |
          retry session preparation once
```

Only one new runtime unit is justified: `AcpTerminalAuthRunner`, a narrow PTY lifecycle wrapper.
Challenge state, method validation, connection replacement, and retry eligibility stay in
`AcpProcessManager` and the existing session/runtime layers.

The unused shell-injection behavior in `AcpInitHelper` must be retired or reduced to the new direct
PTY runner. DeepChat must not retain two competing interactive ACP launch paths.

## Capability Negotiation

`AcpProcessManager` receives an injected `terminalAuthAvailable` capability. Production composition
sets it only after the direct PTY runner and typed renderer surface are registered successfully;
tests can explicitly set it to `false`.

```typescript
buildClientCapabilities({
  enableFs: true,
  enableTerminal: true,
  enableTerminalAuth: terminalAuthAvailable
})
```

Invariants:

- `auth.terminal` is advertised during `initialize`, before an agent can return terminal methods.
- The capability describes implemented client behavior; it is not enabled only after a login has
  already completed.
- If the runner cannot be constructed, DeepChat omits the capability and fails closed.
- Remote or headless callers may observe an auth-required state, but cannot start an interactive
  terminal flow without a live local renderer caller.
- Agent-requested `terminal/*` support and terminal-auth support remain separate capabilities and
  code paths.

## Runtime Auth Model

Authentication state is runtime-derived and scoped by `(agentId, canonicalWorkdir,
launchSignature)`. It is not persisted as an account truth because ACP does not expose an
authenticated-state query and agents may invalidate credentials independently.

```typescript
type AcpAuthMethodView = {
  id: string
  name: string
  description?: string
  type: 'agent' | 'terminal' | 'unsupported'
}

type AcpAuthChallenge = {
  id: string
  agentId: string
  agentName: string
  workdir: string
  methods: AcpAuthMethodView[]
  origin: 'draft_session' | 'session_prepare' | 'settings_probe'
  sessionId?: string
}

type AcpAuthRunState =
  | 'required'
  | 'running'
  | 'reconnecting'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
```

Rules:

- Missing `type` is normalized to `agent`.
- `terminal` is supported only when the capability was advertised and the descriptor came from the
  current live handle.
- Legacy `env_var` and unknown discriminators are preserved for diagnostics but normalized to
  `unsupported` for product control flow.
- `authMethods.length > 0` means methods are available; only ACP error code `-32000` means an
  operation currently requires authentication.
- Challenges become stale when their connection exits, agent settings change, workdir changes, or
  `launchSignature` no longer matches.
- At most one auth run may exist for an agent/workdir pair. Repeating the same challenge returns its
  current state to the owning renderer; a different challenge for the same scope is rejected.

## Launch Materialization

The protocol connection and terminal-auth process must share one materialization function. Extract
the existing command rewrite, environment merge, PATH handling, Registry/toolchain settings, user
override, and cwd validation from `spawnAgentProcess` into a pure result:

```typescript
type AcpMaterializedLaunch = {
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}
```

The immutable materialized launch snapshot and its separate launch signature are stored on the
initialized process handle. A terminal challenge uses that internal snapshot rather than exposing
it to the renderer or resolving settings again, which prevents a time-of-check / time-of-use change
between `initialize` and login.

For a selected terminal method, the runner executes the equivalent of:

```typescript
pty.spawn(materialized.command, [...materialized.args, ...(method.args ?? [])], {
  cwd: materialized.cwd,
  env: { ...materialized.env, ...(method.env ?? {}) }
})
```

The preview command shown to the user may be shell-escaped for display only. It must never be fed
back to a shell. The method cannot replace `command`, and neither arguments nor environment values
are interpolated.

Environment values and PTY output must not enter ordinary info logs. Diagnostics may record key
names, argument counts, process IDs, exit status, and bounded error text, but not credential values
or unredacted terminal transcripts.

## Authentication Flows

### Detecting Auth Required

`AcpSessionManager` identifies `RequestError.code === -32000` before its existing resume/load/new
fallback logic. Auth-required errors must not be swallowed as an ordinary resume/load failure and
must not cause a fallback `session/new` call.

The session layer creates an `AcpAuthChallenge` from the current process handle and returns an
actionable state to the renderer. A newly created local draft remains reusable; no remote ACP
session has been created yet.

### Agent Method

For `type='agent'` or an omitted type:

1. validate the selected ID against the current handle's auth methods;
2. call `connection.authenticate({ methodId })` on the existing ACP connection;
3. mark the auth run successful only when the request succeeds;
4. retry eligible session preparation once on the same connection;
5. stop if the retry again returns `auth_required` or any other error.

### Terminal Method

For `type='terminal'`:

1. validate caller ownership, challenge freshness, method ID, type, and launch signature;
2. keep the existing protocol connection alive while a separate PTY process runs;
3. direct-spawn the materialized command with base args plus method args and the merged env;
4. stream PTY output only to the renderer that started the run and forward bounded user input;
5. cap each PTY run at ten minutes; on timeout, cancellation, window closure, app shutdown, missing
   exit status, signal termination, or non-zero exit, terminate the PTY tree and do not retry;
6. on exit status `0`, dispose the old ACP process handle;
7. start a fresh connection with the same agent/workdir and run `initialize` again;
8. do **not** call `authenticate` with the terminal method ID;
9. retry eligible session preparation once;
10. stop after that retry regardless of outcome, preventing authentication loops.

If reconnect fails, the run ends in `failed`; a zero terminal exit alone must not be reported as a
usable ACP connection.

### Retry Contract

The existing `sessions.ensureAcpDraft` path returns a discriminated result:

```typescript
type EnsureAcpDraftResult =
  | { status: 'ready'; session: SessionWithState }
  | { status: 'auth_required'; session: SessionWithState; challenge: AcpAuthChallenge }
```

After an auth route returns `succeeded`, `NewThreadPage` invokes the same idempotent draft ensure
operation once. It reuses the local draft and performs the normal resume/load/new decision against
the refreshed connection. The renderer must not loop automatically when the retry fails.

This slice automatically retries only the new-thread draft preparation path. An existing session can
recover after authentication from ACP settings and a subsequent user action, but DeepChat must not
automatically replay a prompt that may already have been handed to the agent.

## Typed Routes and Events

Add an auth-specific contract rather than exposing raw ACP payloads to the renderer:

- `acpAuth.inspect`: initialize or reuse a handle and return renderer-safe methods/status.
- `acpAuth.start`: select a method and run agent or terminal authentication.
- `acpAuth.input`: send bounded input to the caller-owned PTY run.
- `acpAuth.cancel`: cancel the caller-owned run.
- `acpAuth.status`: recover current state after a settings view remount.
- `acpAuth.output`: targeted PTY output event with `runId` and bounded data.
- `acpAuth.stateChanged`: targeted lifecycle event with no environment or transcript data.

Every mutation route must use `RouteContext` to bind the run to the initiating `webContentsId`.
Input, cancel, and output delivery must reject or ignore a different renderer. A destroyed initiating
window cancels its active PTY run.

The existing global `acpTerminal.input/kill` singleton contract must not remain as an unscoped path.
It is either migrated to the run-ID/caller-owned auth contract or removed after all references are
updated.

## UI/UX

The primary onboarding surface is `NewThreadPage`, where the user has already selected an ACP agent
and a valid workdir. `AcpSettings` also exposes `Check sign-in` on installed Registry and manual
agent cards; when no configured or reusable workdir exists, the runtime uses its constrained ACP
temporary workdir.

Before:

```text
+----------------------------------------------------+
| Agent: MiniMax Code      Workspace: /work/project  |
|                                                    |
| Session preparation fails; no actionable UI.       |
+----------------------------------------------------+
```

After an auth-required response:

```text
+----------------------------------------------------+
| MiniMax Code needs sign-in                         |
| Choose how to authenticate before starting chat.   |
| Method: [Log in from terminal                 v]    |
|                            [Open terminal] [Cancel] |
+----------------------------------------------------+
```

Interactive terminal:

```text
+----------------------------------------------------+
| Sign in to MiniMax Code                       [x]  |
|----------------------------------------------------|
| $ interactive agent output...                      |
| >                                                  |
|----------------------------------------------------|
| Running                          [Cancel sign-in]   |
+----------------------------------------------------+
```

UX rules:

- If exactly one supported method exists, preselect it; otherwise require an explicit selection.
- Unsupported/legacy methods remain visible but disabled with a concise explanation.
- Display `Signing in`, `Reconnecting`, `Ready`, `Cancelled`, and `Failed` as distinct states.
- Closing the dialog while the PTY is running cancels the process.
- A successful terminal exit displays `Reconnecting` until the new ACP initialization succeeds.
- Do not label the user authenticated merely because `initialize` returned auth methods.
- User-facing copy uses vue-i18n and the existing compact settings/onboarding visual language.

## Compatibility and Failure Behavior

- Registry and manual agents use the same resolved launch pipeline.
- Existing pre-authenticated agents continue directly to session preparation.
- Agents that expose only `agent` auth continue to use ACP `authenticate` without a PTY.
- Agents that do not advertise auth methods retain the current error path, augmented with a clear
  diagnostic that no supported method was supplied.
- Capability-disabled tests must prove no terminal method can enter product control flow.
- Updating an agent command, args, environment, installation, or workdir invalidates outstanding
  challenges and active warm handles through the existing launch-signature refresh path.
- Non-ACP providers and agent-requested terminal operations are unchanged.
- MiniMax Code (`mcode acp`) is a manual interoperability sample until it is available through the
  official ACP Registry; no special source code or migration is added for it.

## Acceptance Criteria

- A capable desktop initialization sends `clientCapabilities.auth.terminal=true`; an injected
  unavailable runner omits it.
- Terminal auth methods returned by `initialize` are present in a renderer-safe auth challenge.
- ACP error code `-32000` from resume, load, or new session stops fallback and produces
  `auth_required`.
- Selecting a terminal method direct-spawns the exact live command, appends method args to base
  args, applies method env last, preserves cwd, and never invokes a shell.
- DeepChat never calls ACP `authenticate` for a terminal method.
- Exit `0` disposes the old connection, reconnects, reinitializes, and retries session preparation
  once.
- Non-zero exit, missing exit status, cancellation, caller destruction, stale challenge, reconnect
  failure, and second auth-required result do not retry.
- Multiple supported methods require user selection and the selected ID is revalidated in main.
- Only the initiating renderer can read output, send input, or cancel the run.
- No terminal transcript or auth environment value is persisted or written to ordinary logs.
- Registry and manual agents share the same implementation; no MiniMax-specific branch exists.
- Relevant main and renderer regression tests pass on macOS, Windows, and Linux CI targets.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Preview schema changes in a later SDK | Keep schema handling localized, capability-gated, and covered by descriptor-shape tests |
| Shell injection through agent args | Direct `node-pty.spawn(command, args)` only; display strings are never executed |
| A settings edit changes the binary before login | Bind challenges to the immutable live launch signature and reject stale runs |
| Multiple windows race or read terminal output | Bind every run and event to the initiating `webContentsId` |
| Resume/load fallback hides auth required | Match numeric error code before fallback and surface one typed challenge |
| Exit zero but the new connection is unusable | Report success only after reconnect and `initialize` complete |
| Automatic retry loops | Close the resolved challenge before one explicit draft retry; a repeated auth-required response remains actionable but is not retried again |
| Secrets leak through logs | Log metadata only; never log env values or PTY transcripts |
