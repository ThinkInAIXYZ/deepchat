# Agent Runtime Presenter Thinning — Plan

## Approach

1. Extract generation-setting defaults, persistence mapping, validation, and capability policy into
   a stateless generation-settings module.
2. Extract auto-approve model review into a permission-review module with explicit config/provider
   dependencies.
3. Move base prompt and skill/tool resource assembly into the DeepChat resources layer.
4. Move tool-result image normalization into the existing tool adapter boundary.
5. Move pure message/interaction projections out of the presenter and reuse them from live dispatch
   where the contracts are identical.
6. Extract session settings, tool resolution, deferred execution, ACP compatibility, compaction
   projection, and provider permission settlement behind explicit dependency contracts.
7. Keep turn lifecycle sequencing methods in the presenter for this goal; replace extracted bodies
   with narrow calls and remove obsolete imports/helpers.
8. Add focused unit tests and an architecture ceiling, then run the full required repository gates.

## Dependency Direction

```text
AgentRuntimePresenter
  -> generation settings policy
  -> DeepChat resource assembly
  -> tool permission reviewer
  -> tool adapters / interaction projection
  -> session / compaction / provider-permission coordinators
  -> tool resolver / deferred executor / ACP compatibility adapter

policy/resource modules
  -> typed presenter ports only
  -X-> AgentRuntimePresenter
```

## Compatibility

This is a source-only refactor. Public method names, route contracts, persistence formats, event
names, prompt section order, tool ordering, and cancellation semantics remain unchanged.

## Validation

- Focused new unit tests for every extracted policy.
- Existing `test/main/presenter/agentRuntimePresenter/**` suites.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.
- Node and web type checks.
- Agent cleanup/architecture guard.

## Result

The presenter boundary is 4,905 lines and 135 methods. The focused runtime presenter suite passes
605 tests with 19 skipped; format, i18n, lint, architecture guards, and node/web type checks pass.
