# Native Agent Evaluation Baseline — Plan

## Harness

Create a reusable scenario runner under `test/main/evals/` that constructs production `ProcessParams`,
feeds scripted async provider rounds, records fake tool calls and message-store finalization, and
returns a normalized report. Keep fixtures declarative so new regressions become scenarios rather
than bespoke test setup.

## Metrics and Results

Each report includes scenario id, `ProcessResult` status/stop reason, provider-round count,
tool-call count, elapsed milliseconds, usage, and final persisted status/metadata. Assertions remain
explicit per scenario and distinguish exact expected calls from maximum budgets. Multi-round
fixtures emit usage on every round so aggregation cannot pass by retaining only the final snapshot;
a suite-level assertion verifies all registered scenarios ran and stayed within their budgets.

## Integration

Add `test:agent:eval` to `package.json`. The suite runs in the existing main-process Vitest project and
reuses current Electron/event mocks. No generated report is committed.

## Validation

Run the dedicated eval command, targeted Agent runtime tests, node typecheck, formatting, i18n check,
and lint.
