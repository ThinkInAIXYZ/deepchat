# Retire Agent Session Presenter

> Status: implemented and validated
> Base: `dev@750f229d7`
> Branch: `task/retire-agent-session-presenter`

## Context

The session-boundary cleanup is complete through two stages:

1. foreign capabilities moved to explicit history, import, migration, usage, RTK, export,
   translation, and catalog owners;
2. Lifecycle, Turn, AgentAssignment, and Projection behavior moved to four composition-owned
   coordinators, while SessionService, ChatService, Remote, and Cron adopted narrow ports.

`AgentSessionPresenter` now contains forwarding only. Its shared `IAgentSessionPresenter` contract is
used only by the main process, but still makes the forwarding surface appear to be a domain owner.

## Problem

The compatibility facade creates four remaining architecture failures:

1. the composition root constructs a fifth session object that owns no behavior;
2. typed route dispatch retains one aggregate dependency alongside its existing narrow ports;
3. Tool, MCP, floating-widget, hooks, and agent-runtime adapters reach session behavior through the
   facade instead of the actual coordinator;
4. `IPresenter` exports the main-only aggregate contract through shared types, allowing new callers
   to couple to it again.

## Goals

1. Remove `src/main/presenter/agentSessionPresenter/` and the `AgentSessionPresenter` class.
2. Remove the main-process `IAgentSessionPresenter` declaration, export, and `IPresenter` property.
3. Wire the composition root directly to the existing Lifecycle, Turn, AgentAssignment, and
   Projection coordinator instances.
4. Give route runtime four separate session dependencies and route every command/read to its owner.
5. Rewire remaining main-process consumers to the narrow coordinator they actually use.
6. Preserve all route, event, IPC, renderer-client, persistence, and runtime behavior.
7. Add architecture enforcement that keeps the retired facade, interface, path, and aggregate
   dependency from returning.

## Non-goals

- Changing coordinator behavior, transaction ordering, DTOs, route names, preload APIs, or renderer
  clients.
- Moving state between AppSessionService, AgentManager, backend instances, transcript, Tape,
  permission, skill, or UI owners.
- Combining the four coordinators into a replacement `SessionApplicationServices`, facade, registry,
  service container, or command bus.
- Renaming renderer-side session clients or test doubles that do not reference the retired
  main-process presenter contract.
- GitHub issue synchronization.

## Target Dependency Shape

```text
Presenter composition root
  |- SessionLifecycleCoordinator
  |- SessionTurnCoordinator
  |- SessionAgentAssignmentCoordinator
  `- SessionProjectionCoordinator

main route runtime
  |- lifecycle -> lifecycle routes + SessionService
  |- turn -> turn routes + ChatService
  |- assignment -> assignment/settings routes
  `- projection -> read/window/Tape routes + SessionService + ChatService

other main consumers
  |- agent tool runtime -> lifecycle/turn/assignment/projection
  |- hooks -> projection
  |- floating widget -> projection
  `- MCP tools -> projection
```

No object may re-export all four capability groups.

## Ownership Mapping

| Retired facade calls | Direct owner |
| --- | --- |
| create, detached create, subagent create, draft ensure, fork, delete | Lifecycle |
| send, steer, pending input, message mutation, compaction, cancel, interaction | Turn |
| transfer, runtime settings, ACP config/commands, subagent Tape merge/discard | AgentAssignment |
| session/message/Tape reads, window activation, rename/pin, title/status events | Projection |
| permission cleanup | existing `SessionPermissionPort` |

## Boundary Rules

1. Production and main-process tests must not import, construct, type, or access
   `AgentSessionPresenter`, `IAgentSessionPresenter`, or `agentSessionPresenter`.
2. The composition root constructs exactly one instance of each existing session coordinator.
3. Route runtime exposes four separate session dependencies; it must not expose a combined session
   application object.
4. Required dependencies remain required. No optional method probes, fallback no-ops, setters, or
   `as unknown as` wiring may replace the facade.
5. Projection remains a singleton because it owns active-window bindings and status snapshots.
6. Existing stage-1 owners remain independent and are not absorbed by any coordinator.
7. Renderer-side route clients remain unchanged because the retired interface is main-process-only.

## Compatibility Invariants

- Every typed route keeps the same input parsing, output parsing, scheduler, timeout, and error
  behavior.
- SessionService and ChatService continue using their existing narrow ports and shared coordinator
  instances.
- Tool runtime session lookup, subagent creation, Tape operations, send, and cancellation preserve
  their current return and failure behavior.
- Hooks continue reading sessions/messages from the same Projection singleton.
- Floating-widget list and activation behavior remains optional only with respect to app lifecycle,
  not coordinator capabilities.
- MCP conversation history and ACP conversation lookup retain existing missing-session and error
  handling.
- Remote and Cron wiring remains unchanged apart from removal of obsolete facade references.

## Acceptance Criteria

1. The `agentSessionPresenter` production and main-test directories are deleted.
2. `AgentSessionPresenter`, `IAgentSessionPresenter`, and main-process `agentSessionPresenter`
   references are zero.
3. The shared presenter barrel and `IPresenter` no longer export the retired contract/property.
4. The composition root constructs no forwarding facade and wires every former caller to one of the
   four existing coordinators or `SessionPermissionPort`.
5. Route runtime contains four separate session dependencies and no aggregate replacement.
6. Existing integration coverage calls coordinators directly; forwarding-only tests are removed.
7. Architecture guards reject retired paths/symbols and continue rejecting combined facades and
   duplicate coordinator construction.
8. Current architecture docs and baseline generation describe the post-retirement graph; isolated
   generation succeeds, while canonical reports remain restricted to a clean committed tree.
9. Formatting, i18n validation, lint, typecheck, main tests, renderer tests, and architecture guards
   pass.

## Risks

- A mechanical route remap can send a method to the wrong coordinator while still type-checking if
  test doubles are overly broad.
- Reconstructing Projection per consumer would split active-window and status state.
- Deleting facade tests without redirecting integration coverage would hide cross-owner regressions.
- Generated architecture baselines can retain deleted edges unless their source configuration is
  updated before regeneration.
