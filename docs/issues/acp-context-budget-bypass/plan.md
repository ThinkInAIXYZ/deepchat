# ACP Context Budget Bypass Plan

## Implementation

- Add an internal `providerId === 'acp'` budget-bypass helper in `AgentRuntimePresenter`.
- For ACP new turns and resume turns, use existing persisted summary state but skip new
  compaction-intent preparation caused by DeepChat context pressure.
- Build ACP request contexts with an effectively unbounded context budget so DeepChat does not trim
  history based on ACP model metadata.
- In the provider loop, bypass `preflightRequestContext`, context-pressure recovery, overflow error
  creation, and effective max-token shrinking for ACP. Keep rate-limit, abort, and steer handling.
- Treat ACP resume tool-budget checks as unbounded so DeepChat does not replace tool results with
  context-window errors before the ACP provider sees the continuation.

## Compatibility

- The bypass applies to all ACP agents, including registry and custom agents.
- Non-ACP behavior remains unchanged.
- Existing persisted summaries remain available and are appended when present; this change only
  prevents ACP turns from creating new budget-driven summaries.

## Tests

- Add main-process tests for oversized ACP prompt delivery and lack of budget overflow errors.
- Add coverage proving ACP context pressure does not start DeepChat compaction.
- Keep existing non-ACP overflow tests as regression coverage.
