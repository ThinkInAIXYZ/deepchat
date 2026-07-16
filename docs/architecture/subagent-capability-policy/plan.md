# Subagent Capability Policy - Implementation Plan

## Phase 1: Specify the policy boundary

- Record Agent configuration as the only persisted delegation policy.
- Define the closed capability, default-on migration matrix, Session compatibility, cache contract,
  security boundary, and model delegation guidance.
- Keep run guardrails, host-policy isolation, and Tape lineage as unchanged dependencies.

## Phase 2: Migrate defaults and enforce Agent invariants

- Advance `unifiedAgentsMigrationVersion` to 3.
- Migrate only the built-in legacy disabled-empty state to default-on, seed defaults for enabled
  empty configurations, and preserve custom disabled policies.
- Mark the version only after all writes succeed so retries are idempotent.
- Validate the merged Agent configuration at repository create/update boundaries.
- Make Settings restore defaults on enable, retain disabled slots, and prevent deletion of the last
  enabled slot.
- Cover migration retry, explicit disable preservation, invalid direct writes, and UI behavior.

## Phase 3: Centralize runtime capability

- Add one pure capability resolver shared by tool-profile and execution paths.
- Carry the snapshot through the internal tool-definition context and include its canonical
  `cacheKey` in the tool profile fingerprint.
- Build the model schema from that snapshot and re-resolve policy before run admission.
- Initially retain the legacy Session boolean as an additional compatibility gate so this phase is
  independently correct before the Session surface is removed.
- Reserve and reclassify `subagent_orchestrator` so MCP and generic disabled-tool policy cannot
  shadow or independently control it.

## Phase 4: Retire Session-level state

- Remove the Session route, application ports, assignment fields, create/transfer/cron/remote
  propagation, renderer Session/Draft state, and composer item.
- Remove the compatibility gate from capability admission; Agent policy becomes the only user
  policy.
- Keep the database column and legacy reader compatibility while leaving all new rows at the
  existing default.
- Prove legacy `0` and `1` values are non-interfering and existing Sessions observe Agent changes on
  the next turn.

## Phase 5: Guide model delegation

- Update the orchestrator description and default prompt with conservative delegation criteria,
  user opt-out precedence, overlapping-write cautions, and cost/latency guidance.
- Update Agent Settings copy without adding another switch.
- Add request-level tool snapshot coverage and configuration-race/active-run integration tests.

## Phase 6: Validate and finalize contracts

- Run targeted and full main/renderer suites, native SQLite coverage, typecheck, format, i18n, lint,
  and architecture guards.
- Review the complete branch for hidden writes, migration compatibility, cache correctness,
  security boundaries, performance, naming, test depth, and maintenance cost.
- Update current session/application and tool-system architecture contracts only for validated
  behavior.

## Commit Strategy

1. `docs(agent): specify subagent capability`
2. `fix(agent): migrate subagent defaults`
3. `fix(agent): centralize subagent capability`
4. `refactor(session): remove subagent toggle`
5. `fix(agent): guide subagent delegation`
6. `docs(agent): finalize subagent capability`

Any additional remediation commit must name its concrete behavior. Existing commits are not amended
or rebased.

## Review Gate

Before every commit:

1. Inspect status, the complete unstaged diff/stat/check, and run the smallest sufficient tests.
2. Review P0-P3 for hidden writes, compatibility, migration/retry boundaries, performance,
   authorization, naming, test quality, and maintenance cost.
3. Fix every in-scope actionable finding and repeat the review.
4. Stage explicit task paths only; inspect the complete staged diff/stat/check and repeat the same
   severity review.
5. Commit only when the staged change has no unrelated file and no actionable P0-P3 finding.

After implementation, repeat the review over `dev...HEAD`. If a finding requires a new global
policy, database-column removal, child permission change, or external protocol expansion, stop and
request authorization rather than expanding this goal.

## Compatibility and Rollback

- Agent config fields remain readable by older versions.
- The default migration changes only JSON config and is idempotent; rollback code can still read
  the resulting policy and slots.
- The legacy Session column remains present with its original default, so older database readers do
  not fail schema checks.
- Older Session values are ignored by new code and are not destructively rewritten.
- No provider/ACP registry refresh or full build is part of this change.

## Validation Strategy

- Repository/config tests: defaults, migration matrix, idempotency, failure retry, write invariant.
- Tool tests: capability reasons, slot schema, cache refresh, call-time revalidation, reserved name,
  generic-disabled non-interference, child recursion prevention.
- Session tests: create/transfer/cron/remote inputs, legacy column compatibility, existing Session
  Agent-policy refresh, ACP non-interference.
- Renderer tests: no composer/draft toggle, Settings default restoration and final-slot protection.
- Integration tests: actual provider tool snapshot appears/disappears without restart, active runs
  retain their admitted snapshot, Tape finalization and child activity remain unchanged.
- Final commands: targeted Vitest suites, `test:main:native-sqlite`, full main and renderer suites,
  typecheck, format/check, i18n, and lint.
