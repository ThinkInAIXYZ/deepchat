# Auto-approve approval integrity — plan

Spec: [spec.md](./spec.md). Objective: make `auto_approve` synthetic approvals truthful and
consistent, and make an interaction-handling failure recoverable instead of wedging the session.

Ownership boundary: the synthetic review gate and the interaction recovery path. The permission
broker, ACP, the review model contract and MCP/Code Mode coverage are untouched.

## 1. Recovery: an answered interaction that throws must not wedge the session

Objective: no state remains `generating` with no executing run and no pending approval, and stop
reports what actually happened.

- [x] `InteractionCoordinator.dismiss` settles the turn it orphans through
      `RunLifecycleCoordinator.settleOrphanedInteraction`, which declines while a run or a
      replacement operation controller still owns the turn.
- [x] `RunLifecycleCoordinator.cancel` publishes a terminal state when the session is not idle and
      nothing owns it, so stop is never a silent no-op.
- [x] Renderer reports a failed `respondToolInteraction` through `notifyRenderer` before releasing
      the approval.
- [x] The dismissal records `The request was closed without a user decision.` instead of the denial
      text, so the transcript no longer claims a decision the user never made.

Completion condition met: the issue's reproduction no longer leaves the session stuck; stop from the
abnormal state publishes a terminal state.

## 2. Payload construction: describe the tool that actually ran

Objective: every reviewed tool's approval names its real identity, operation and scope, and the
allow path validates the same thing the synthesizer produced.

- [x] `src/main/tool/permission/agentToolReviewPolicy.ts` is the single owner of the coverage
      decision and the approval shape.
- [x] Argument collection reads paths only from the arguments that really are paths
      (`path` for the file editors, the patch hunks for `apply_patch`). Operation names, identifiers,
      enums and string arrays are never read as paths.
- [x] The payload keeps the tool's declared server identity; it is never rewritten.
- [x] Command synthesis is limited to `exec`, the only tool that runs a shell command.
- [x] Approval paths are resolved through the tool layer against the same base directory the call
      runs under (`ToolExecutionPort.resolveAgentToolApprovalPaths`).
- [x] Every `agent-filesystem` approval carries a resolved shell profile; the allow path requires
      paths only from tools that authorize paths, and still rejects invalid or missing paths for
      those.

Completion condition met: the four failing scenarios are approvable, `process` actions no longer
demand filesystem paths, and no validation was weakened to achieve it.

## 3. Coverage: derive the reviewed set from the declared contract

Objective: coverage follows `execution.effect` rather than tool-name substrings and argument shape.

- [x] Coverage follows the declared `execution.effect === 'write'` rule, corrected for operations the
      contract cannot express.
- [x] Independent approval paths are preserved: `cronjob` writes, `deepchat_subagents`
      `spawn`/`follow_up`, the question tool, and the settings lease.
- [x] The intentional MCP and Code Mode coverage decisions are recorded in the spec.

Completion condition met: `apply_patch` is reviewed, read-only tools are not, and the spec's coverage
table matches the code.

## 4. Whole-change review, validation and gates

- [x] Reviewed the change against the spec for side effects, compatibility, failure behaviour,
      security, naming and maintenance cost.
- [x] Selected the smallest useful validation; no temporary probes remain.
- [x] `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck` pass.
- [x] Relevant suites pass: `test/main/agent/deepchat/**`, `test/main/tool/**`, the harness suite and
      the renderer interaction suite.
- [x] The spec's validation outcome records what fails on the base implementation.

## Notes

- The whole-change review caught a regression the first implementation introduced: the new policy
  did not check `source`, so MCP tools — whose execution contract is hardcoded to `write` — would
  have been reviewed, contradicting the recorded decision to leave MCP on the broker's path. The
  policy now gates on `source === 'agent'` and a test locks it.
- `collectAgentToolApprovalPaths` (which decides whether a call is path-scoped) and the tool
  manager's `collectWriteTargets` (which resolves the execution's targets) must stay in step. A
  divergence fails loudly at approval time rather than silently dropping the path requirement,
  because `requiresAgentToolApprovalPaths` keeps the stricter default for unrecognized tools.
- Reused existing i18n keys (`common.error.operationFailed`, `common.error.sessionInterrupted`)
  rather than adding keys, because the notification copy is generic and adding one would require
  translating it into 23 locales.
- `memory_recall` and `skill_view` declare `execution.effect === 'write'` although they only read.
  Their declarations are untouched: the same contract drives execution parallelism and recovery
  classification, so the review policy corrects only the decision it owns.
- Two existing dispatch tests asserted the removed behaviour (server-identity rewriting, and a `read`
  fixture declared as a write tool being reviewed by name); they were updated rather than kept.
- `skill_run` recovered through a deferred dispatch may fail on its request-bound execution authority
  (`manifestHash`/`tapeIncarnationId`), which the deferred path does not carry. That is a
  pre-existing condition outside this change's scope and was not verified by a test.
- Not committed, and no GitHub issue sync performed: the change is left in the worktree for review.
