# ACP v1 Reliability Specification

Status: active. Direct `kind=acp` execution belongs to `AcpAgentRuntime` and `AcpAgentInstance`.
`AcpProvider` serves only `kind=deepchat + providerId=acp` compatibility. The remaining reliability
and real-agent validation scope is tracked in this goal’s implementation records.

[Terminal authentication](../acp-terminal-auth/spec.md) is implemented and authoritative for
authentication method selection, direct PTY execution, caller ownership, reconnect, and one-shot
session-preparation retry. It does not establish completion of logout or the broader session
lifecycle and interoperability scope.

## Product Contract

DeepChat launches Registry and manually configured ACP agents, negotiates their capabilities, and
exposes supported authentication and session operations through typed application boundaries.
Optional methods are enabled by the initialized agent’s capabilities, never by its display name
or a guessed package version.

DeepChat records remain the durable source of truth for local conversations. An agent’s remote
session list is a workspace-scoped resource catalog. Importing or resuming a remote session must
not duplicate local messages, overwrite a user-edited title, or silently write to other remote
sessions.

Users must be able to understand readiness, authentication requirements, launch failures, and
session recovery. Diagnostics identify the failing protocol boundary without exposing credentials
or introducing agent-specific product branches.

## Ownership

- `src/main/agent/acp/` owns direct ACP process, connection, session, authentication, terminal, and
  state adaptation behavior.
- `src/main/provider/providers/acpProvider.ts` delegates compatibility requests to the shared ACP
  runtime.
- Main owns capability checks, process cleanup, filesystem authorization, and remote operations.
- Renderer clients and typed routes/events expose supported actions and normalized state.
- Session persistence owns local messages and remote-session associations; renderer state is not
  an independent persistence authority.

## Capability And Protocol Requirements

The table defines the complete reliability acceptance contract. It is not a claim that every
operation has completed product and real-agent validation.

| Area                   | Required behavior                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport and launch   | Use JSON-RPC over the selected agent subprocess transport. Prefer the Registry launch specification; record local/global version differences in diagnostics. Initialization, authentication, and diagnostic probes have timeouts and owned-process cleanup. Filter MCP transports by the ACP agent’s capabilities.                                                         |
| Initialization         | Send the supported protocol version, client information, and actual client capabilities. Preserve agent information, authentication methods, and capability snapshots. Close unsupported protocol connections and surface a useful error.                                                                                                                                  |
| Authentication         | Missing method type means `agent` and calls `authenticate({ methodId })`. A supported `terminal` method runs the materialized agent command interactively, then reconnects and reinitializes after exit status `0`; it never calls `authenticate`. Advertise terminal auth only when the desktop flow is available. Logout requires the advertised auth logout capability. |
| `session/new`          | Create a remote session only when needed for a local conversation. Pass the authorized `cwd` and compatible MCP servers. Preserve returned modes/models/config options and associate the remote identity with the local conversation.                                                                                                                                      |
| `session/load`         | Require `loadSession`. Register or buffer updates before history replay, stage the replay, convert it to DeepChat message/block records, and persist it idempotently.                                                                                                                                                                                                      |
| `session/resume`       | Require the resume capability. Resume an existing association without treating remote state as permission to replace local message history.                                                                                                                                                                                                                                |
| `session/close`        | Require the close capability and explicit user intent. Local close/delete detaches the association by default; stopping a turn uses `session/cancel`.                                                                                                                                                                                                                      |
| Additional directories | Keep one `cwd` unless additional workspace roots are explicitly supported. Send only absolute paths and only when the corresponding capability exists.                                                                                                                                                                                                                     |
| Session catalog        | Require the list capability; support `cwd` filtering and cursor pagination. Identify remote records by `agentId + canonicalWorkdir + remoteSessionId`. Repeated import reuses the same local association.                                                                                                                                                                  |
| Prompt turns           | Send the current user turn and capability-supported content. Do not repeat the full local history or inject temperature/max-token prose. Apply system context once when a local conversation binds to a new remote session. Cancellation targets the active turn.                                                                                                          |
| Content                | Preserve text and resource links. Gate image, audio, and embedded resources by prompt capabilities. Preserve structured output metadata and provide clear fallbacks for unsupported presentation.                                                                                                                                                                          |
| Tool progress          | Preserve tool-call identity, updates, parameters, results, locations, raw metadata, terminal output, and diffs. Ordinary progress must not be presented as a permission request.                                                                                                                                                                                           |
| Permission requests    | Only `session/request_permission` enters the permission flow. Reuse DeepChat’s permission surface; cancellation, timeout, stale requests, and missing resolvers settle without leaving an orphaned overlay.                                                                                                                                                                |
| Filesystem             | Advertised read/write capabilities correspond to real handlers. Preserve absolute-path, session-workdir, binary, size, and write-authorization checks. Line handling is one-based.                                                                                                                                                                                         |
| Terminals              | Execute `command` and `args` directly unless the requested executable is itself a shell. Resolve `env` and `cwd` through the session boundary. Keep the latest output within `outputByteLimit` without splitting UTF-8 characters. Kill/release are idempotent, and already rendered output may remain visible after release.                                              |
| Plans                  | Each plan update replaces the current plan entries instead of appending duplicate plans to the transcript.                                                                                                                                                                                                                                                                 |
| Modes                  | Preserve initial modes, mode changes, and current-mode updates. Prefer a config-option equivalent in UI when available while keeping legacy mode compatibility.                                                                                                                                                                                                            |
| Config options         | Normalize state after initialize/new/load/resume and later updates. Failed changes retain or recover the last authoritative state.                                                                                                                                                                                                                                         |
| Slash commands         | Retain `available_commands_update`, including notifications received before session listener registration. Suggestions derive from session state; execution sends ordinary prompt text.                                                                                                                                                                                    |
| Usage                  | Preserve available usage/cost/token metadata in diagnostics and turn metadata without fabricating missing values.                                                                                                                                                                                                                                                          |
| Session information    | Update remote association metadata from title, update-time, and `_meta` notifications. Never replace a user-edited local title.                                                                                                                                                                                                                                            |
| Extensions             | Preserve supported `_meta` and diagnostic extension data. Unknown updates must not crash the session. Custom methods retain their protocol prefix and capability boundary.                                                                                                                                                                                                 |
| Experimental methods   | Capability-gated fork support belongs in diagnostics until independently supported by the normal chat flow. It is not a prerequisite for ordinary conversations.                                                                                                                                                                                                           |

## Session And Notification Invariants

- Imported remote messages are converted into local message/block format before persistence.
- Stable fingerprints prevent duplicate messages when import or replay repeats.
- Early notifications remain ordered across session preparation and listener registration.
- Notification buffering has a TTL and entry bound; discarded notifications are diagnosable.
- A process crash preserves a recoverable local/remote association.
- Remote catalog synchronization updates association metadata without creating duplicate local
  conversations or overwriting local edits.
- Numeric authentication-required errors stop session fallback and enter the typed auth flow.
- Successful authentication retries only blocked pre-prompt session preparation, at most once.
- Local session removal never implicitly performs bulk remote deletion or synchronization.

## Interoperability Matrix

| Agent sample                    | Required paths                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DimCode                         | Workspace session list/import, repeated-import deduplication, new/resume/close when advertised, early slash-command updates, modes, and config options.                                                                  |
| Claude Code ACP                 | Initialization, authentication-required and authenticate flows, timeout/process cleanup, and capability-filtered MCP transport handoff.                                                                                  |
| Codex ACP                       | Registry launch selection, local/global version drift diagnostics, advertised auth methods, and graceful behavior when session listing is unavailable.                                                                   |
| Deterministic local ACP fixture | Capability combinations, early notifications, direct terminal auth, reconnect failures, cancellation, stale challenges, and one-shot retry.                                                                              |
| Additional local agents         | Include only when an exact executable/package is available; record the resolved command, version, capabilities, and outcome. An unavailable optional sample does not imply protocol support or block unrelated coverage. |

Record package and executable versions at the time of each interoperability run. Registry contents
come from `resources/acp-registry/registry.json`.

## Non-Goals And Constraints

- No ACP v2 implementation or undeclared protocol capability.
- No hard-coded behavior for a particular agent; named agents are compatibility samples.
- No change to non-ACP provider prompt, MCP, permission, or terminal behavior.
- DeepChat host MCP negotiation, Apps, Tasks, and authorization extensions do not wrap or
  reinterpret MCP connections owned by an ACP agent. Handoff follows that agent’s declared
  `mcpCapabilities`.
- No automatic expansion of filesystem access; session workdir and existing security policy remain
  authoritative.
- No proactive bulk remote writes or bidirectional session synchronization.
- Renderer-main operations use typed routes, typed events, and renderer API clients. The retired
  legacy presenter transport is not an extension point.
- User-visible strings use i18n, and diagnostics retain the existing Settings/ChatStatusBar density.
- Code, comments, types, commits, and technical documentation use English.

## Validation Contract

Retain focused regression coverage for capability truthfulness, authentication ownership and
cleanup, ordered notification delivery, idempotent import, recovery, bounded terminal output,
filesystem authorization, and user-visible state. Existing auth suites cover direct terminal
launch, reconnect, timeout, renderer closure, stale responses, and caller isolation.

The open reliability scope requires the relevant ACP main/provider/renderer suites and real-agent
matrix, together with format, i18n, lint, and type checks. A completed terminal-authentication
implementation alone does not close those broader validation requirements.

## Protocol References

- [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- [Initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [Authentication](https://agentclientprotocol.com/protocol/v1/authentication)
- [Session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [Session list](https://agentclientprotocol.com/protocol/v1/session-list)
- [Prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [Content](https://agentclientprotocol.com/protocol/v1/content)
- [Tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [Filesystem](https://agentclientprotocol.com/protocol/v1/file-system)
- [Terminals](https://agentclientprotocol.com/protocol/v1/terminals)
- [Plans](https://agentclientprotocol.com/protocol/v1/agent-plan)
- [Modes](https://agentclientprotocol.com/protocol/v1/session-modes)
- [Config options](https://agentclientprotocol.com/protocol/v1/session-config-options)
- [Slash commands](https://agentclientprotocol.com/protocol/v1/slash-commands)
- [Extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)
- [Transports](https://agentclientprotocol.com/protocol/v1/transports)
