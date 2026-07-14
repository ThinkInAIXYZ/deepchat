# DeepChat Runtime Lifecycle Owners — Plan

## Ownership

```text
AgentRuntimePresenter (public façade / composition root)
  -> TurnCoordinator.start | resume
       -> DeepChatLoopRunner.run
  -> InteractionCoordinator.respond
       -> TurnCoordinator.resume

DeepChatAgentInstance -> session-owned mutable state
LoopRun                -> run-owned mutable state
```

## Approach

1. Define owner-specific port contracts that expose only existing services and lifecycle operations.
2. Move provider/tool execution and context-pressure recovery to `DeepChatLoopRunner` first.
3. Move paused interaction reconciliation to `InteractionCoordinator`, keeping resume as one
   injected boundary.
4. Move initial and resumed pre-stream flows to `TurnCoordinator`, keeping loop execution as one
   injected boundary.
5. Retain thin presenter wrappers for public compatibility and test seams, then lower the
   architecture ceiling.
6. Update maintained historical architecture documents and run focused plus repository validation.

## Compatibility

This is a source-only ownership refactor. Routes, persistence formats, event names, prompt ordering,
tool ordering, permission semantics, cancellation behavior, and renderer contracts do not change.

## Validation

- Existing `test/main/presenter/agentRuntimePresenter/**` suites.
- Focused lifecycle owner tests where behavior can be isolated without the full presenter graph.
- Presenter and aggregate line-count checks.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`.

## Result

The presenter now delegates initial/resume turns, provider/tool execution, and paused interactions
through three owner-specific contracts. Compatibility wrappers keep the existing public API and
intentional test seams while the implementations no longer depend on the presenter instance.
