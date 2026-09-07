---
name: deepchat-sdd
description: Use before substantial DeepChat code, configuration, documentation, test, build, feature, issue, refactor, or architecture changes that need a durable RFC and an explicit execution path. Skip trivial style fixes, small localized logic changes, routine docs edits, and simple bugs unless the developer asks for SDD. Use plan.md as the only separate tracker when needed, default to implementation-first validation, and ask before optional GitHub issue sync unless the developer explicitly requested sync.
---

# DeepChat SDD

## When To Use

Use this skill before substantial DeepChat source code, configuration, tests, docs, build
scripts, release workflows, or project structure changes that need shared context or a durable
decision record.

Skip SDD for trivial or tightly localized work unless the developer explicitly asks for it:

- visual/style fixes, copy changes, and small UI layout adjustments
- simple localized logic changes with a clear owner module
- routine docs edits that do not change project direction
- release metadata already covered by the release flow

If the scope is unclear, inspect first and then ask whether SDD is wanted instead of creating
artifacts by default.

## Classify The Goal

Create one kebab-case folder per goal:

- New capability, user-visible behavior, integration, or tool large enough to need a shared plan:
  `docs/features/<goal>/`
- Complex bug, regression, failing test, CI failure, reliability problem, or prompt/runtime issue:
  `docs/issues/<goal>/`
- Refactor, migration, dependency boundary, shared contract, runtime architecture, or cross-module
  design: `docs/architecture/<goal>/`

If one request contains multiple independent goals, split them into separate folders. Keep current architecture reference docs such as `docs/architecture/agent-system.md` in place; use subfolders for new architecture targets.

Treat a bug as SDD-worthy only when the root cause, blast radius, or fix path is complex enough that
future developers benefit from the written record. For simple style defects or obvious local logic
fixes, skip `docs/issues/*` and implement directly.

If a bug fix introduces a new user-visible capability, data migration, public contract, or
cross-module redesign, classify the work as feature or architecture instead.

## Required Artifacts

Feature and architecture goals use two artifacts:

- `spec.md`: the normative RFC covering context, goals, non-goals, design, ownership, interfaces,
  data flow, invariants, compatibility, acceptance criteria, and open questions
- `plan.md`: ordered implementation steps and live completion state, followed by whole-change
  review, validation selection, cleanup, and quality gates

Do not create `tasks.md`. The plan is the only execution tracker.

Complex bug goals normally use one file:

- `spec.md`: issue description, impact, root cause or suspected location, fix design, concise
  implementation checklist, validation outcome, and linked GitHub issue if one exists

Add `plan.md` only when a complex bug has multiple independently trackable implementation slices.
Never add `tasks.md`.

Resolve every `[NEEDS CLARIFICATION]` marker before implementation. If the requested change is tiny,
prefer skipping SDD over creating a token artifact.

## Artifact Boundaries

Write `spec.md` as an RFC. It must explain enough implementation direction to constrain local code
decisions without becoming a file-by-file task list. Acceptance criteria describe observable
outcomes or independently verifiable contracts, not a test inventory.

Use `plan.md` as both plan and task tracker. Organize it into ordered checkbox sections whose steps
are coherent, reviewable implementation slices. Include the objective, ownership boundary,
essential guidance, dependencies when any, and completion condition. Reference the spec instead of
repeating its design.

## GitHub Issue Sync

Do not sync GitHub issues by default. Issue sync is a follow-up record, not a gate for local SDD or
implementation.

Only create or link a GitHub issue when the developer explicitly asks, or after asking and getting
approval once the SDD artifacts are written or the implementation is complete.

Eligible work:

- Complex bugs only; simple style defects and obvious local logic fixes should not get issues.
- Whole new features or major feature rewrites only; single actions, small behavior tweaks, and
  ordinary adjustments should not get issues.

If eligibility is unclear, ask the developer after the work is understood. Never self-authorize issue
creation just because local `gh` is installed and authenticated.

When approved:

- Feature issues use the `[feature]` label.
- Bug issues use the `[bug]` label.
- Create the label first if it is missing and `gh` has permission.
- Record the issue URL or number in the SDD artifact.
- If `gh` is unavailable or unauthorized, continue local-only and note that no GitHub issue was
  created only when sync was requested or approved.

When creating a PR for linked work, include `Closes #NNN` in the PR body so GitHub closes the issue
automatically after merge.

## Workflow

1. Inspect the current code and docs first.
2. Decide whether the work is substantial enough for SDD; skip artifacts for trivial/local changes.
3. Pick the target folder from the classification rules when SDD is needed.
4. Write or update the RFC and resolve every question that could change the implementation.
5. For feature, architecture, or multi-slice bug work, write one ordered implementation plan
   without a separate task list or upfront test matrix.
6. Keep the implementation aligned with existing DeepChat patterns:
   - main process Presenter boundaries
   - typed `shared/contracts/*`
   - renderer `api/*Client`
   - Vue 3 Composition API and i18n for UI strings
7. For architecture work that changes or replaces a historical feature, update that feature's
   retained `spec.md` if it is still a maintained contract.
8. Complete the planned implementation before deciding whether to author new test code. Existing
   checks may run at any time.
9. Review the whole change against the spec for hidden side effects, compatibility, failure
   behavior, performance, security, naming, and maintenance cost.
10. Select the smallest useful validation, remove temporary verification, and add durable tests
    only for qualifying behavior or contracts.
11. Update `plan.md` or the complex-bug spec checklist as coherent implementation slices land.
12. Ask whether to sync an eligible GitHub issue only after the docs or implementation clarify the
   scope, unless the developer already requested issue sync.
13. Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` before handoff
    when app code, tests, i18n, or project docs changed.

## Implementation-First Validation

Implementation-first means finishing the planned implementation before deciding whether to author
new tests. It does not prohibit running existing tests, type checking, linting, builds, or manual
checks during development.

New test code before implementation is exceptional. Use it only when the developer requests TDD, a
minimal executable reproduction is required to understand a complex failure, or migration,
concurrency, recovery, or protocol compatibility needs characterization of current behavior. Record
the reason in one sentence in `plan.md` or the complex-bug spec.

After implementation, choose among:

- existing tests and static or build checks;
- temporary probes, scripts, or tests that must be removed before handoff; and
- the smallest durable regression tests for user-visible behavior, documented cross-module
  contracts, persistence or migration, lifecycle or concurrency, recovery, security boundaries, or
  proven regressions.

Do not retain tests that mirror private control flow, assert incidental call order, duplicate the
implementation through mocks, or exist only to increase coverage. Prefer no new test to a
low-value implementation-coupled test.

## Documentation Hygiene

- Do not perform broad SDD cleanup during ordinary feature, bug, or architecture work.
- Use the separate `deepchat-sdd-cleanup` skill only when the developer explicitly asks to clean or
  organize SDD documentation.
- Treat existing `tasks.md` files as legacy and migrate them only when that goal is actively
  updated. Merge remaining work into an existing `plan.md`; without one, keep a single-slice complex
  bug checklist in `spec.md` and create `plan.md` for feature, architecture, or multi-slice bug work.
  Do not perform a repository-wide migration during unrelated work.
- During the current goal, update directly affected historical specs when they remain active
  contracts.
