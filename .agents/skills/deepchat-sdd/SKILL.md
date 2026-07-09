---
name: deepchat-sdd
description: Use before substantial DeepChat code, configuration, documentation, test, build, feature, issue, refactor, or architecture changes that need a durable spec. Skip trivial style fixes, small localized logic changes, routine docs edits, and simple bugs unless the developer asks for SDD. Classify substantial work into feature SDD, complex-bug issue spec, or architecture SDD; ask before optional GitHub issue sync unless the developer explicitly requested sync.
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

Feature and architecture goals use the full SDD set:

- `spec.md`: user need, goal, acceptance criteria, constraints, non-goals, open questions
- `plan.md`: implementation approach, affected interfaces, data flow, compatibility, test strategy
- `tasks.md`: ordered tasks that can map to commits or review slices

Complex bug goals use one file only:

- `spec.md`: issue description, impact, root cause or suspected location, fix plan, task checklist,
  validation, and linked GitHub issue if one exists

Resolve every `[NEEDS CLARIFICATION]` marker before implementation. If the requested change is tiny,
prefer skipping SDD over creating a token artifact.

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
4. Create or update the required artifact set for that classification.
5. Keep the implementation aligned with existing DeepChat patterns:
   - main process Presenter boundaries
   - typed `shared/contracts/*`
   - renderer `api/*Client`
   - Vue 3 Composition API and i18n for UI strings
6. For architecture work that changes or replaces a historical feature, update that feature's
   retained `spec.md` if it is still a maintained contract.
7. Implement the change after the SDD artifacts are complete.
8. Update `tasks.md` or the issue spec checklist as work lands.
9. Ask whether to sync an eligible GitHub issue only after the docs or implementation clarify the
   scope, unless the developer already requested issue sync.
10. Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` before handoff when app code,
    tests, i18n, or project docs changed.

## Documentation Hygiene

- Do not perform broad SDD cleanup during ordinary feature, bug, or architecture work.
- Use the separate `deepchat-sdd-cleanup` skill only when the developer explicitly asks to clean or
  organize SDD documentation.
- During the current goal, update directly affected historical specs when they remain active
  contracts.
