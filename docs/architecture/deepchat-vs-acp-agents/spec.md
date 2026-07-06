# DeepChat Agent vs ACP Agent Architecture

## Scope

This document compares two live execution paths:

- DeepChat Agent: in-process runtime owned by `AgentRuntimePresenter`.
- ACP Agent: external agent process accessed through `AcpProvider` and the ACP SDK.

It is not a roadmap. Only verified risks are listed.

## Ownership Model

| Area | DeepChat Agent | ACP Agent |
| --- | --- | --- |
| Runtime owner | DeepChat main process | External ACP process |
| State owner | DeepChat session/message/tape stores | ACP process owns agent state; DeepChat caches session metadata |
| Tool execution | DeepChat `ToolPresenter` | ACP agent decides through protocol callbacks |
| Permission UI | DeepChat runtime action blocks | ACP provider emits DeepChat permission events |
| Failure boundary | Same Electron main process | Separate process, but protocol promises must be settled |

## DeepChat Agent Path

Main files:

- `src/main/presenter/agentRuntimePresenter/index.ts`
- `src/main/presenter/agentRuntimePresenter/process.ts`
- `src/main/presenter/agentRuntimePresenter/dispatch.ts`
- `src/main/presenter/agentRuntimePresenter/messageStore.ts`
- `src/main/presenter/agentRuntimePresenter/pendingInputCoordinator.ts`

Flow:

```text
Renderer sendMessage
  -> AgentSessionPresenter
  -> AgentRuntimePresenter.processMessage or queued pending input
  -> context and tape view construction
  -> processStream
  -> dispatch tool calls or permission/question interactions
  -> message store and stream events
```

Important current behavior:

- Tape appends currently run in the Electron main process through synchronous SQLite calls.
- Pending input drain has single-flight cleanup and recovery for claimed rows.
- Tool output fitting does not rerun tools after side effects have already happened.

## ACP Agent Path

Main files:

- `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts`
- `src/main/presenter/llmProviderPresenter/acp/acpProcessManager.ts`
- `src/main/presenter/llmProviderPresenter/acp/acpSessionManager.ts`
- `src/main/presenter/acpClientPresenter/index.ts`

Flow:

```text
Renderer sendMessage
  -> AgentSessionPresenter
  -> AgentRuntimePresenter
  -> LLMProviderPresenter
  -> AcpProvider.coreStream
  -> ACP process prompt
  -> ACP content/tool/permission callbacks
  -> DeepChat stream events and action blocks
```

The ACP process boundary is useful, but it means every pending protocol callback must have a clear
settlement path. Permission requests were the missing path.

## Verified Issue

### ACP Permission Timeout

Status: fixed in this change.

Before the fix, `AcpProvider.registerPendingPermission()` stored a resolver in `pendingPermissions`
without a timeout. `AgentRuntimePresenter.clearActiveProviderPermissionsForSession()` only removed
the runtime map entry, so cancel/stop could drop DeepChat's handle without resolving the ACP
provider promise.

Fix:

- `AcpProvider` adds a 60-second permission timeout.
- Resolving, session cleanup, and provider cleanup clear the timeout.
- `AgentRuntimePresenter.clearActiveProviderPermissionsForSession()` now resolves active ACP
  provider permissions with `false` before removing them.

Issue record:

- [Architecture issue note](./issues/P0-1-acp-permission-timeout.md)
- [SDD issue spec](../../issues/acp-permission-timeout/spec.md)
- [GitHub issue #1881](https://github.com/ThinkInAIXYZ/deepchat/issues/1881)

## Rejected Findings

### Tape Write Ordering

Not retained. The reviewed code does not have a current multi-writer tape path. Adding a JavaScript
session lock would add state without fixing a demonstrated bug.

### Pending Input Deadlock

Not retained. The current coordinator and runtime drain code already use cleanup and recovery paths.
No additional watchdog is justified by the inspected code.

### ACP Config Rollback

Not retained. ACP config state is updated after the remote ACP response is received. The reviewed
code does not do the optimistic local mutation assumed by the draft review.

### Tool Output Retry

Not retained. Retrying with fewer tools after execution would rerun side-effectful tools. The current
`ToolOutputGuard` behavior is the safer boundary.

## Validation

Focused tests cover:

- ACP pending permission timeout cleanup.
- ACP pending permission timer cleanup after explicit resolution.
- Runtime session cleanup resolving live ACP provider permission requests as denied.
