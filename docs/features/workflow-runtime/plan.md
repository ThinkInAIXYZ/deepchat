# Workflow Runtime Implementation Plan

## Status

Active. Work is split into reviewable local commits. Every commit receives a pre-commit review for
hidden side effects, compatibility, edge cases, performance, security, naming, test sufficiency,
and maintenance cost. Findings are fixed before the commit. This branch is not pushed.

## 1. Freeze Versioned Contracts

- Add bounded Zod domain schemas for run status, invocation status, effect state, outcomes, and
  runtime limits.
- Add a separate versioned main/utility-process command and event protocol.
- Add canonical JSON validation and hashing utilities with prototype-sensitive key rejection.
- Keep persisted rows behind repository adapters instead of persisting raw IPC envelopes.
- Add contract tests for unknown variants, malformed IDs, oversize payloads, non-plain JSON,
  unsupported schema versions, and valid round trips.

## 2. Prove The Sync QuickJS Runtime

- Add the minimal `quickjs-emscripten-core` and release-sync WASM dependencies.
- Add one workflow utility-process build entry and packaged asset resolution.
- Implement a testable QuickJS guest driver with no ambient host capabilities.
- Inject `agent`, `parallel`, `pipeline`, `phase`, and `log`.
- Remove nondeterministic globals and unsupported promise combinators.
- Reject unsupported direct promise scheduling and dynamic-code patterns before execution.
- Create guest deferred promises for host invocations.
- Serialize every VM mutation and schedule `executePendingJobs()` after each settlement.
- Enforce script, input, heap, stack, CPU, pending-promise, invocation, log, and result limits.

Spike gates:

1. multiple guest deferred promises progress concurrently under `Promise.all`;
2. nested `pipeline()` calls retain stable call paths when completions arrive out of order;
3. cancellation rejects unresolved promises and disposes all handles;
4. the WASM file loads in development, production output, ASAR, and unpacked-ASAR layouts;
5. utility-process exit is observable and can be mapped to one atomic run reconciliation.

The implementation does not proceed to broad child-agent wiring if any spike gate lacks a bounded,
testable solution.

## 3. Add Durable Run And Invocation Storage

- Add additive schema version 53 with `workflow_runs` and `workflow_invocations`.
- Store the exact immutable executed script source and hash in the run row.
- Enforce status checks, foreign keys, uniqueness, JSON bounds, and timestamps.
- Implement domain mapping and Zod parsing at repository boundaries.
- Allocate invocation `seq` transactionally.
- Preserve attempts under one stable call path rather than overwriting history.
- Persist a stable child correlation slot for crash-safe session reattachment.
- Add startup reconciliation and utility-exit reconciliation transactions.
- Add idempotent parent-result delivery state.
- Test new database creation, v52-to-v53 migration, constraints, replay lookup, restart
  reconciliation, and duplicate delivery prevention.

## 4. Introduce Shared Child-Agent Admission

- Replace direct child starts in workflow and orchestrator paths with one
  `AgentInvocationAdmission` port.
- Default to four active child invocations process-wide.
- Use owner-aware fair queues so a large run cannot starve other work.
- Support `AbortSignal` while queued and release permits exactly once.
- Bound queued work before child-session allocation.
- Preserve the orchestrator's current run/task limits as additional local caps.
- Add concurrency, fairness, cancellation, close, double-release, and queue-overflow tests.
- Add a separate bounded admission gate for active workflow utility processes and persisted queued
  runs.

## 5. Wire Workflow Child Sessions

- Resolve the parent session and assignment through existing session ports.
- Reject direct ACP targets before allocating a child.
- Enforce the launch-time target-agent allowlist before admission.
- Create each child through `AgentSubagentToolPort`.
- Make child creation idempotent by correlation slot or recover an existing correlated session.
- Propagate workflow run/invocation context through the DeepChat loop.
- Persist child identity before sending the handoff message.
- Subscribe to runtime updates and map waiting interactions, usage, completion, failure, and
  cancellation to durable invocation state.
- Link child Tape to the parent with a workflow-scoped idempotent provenance key.
- Treat a durable Tape-link receipt as a prerequisite for replayable success.
- Ensure late child events cannot overwrite a terminal invocation.

## 6. Add Write-Ahead Effect Classification

- Add a workflow-only effect observer at the common DeepChat tool execution boundary.
- Resolve trusted read/write metadata from reviewed tool execution contracts.
- Treat heuristic-only, unknown MCP, shell, and missing metadata as `unknown` or `write`.
- Persist the monotonic invocation effect state before tool execution; fail the tool call closed if
  persistence fails.
- Preserve detailed completed facts in child Tape.
- Implement recovery decisions from the write-ahead aggregate with Tape as supporting evidence.
- Test crash windows before intent, after intent/before execution, after execution/before Tape, and
  after Tape persistence.

## 7. Enforce Structured Output

- Accept bounded JSON Schema from the guest and normalize it in main.
- Reject remote references, recursive/unbounded forms, unsafe property names, and excessive depth
  or size.
- Inject an invocation-scoped structured-output tool into ordinary DeepChat-loop children.
- Use an exact-JSON terminal-response adapter with bounded same-child correction turns for
  DeepChat-owned ACP-as-LLM children, whose compatibility runtime exposes no local DeepChat tools.
- Validate tool arguments before accepting invocation success.
- Provide bounded same-session correction feedback for invalid output.
- Remove the temporary tool on every terminal path so later child turns use their ordinary catalog.
- Return plain JSON only and cap the serialized result before SQLite or IPC.
- Cover normal DeepChat providers and the `kind=deepchat + providerId=acp` compatibility path.
- Test valid output, correction, exhaustion, provider failure, direct ACP rejection, oversized
  output, and schema/result mismatch.

## 8. Implement Orchestration Service

- Create and approve runs from explicit requests.
- Spawn exactly one utility process per active run with a minimal environment.
- Persist an invocation before admission and a child identity before handoff.
- Settle guest promises from terminal or replayed invocation outcomes.
- Enforce run count, total-token, active-child, and per-execution wall-clock budgets.
- Defer monetary-cost budgets until DeepChat has a normalized cost fact at the common child
  runtime boundary; never treat unavailable cost as zero.
- Implement host-owned invocation timeout and typed guest errors.
- Implement idempotent cancel, process shutdown, and late-event handling.
- Persist accepted resume intent before admission, then resume from immutable source, stable call
  path, input hash, and attempts.
- Implement retry and retry-from-here without claiming exactly-once writes.

## 9. Add Agent Tool, Routes, And Events

- Add an explicit workflow launch/status/cancel tool surface without overloading
  `subagent_orchestrator`.
- Add typed main routes for list, inspect, launch, cancel, resume, retry, and parent synthesis.
- Add typed workflow events as renderer projections.
- Keep `orchestrationMode` independent from reasoning effort.
- Ship V1 with explicit/on-request activation only.
- Bind remembered launch approval to script hash, workspace, declared target-agent allowlist, and
  capability summary.
- Keep launch approval separate from child tool approval.

## 10. Add Parent Result Delivery

- Persist one Workflow Result payload and delivery identity.
- Queue or display it with `triggerTurn: false`.
- Reuse the existing pending-input sequencing rules when a parent turn is active.
- Add an explicit “Ask parent agent to synthesize” action.
- Make startup reconciliation and repeated completion events idempotent.
- Test completion during an idle parent, completion during an active parent turn, application
  restart between result persistence and delivery, and repeated delivery attempts.

## 11. Add Workflow UI

- Add a workflow section to the existing chat side panel.
- Show phase, invocation, child session, usage, duration, timeout, and effect-risk state.
- Lift existing child permission/question interactions into the workflow projection.
- Add legal controls for cancel, resume, retry, retry-from-here, open child, and parent synthesis.
- Require explicit warning and confirmation for interrupted `write` or `unknown` work.
- Add loading, empty, interrupted, incompatible-runtime, and partial-result states.
- Add vue-i18n strings and renderer tests.

## 12. Saved Workflows And Invocation UX

- Store named authoring scripts under a user-readable workflow directory.
- Treat the immutable run snapshot as resume authority.
- Validate names and paths against traversal and symlink escape.
- Add argument parsing and bounded input serialization.
- Keep source editing and run history separate so editing cannot mutate historical execution.
- Defer auto mode until explicit launch, resume, and recovery UX are validated.

## 13. Validation And Review

For each implementation slice:

1. inspect the full diff and affected callers;
2. review findings by severity for hidden effects, compatibility, edge cases, performance,
   security, naming, test gaps, and maintenance cost;
3. fix all material findings;
4. run `git diff --check`, formatting for touched files, focused typecheck, and focused tests;
5. commit locally with a concrete Conventional Commit subject no longer than 50 characters.

Before final handoff:

- run all workflow, session, Tape, tool, orchestrator, route, renderer, and packaging tests affected
  by the feature;
- run `pnpm run format`;
- run `pnpm run i18n`;
- run `pnpm run lint`;
- run `pnpm run typecheck`;
- run `pnpm run build`;
- verify the packaged QuickJS asset on the current platform;
- perform one final cross-module review;
- update `tasks.md` with actual validation evidence;
- do not push.
