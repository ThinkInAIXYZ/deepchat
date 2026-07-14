# Retire Agent Session Presenter - Implementation Plan

## Approach

This is a deletion migration, not another extraction:

1. replace each facade call with the already-existing owner;
2. remove the facade from the composition root and route runtime;
3. delete the class and shared interface after repository-wide production references reach zero;
4. redirect integration tests to the same coordinator instances;
5. convert facade-preservation guards into retirement guards and regenerate architecture baselines.

## Wiring Plan

### Composition root

- Remove the `IAgentSessionPresenter` import, `AgentSessionPresenter` import, public property, and
  construction.
- Use Projection for lookup, message, Tape, hook, floating-widget, and MCP consumers.
- Use Lifecycle for subagent creation.
- Use Turn for send and cancel.
- Use AgentAssignment for permission/settings and subagent Tape operations.
- Keep permission cleanup on the existing `SessionPermissionPort`.

### Route runtime

- Replace `agentSessionPresenter` with separate lifecycle, turn, assignment, and projection
  dependencies.
- Continue passing lifecycle/projection into SessionService and turn/projection into ChatService.
- Dispatch direct route cases to the same four dependencies by the ownership table in `spec.md`.
- Update route tests to provide four focused doubles and assert the owning port.

### Remaining consumers

- Floating widget: Projection list and activate.
- MCP conversation search: Projection session/message reads.
- MCP tool manager: Projection session lookup.
- Hooks notification adapter: Projection session/message lookup.
- Agent tool runtime and skill state adapter: direct coordinator properties captured by closures.

### Tests

- Delete tests whose only subject is forwarding.
- Move retained cross-owner and runtime integration tests under `test/main/presenter/sessionApplication/`.
- Replace aggregate test variables with explicit Lifecycle, Turn, AgentAssignment, and Projection
  variables.
- Preserve renderer tests because their local `agentSessionPresenter` names represent route clients,
  not the retired main-process interface.

### Guards and docs

- Mark the facade directory and interface file as retired paths.
- Reject retired symbols in `src/main`, `src/shared`, and `test/main`.
- Remove facade ownership evidence and deleted files from architecture-baseline generation.
- Update current session-management and stage-2 documentation to state that stage 3 is complete.
- Verify baseline generation in an isolated output directory; regenerate canonical reports only
  from a clean committed tree.

## Validation

Run in this order:

1. repository-wide retired-symbol/path search;
2. focused route, sessionApplication, floating, MCP, and composition tests;
3. `pnpm run lint:architecture`;
4. `pnpm run typecheck`;
5. `pnpm run test:main` and `pnpm run test:renderer` (rerun any isolated timeout once to distinguish
   contention from a functional failure);
6. `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`;
7. final clean-worktree and diff review.
