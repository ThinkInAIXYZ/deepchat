# DeepChat Agent Harness Boundaries Tasks

## Typed Tool Execution Contract

- [x] Compare Pi and Bub execution semantics with DeepChat's current runtime.
- [x] Record the 156-test dispatch, context-builder, and ToolService baseline.
- [x] Define the trust boundary, capability model, scheduling invariants, and non-goals.
- [ ] Review and commit the SDD slice.
- [ ] Add the canonical discriminated execution contract and shared constants.
- [ ] Classify every built-in definition and default external MCP definitions conservatively.
- [ ] Extract and integrate the fail-closed batch execution policy.
- [ ] Preserve provider projection and historical context-reserve behavior.
- [ ] Add policy, dispatch, MCP ingress, provider-boundary, and token-boundary coverage.
- [ ] Run focused tests and full type checking.
- [ ] Run formatting, i18n validation, lint, and the full main-process suite.
- [ ] Review the complete implementation diff and fix every finding.
- [ ] Commit the implementation without pushing.

## Future Pull Requests

- [ ] Define and implement coordinator ownership boundaries without behavior changes.
- [ ] Add a thin Harness facade over the stabilized internal services.
- [ ] Add typed deterministic hook/event reduction over the facade event model.
- [ ] Design same-run steering separately if the product semantics are approved.
