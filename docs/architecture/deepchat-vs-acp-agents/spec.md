# DeepChat Agent vs ACP Agent Architecture

## Scope

This document compares the two live agent-session backends and the retained ACP-provider compatibility path.
It describes current code, not a roadmap.

## Routing model

`AgentManager` resolves the current executable descriptor and switches only on `descriptor.kind`:

```text
kind=deepchat
  -> typed DeepChat backend
  -> DeepChatAgentRuntime / DeepChatAgentInstance
  -> DeepChatLoopEngine
  -> provider selection
       ordinary provider
       or AcpProvider compatibility adapter when providerId=acp

kind=acp
  -> DirectAcpSessionBackend
  -> AcpAgentRuntime / AcpAgentInstance
  -> external ACP protocol loop
```

`kind=deepchat + providerId=acp` remains supported and is not the same execution path as `kind=acp`.

## Ownership model

| Area | DeepChat Agent | Direct ACP Agent |
| --- | --- | --- |
| Control plane | `AgentManager` selects typed DeepChat backend | `AgentManager` selects direct ACP backend |
| Session state | `DeepChatAgentInstance` | `AcpAgentInstance` plus external ACP process state |
| Turn loop | in-process `DeepChatLoopEngine` with per-turn `LoopRun` | external ACP process/protocol loop |
| Provider | generic DeepChat `ProviderPort`; ACP provider remains available | ACP connection/session/prompt controllers |
| Tool delivery | `ToolPresenter` through typed catalog/execution/result ports | ACP protocol callbacks and session-init MCP config |
| Permission | ordered DeepChat tool interactions and fresh resume run | ACP protocol permission promise/timeout/cancel settlement |
| Transcript | existing structured message projection | same projection through ACP compatibility adapter |
| Tape/trace | `TapeRecorder`, ViewManifest and provider trace | ACP projection adapter and request trace port |
| Memory | `MemoryRuntimeCoordinator` prompt/ingestion seams | no direct ACP Memory seam |
| Failure boundary | Electron main process plus provider/tool errors | external process, connection and protocol promises |

## DeepChat Agent path

Main files:

- `src/main/agent/manager/deepChatAgentBackend.ts`
- `src/main/agent/deepchat/instance/deepChatAgentRuntime.ts`
- `src/main/agent/deepchat/instance/deepChatAgentInstance.ts`
- `src/main/agent/deepchat/loop/deepChatLoopEngine.ts`
- `src/main/agent/deepchat/loop/ports.ts`
- retained adapters under `src/main/presenter/agentRuntimePresenter/`

Flow:

```text
Renderer send
  -> SessionService / ChatService -> Lifecycle / Turn coordinator
  -> AgentManager -> typed DeepChat handle
  -> DeepChatAgentInstance preparation
  -> create/register LoopRun
  -> DeepChatLoopEngine provider/tool rounds
  -> message projection -> TapeRecorder facts
  -> terminal projection / pending drain / Memory observer
```

Important behavior:

- one active/hydrated app session maps to one instance; turn-local request/round/abort state stays in `LoopRun`;
- fixed commits may await, but only typed permission/question/skill-draft interactions create persistent pause;
- terminal tool facts are appended after message projection with stable provenance and idempotency;
- Memory injection is awaited/fail-open and extraction is background/epoch-fenced;
- side-effectful tools are never rerun merely to fit output.

## Direct ACP Agent path

Main files:

- `src/main/agent/manager/directAcpAgentBackend.ts`
- `src/main/agent/acp/instance/acpAgentRuntime.ts`
- `src/main/agent/acp/instance/acpAgentInstance.ts`
- `src/main/agent/acp/runtime/acpSessionController.ts`
- `src/main/agent/acp/runtime/acpProcessManager.ts`
- `src/main/agent/acp/client/`

Flow:

```text
Renderer send
  -> SessionService / ChatService -> Lifecycle / Turn coordinator
  -> AgentManager -> direct ACP handle
  -> validate descriptor/config/workdir identity
  -> AcpAgentRuntime hydrate/prepare AcpAgentInstance
  -> ACP session new/load/resume + prompt
  -> ACP content/tool/permission callbacks
  -> existing message/Tape/event/trace compatibility projection
```

The direct path does not enter `DeepChatLoopEngine` and does not execute the primary turn through
`AcpProvider`. It preserves app restart/search/export by writing the existing structured projection;
`acp_turns` remains protocol metadata. Lightweight session list reads do not launch an ACP process.

## DeepChat + ACP-provider compatibility

`src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` remains live only because a DeepChat
descriptor may select `providerId='acp'`. This path keeps the DeepChat outer lifecycle, prompt/context,
tool-resource snapshot, Tape and Memory behavior, then adapts provider streaming to the shared ACP client core.
It must not be used as a fallback for an unavailable `kind=acp` descriptor.

## Permission settlement

DeepChat ordered interactions and ACP protocol permission are separate continuations behind compatible UI
decisions:

- DeepChat persists an ordered batch; each decision resolves one item, and only the final item creates a fresh
  resume run.
- ACP registers one protocol request and settles it exactly once on decision, timeout, cancel, clear, process
  exit or shutdown.

The historical missing ACP timeout/cancel settlement was fixed and remains covered by:

- [GitHub issue #1881](https://github.com/ThinkInAIXYZ/deepchat/issues/1881)

## Shared and separate data

Shared:

- app-session shell (`new_sessions`);
- structured message/search/export projection;
- renderer events and typed route DTOs;
- Tape/trace storage adapters;
- pending input and UI decision ports where both paths implement the capability.

Separate:

- DeepChat `LoopRun`, provider rounds, ToolPresenter execution and Memory seam;
- ACP external process/session/protocol state, mode/config/commands and permission continuation;
- kind-specific required facets and lifecycle cleanup.

## Rejected shortcuts

- No universal LoopEngine across DeepChat and ACP.
- No fallback from malformed/missing ACP descriptor to DeepChat.
- No agent handle/backend `legacy | direct runtimeKind` discriminator; `kind` already selects the backend.
- No JavaScript Tape session lock: current writes use the single Electron-main synchronous SQLite owner and
  idempotent provenance.
- No tool-output retry that could repeat side effects.

## Validation

Current contracts cover strict kind/source/config routing, no-fallback behavior, regular/subagent ACP,
workdir/mode/config/commands, permission timeout/cancel, process exit, request trace order, structured projection,
DeepChat + ACP-provider compatibility, transfer/delete cleanup and shutdown fencing.
