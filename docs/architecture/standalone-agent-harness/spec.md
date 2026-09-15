# Standalone Agent Service Architecture

## Status

Proposed architecture. This document is the normative boundary for the first extraction. It does not
implement a service, change the current CLI protocol, or promise that every existing plugin is
available in headless mode.

## Context

DeepChat already has two client/service-shaped execution paths:

- DeepChat is a client of an external ACP agent. The ACP agent owns its agent loop, model requests,
  context, and tool execution; DeepChat maps the protocol to a session-facing UI and provides only
  explicitly advertised client capabilities.
- DeepChat's built-in agent currently executes inside the Desktop main process. Its Harness, model
  provider runtime, session state, and tools are composed by the application.

The second path must become an Agent Service with the same high-level responsibility as an ACP agent:
it owns the complete execution loop. Desktop and CLI become clients of that service. The goal is not
to wrap the current loop in an RPC and keep Desktop driving every intermediate step.

The existing backend seams support this direction. `DeepChatAgentBackendPort` covers built-in session
operations, while `DirectAcpSessionBackend` connects directly to `AcpAgentRuntime`. These are useful
client-facing seams, but the two runtimes must remain separate.

## Goal

Create a built-in DeepChat Agent Service that can run without the Desktop UI and owns:

1. provider selection, credentials access, model requests, streaming, and usage;
2. agent loop, context assembly, compaction, queueing, steering, and lifecycle;
3. tool catalog, authorization, scheduling, execution, cancellation, and result injection;
4. session state, transcript/Tape persistence, pending input, events, and recovery;
5. interaction and approval state, with a trusted client supplying user decisions when required.

The final product behavior is:

- Running the Desktop produces behavior indistinguishable from the current product for supported
  Desktop capabilities.
- CLI can perform basic headless agent operations while Desktop is not running, including creating or
  selecting a session, multi-turn conversation, observing events/results, cancellation, and supported
  interactive responses.
- This version does not implement a TUI, terminal scrollback UI, or an interactive CLI chat shell.
- Desktop-dependent capabilities such as CUA, browser preview, native window interaction, and similar
  plugins are explicitly capability-gated. They must report unavailable rather than silently succeeding.
- Unsupported plugins are not a reason to keep the model/agent/tool loop in Desktop.

## Non-goals

- No TUI, CLI scrollback, or interactive terminal chat UI in the first version.
- No TCP listener, remote service, multi-tenant daemon, container scheduler, or distributed worker.
- No requirement that the built-in service speak ACP internally.
- No requirement that external ACP agents pass through the built-in Harness.
- No merge of the direct ACP runtime into `DeepChatLoopEngine`.
- No simultaneous database split, schema redesign, or credential format redesign unless required by a
  verified compatibility blocker.
- No automatic approval, `--yes` bypass, fake renderer identity, or weaker caller policy for headless
  mode.
- No promise that every existing plugin works headlessly. The first supported set is declared and
  tested; Desktop-only capabilities remain unavailable outside Desktop.

## Terminology

- **Agent Service**: a complete agent execution unit that accepts client intent and owns the loop from
  model request through tool execution and final result. It can contain helper processes.
- **Built-in Agent Service**: the DeepChat-owned service backed by the extracted Harness and host
  adapters.
- **External ACP Service**: an agent process reached through ACP. Its runtime and tool policy belong to
  that agent.
- **Client**: Desktop, CLI, scheduler, remote runner, or another program that calls an Agent Service.
- **Harness**: the execution-semantic kernel inside the built-in service. It does not choose a
  transport, default user directory, or Electron API.
- **Host**: the composition layer that supplies provider, storage, credentials, MCP, process, file,
  skill, and optional Desktop capability adapters.
- **Protocol binding**: a mapping between client-facing operations and a service implementation, such
  as the DeepChat service binding or ACP binding.
- **Transport**: a message carrier used by a binding, such as in-process calls, process IPC, a Unix
  domain socket, or a Windows named pipe. ACP is a protocol binding, not a generic transport.

## Architecture

```text
                         Clients
       Desktop / CLI / scheduler / other runners
                             |
                 Client-facing Agent operations
                             |
             +---------------+----------------+
             |                                |
       DeepChat binding                   ACP binding
             |                                |
       Replaceable transport            ACP protocol
             |                                |
   Built-in DeepChat Agent Service    External ACP Agent Service
   +--------------------------------+  +-------------------------+
   | model requests                 |  | agent-owned loop        |
   | agent loop + context           |  | model + tools           |
   | tool scheduling + execution    |  | service-specific state  |
   | session + Tape + recovery      |  +-------------------------+
   | events + interaction policy    |
   +--------------------------------+
             |
      Host capability adapters
      provider / storage / MCP / process
      skills / credentials / optional Desktop
```

The built-in service is complete even when some tools execute in helper processes. MCP servers,
shell/PTY processes, sandboxes, and a registered Desktop capability can perform actual work outside
the service PID. The service remains the owner of admission, permission, cancellation, result
normalization, and durable recording.

### Built-in service execution invariant

After a client submits an accepted input, the service can independently perform:

```text
input -> context -> model request -> tool call -> tool execution
      -> tool result -> next model request -> final answer -> persistence/events
```

The client is not required to invoke the next step. A Desktop capability callback is an explicit
exception negotiated through the capability set, not a hidden dependency.

### External ACP invariant

The DeepChat client may connect directly to an external ACP service. ACP capabilities determine which
operations the client provides to the agent. Current ACP implementation advertises filesystem and
terminal capabilities and has a client-side PTY manager; filesystem support must be validated per
adapter and must not be inferred from terminal support.

Permission interaction is also asymmetric: the agent asks, the trusted DeepChat UI decides, and the
client sends the decision back. A client approval is not evidence that the client executed the tool.

## Ownership

| Concern | Built-in Agent Service | Client |
| --- | --- | --- |
| Model provider and credentials | Owns provider runtime, upstream calls, usage, credential access | Selects/configures through allowed operations |
| Agent loop and context | Owns loop, context, compaction, queue, steering, retries | Sends intent only |
| Tools | Owns catalog, policy, scheduling, cancellation, result injection | Observes; provides only explicitly registered capabilities |
| Session and recovery | Owns durable state, Tape/transcript, pending input, snapshot, event cursor | Owns a projection and reconnect state |
| Interaction/approval | Validates request and blocks/continues execution | Presents UI and supplies a trusted decision |
| Desktop-only capabilities | Marks unavailable unless a live capability lease exists | Owns native UI and optional capability implementation |

The client must not create a second provider, MCP, database, session runtime, or approval authority for
the same profile. One profile has one authoritative service owner.

## Client-facing contract

The contract is capability-oriented. The common minimum is:

- service identity, protocol version, health, and capabilities;
- session create/read/list/delete and allowed configuration updates;
- input submission, multi-turn send, pending queue, steering, and cancellation;
- session snapshot and durable result retrieval;
- bounded event subscription with epoch/cursor recovery;
- ordinary interaction response and permission/approval response through an authorized path;
- owned artifact/file references instead of arbitrary service filesystem paths.

This contract is not an attempt to expose every Harness method or make every ACP agent implement
DeepChat-specific Tape, queue, or management features. Unsupported capabilities return structured
`capability_unavailable` or an equivalent typed error.

The current backend/session-handle seams are migration inputs, not wire DTOs. Runtime instances,
callbacks, `AbortSignal`, database connections, Electron objects, and provider clients never cross
the process boundary.

## Communication

The first built-in service transports are:

1. direct/in-process adapter for migration and tests;
2. one local cross-process adapter, preferably framed bidirectional RPC over Unix domain sockets and
   Windows named pipes, without HTTP.

A process IPC or MessagePort adapter may be added for a client-owned child service. It is not a
replacement for a discoverable shared service. The transport can change without changing admission,
authorization, cancellation, idempotency, events, or error semantics.

The current HTTP-over-local-socket CLI contract is retained only as a compatibility adapter if needed;
it must forward to the same service admission path and must not create a second Agent runtime.

## Security and failure invariants

- Human and agent callers remain distinct. Invalid agent credentials never fall back to a human
  descriptor.
- CLI access remains deny-by-default and scoped by session/workspace, token lifetime, quota, and
  effect policy.
- Headless mode does not self-approve. Renderer-only approval remains renderer-only unless a separate,
  reviewed human approver capability is introduced.
- Disconnecting a client does not cancel an accepted run. Unapproved connection-bound mutations are
  cancelled or expire safely.
- Lost submission responses are not treated as proof of non-execution. Submission identity and
  queryable receipts are required before retrying side effects.
- Event buffers are bounded. Overflow, expired cursors, and service restarts produce an explicit
  resync path through an authoritative snapshot.
- A service restart does not replay expired authority, credentials, process handles, or uncertain
  external side effects.
- Clients cannot read arbitrary absolute service paths; artifacts are owned, bounded, and expiring.
- A missing Desktop capability is visible in the capability set and fails closed when invoked.

## Persistence and credentials

The first migration keeps the current schema and moves ownership rather than splitting the database.
The service owns schema creation/migration, all writes, session/Tape data, provider settings, memory,
cron, and configuration state that affects execution. Desktop-only window preferences may remain local
when they are not shared mutable service state.

Credentials are a production gate. The service accesses credentials through a host `CredentialStore`.
Existing Electron `safeStorage` ciphertext must be experimentally verified before migration. If a pure
Node host cannot read it, choose a reviewed compatibility helper, controlled reauthorization, or a
minimal credential helper; never fall back to plaintext or require the full Desktop to remain online.

## Capability classification for the first version

| Capability class | Headless CLI in first version | Desktop when connected |
| --- | --- | --- |
| Provider/model request | Required | Required |
| Agent loop, context, multi-turn state | Required | Required |
| Session/Tape/transcript/events | Required | Required |
| Text-oriented built-in tools | Required where host-safe and tested | Required |
| MCP/process/file tools | Only declared, bounded, and host-supported subset | Existing supported behavior |
| Skills/memory/hooks | Include only after service-host dependency audit | Existing supported behavior |
| CUA, browser preview, native window/desktop interaction | Not supported; explicit unavailable | Optional live capability adapter |
| OCR, voice, media, OAuth UI | Per-capability decision; no implied support | Existing supported behavior where available |
| External ACP agent | Direct ACP binding, independent of built-in loop | Existing direct ACP behavior |

The supported headless set is a release decision. An interface existing is not acceptance; each
capability must complete a real execution test without Desktop.

## Compatibility target

Desktop behavior is a compatibility constraint, not a later cleanup task. During extraction:

- keep existing renderer/preload boundaries and typed APIs;
- preserve observable message, status, event, queue, permission, Tape, and transcript semantics;
- map UI refresh callbacks to service state/event invalidation, then let Desktop refresh its projection;
- keep direct ACP behavior direct and preserve its capability negotiation;
- keep provider/ACP registry refreshes generated by normal builds;
- make fallback to an embedded service explicit and mutually exclusive with the standalone service owner.

## Acceptance criteria

1. A clean Node host can import the built-in service package without loading Electron, renderer code,
   application aliases, or unsupported native modules.
2. With Desktop never started, CLI connects to one service and completes a real multi-turn session with
   provider request, supported tool execution, final answer, durable transcript, and event observation.
3. A tool call can execute and feed its result into the next model request without a Desktop round trip.
4. Desktop running normally has no user-visible regression in supported existing behavior.
5. Desktop and CLI connected to the same profile see one authoritative session and no duplicate provider,
   MCP, database, or runtime owner.
6. Client disconnect/reconnect preserves accepted runs and recovers through snapshot/cursor semantics.
7. Unsupported CUA/browser/native capabilities fail explicitly and do not block supported headless work.
8. Invalid credentials, unauthorized scopes, fake human/renderer identity, self-approval, duplicate
   submissions, stale cursors, and uncertain side effects fail according to the security invariants.
9. Service restart and shutdown close child processes and persistence cleanly without replaying expired
   authority or uncertain external side effects.
10. The chosen Node/Electron/native-module versions and packaged artifacts pass independent import and
    runtime checks.

## Open decisions before implementation

- Exact package names and whether the first release is workspace-private or publishable.
- Exact wire encoding and framing library, after checking current dependencies.
- The initial supported headless tool/plugin allowlist.
- Whether ACP filesystem, terminal, OAuth, and media capabilities are included in the headless host.
- SafeStorage compatibility strategy and migration UX.
- Whether a separately reviewed terminal human approver is required; no `--yes` behavior is assumed.
