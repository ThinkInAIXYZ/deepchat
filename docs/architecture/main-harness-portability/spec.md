# Main Host and Portable Harness Boundaries

> Superseded by the [dim Rust migration](../dim-rust-harness-migration/spec.md).
> The former TypeScript execution core and standalone fake-provider verifier have been retired.
> The remaining sections describe the historical boundary; current owners are dim Rust and the
> independent desktop ACP client.

Electron and the standalone Node host construct the same built-in Agent through
`src/main/agent/deepchat/harness/index.ts`. Turn, Run, permission waits, cancellation, pending inputs
and recovery belong to that runtime. The desktop host owns native capabilities, credentials,
database connections and client delivery.

## Module Responsibilities

```text
Desktop / CLI / Remote / Scheduler -> Session commands and queries -> AgentManager
                                                                      |-> Direct ACP
                                                                      +-> built-in Harness
                                                                              |
                                                      execution / persistence / output ports

Electron composition -> desktop adapters + production Harness
Node verification   -> temporary storage + scripted provider + same production Harness
```

| Owner | Responsibility |
| --- | --- |
| App composition | Select backends and adapters; open, migrate, reopen and close host resources. |
| Session and AgentManager | Own persistent Session identity, creation, dispatch, queries and deletion; resolve state through the owning backend. |
| Built-in Harness | Own hydrated instances, Turn/Run progression, interaction authority, cancellation and pending-input settlement. |
| Direct ACP | Own protocol processes, connections and ACP Sessions; compose its own resource dependencies. ACP-as-Provider supplies model capability to the built-in loop. |
| Execution adapters | Supply Provider, Tool, approval, Skill, Memory, plugin context, workdir and restricted CLI capabilities. The granting owner retains authority. |
| Persistence adapters | Supply Session, transcript, Tape, journal and pending-input operations using the current connection and existing transactions. |
| Output adapters | Project runtime facts into typed client events, internal updates, Desktop refresh and Sync activity; never advance or settle a Run. |

The core consumes neutral types and explicit ports. Electron, Vue, concrete storage drivers,
desktop services and desktop IPC contracts stay outside its transitive dependency graph, including
dynamic imports and public types. `shared/logger` and desktop handle types are host dependencies.
Generation settings consume injected model facts and settings; importing the parameter module
does not load Electron or create a user profile or provider cache.

## Runtime Guarantees

- IPC sender, transport identity, grant scope and the instance/run/controller/message fences
  determine authority. A stale operation cannot mutate a replacement instance. Runtime facts carry
  no host token, native handle or credential.
- Changed status publishes `sessions.status.changed`, `sessions.updated`, the internal status update
  and UI refresh in that order. Unchanged status with usage publishes only internally; unchanged
  status without usage and stale instances publish nothing. Sync keeps running/generating Sessions
  active until a non-active transition and does not wake for usage-only updates.
- Streams preserve request/revision identity, throttling, block order and terminal settlement.
  Client projections remove `providerReplayJson`; failed delivery cannot undo a committed fact.
  Snapshot blocks are live state and must be consumed synchronously or copied before return.
- Terminal messages append Tape facts before updating transcript and its cursor in one transaction.
  Claims and linked input facts settle atomically. One owner writes/recovers each profile, and
  maintenance reopen resolves the new connection. Recovery never automatically executes held
  historical input or replays a tool with an uncertain effect.
- IPC/CLI protocols and stored formats remain stable. List/pending-input reads do not create runtime
  state or consume inputs; closing a window does not cancel work held by another host consumer.

Detailed contracts: [runtime and hooks](../deepchat-agent-harness-boundaries/spec.md),
[Session persistence](../session-management.md), [Renderer ownership](../renderer-application-boundaries/spec.md)
and [Tool Surface compatibility](../tool-surface-virtualization/spec.md).

## Standalone Host Verification

`pnpm run test:harness:node` now runs `smoke:dim`: the actual pinned Rust host,
private desktop/storage plugins, local HTTP provider fixtures and persistent native content.
`pnpm run test:agent:eval` selects the [native agent suite](../../../test/main/agent/dim/runtimeIntegration.test.ts).
Prepare the managed runtime with `pnpm run installRuntime:dim` and build the pinned SDK host with
`pnpm run build:dim-host --dev`. CI installs Rust 1.98.1 and runs the same owners.
