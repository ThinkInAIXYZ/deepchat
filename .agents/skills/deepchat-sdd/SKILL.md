---
name: deepchat-sdd
description: Use before DeepChat code, configuration, documentation, test, build, feature, issue, refactor, or architecture changes. Classify work into feature SDD, small-bug issue spec, or architecture SDD; optionally sync feature and bug work to GitHub issues with [feature] or [bug] labels when local gh is usable; keep broad documentation cleanup for the separate deepchat-sdd-cleanup skill.
---

# DeepChat SDD

## When To Use

Use this skill before changing DeepChat source code, configuration, tests, docs, build scripts, release workflows, or project structure.

## Classify The Goal

Create one kebab-case folder per goal:

- New capability, user-visible behavior, integration, or tool: `docs/features/<goal>/`
- Small bug, regression, failing test, CI failure, reliability problem, or prompt/runtime issue:
  `docs/issues/<goal>/`
- Refactor, migration, dependency boundary, shared contract, runtime architecture, or cross-module
  design: `docs/architecture/<goal>/`

If one request contains multiple independent goals, split them into separate folders. Keep current architecture reference docs such as `docs/architecture/agent-system.md` in place; use subfolders for new architecture targets.

Treat a bug as small only when the failure is narrow, the owner module is clear, and the fix does not
introduce a new user-visible capability, data migration, public contract, or cross-module redesign.
If it does, classify the work as feature or architecture instead.

## Required Artifacts

Feature and architecture goals use the full SDD set:

- `spec.md`: user need, goal, acceptance criteria, constraints, non-goals, open questions
- `plan.md`: implementation approach, affected interfaces, data flow, compatibility, test strategy
- `tasks.md`: ordered tasks that can map to commits or review slices

Small bug goals use one file only:

- `spec.md`: issue description, impact, root cause or suspected location, fix plan, task checklist,
  validation, and linked GitHub issue if one exists

Resolve every `[NEEDS CLARIFICATION]` marker before implementation. If a requested change is tiny,
keep the artifact short and concrete.

## GitHub Issue Sync

For feature and small bug goals only, sync to GitHub when local `gh` is installed and authenticated:

- Feature issues use the `[feature]` label.
- Bug issues use the `[bug]` label.
- Create the label first if it is missing and `gh` has permission.
- Record the issue URL or number in the SDD artifact.
- If `gh` is unavailable or unauthorized, continue local-only and note that no GitHub issue was
  created.

When creating a PR for linked work, include `Closes #NNN` in the PR body so GitHub closes the issue
automatically after merge.

## Workflow

1. Inspect the current code and docs first.
2. Pick the target folder from the classification rules.
3. Create or update the required artifact set for that classification.
4. Sync a GitHub issue for feature or small bug work when `gh` is usable.
5. Keep the implementation aligned with existing DeepChat patterns:
   - main process Presenter boundaries
   - typed `shared/contracts/*`
   - renderer `api/*Client`
   - Vue 3 Composition API and i18n for UI strings
6. For architecture work that changes or replaces a historical feature, update that feature's
   retained `spec.md` if it is still a maintained contract.
7. Implement the change after the SDD artifacts are complete.
8. Update `tasks.md` or the issue spec checklist as work lands.
9. Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` before handoff.

## Documentation Hygiene

- Do not perform broad SDD cleanup during ordinary feature, bug, or architecture work.
- Use the separate `deepchat-sdd-cleanup` skill only when the developer explicitly asks to clean or
  organize SDD documentation.
- During the current goal, update directly affected historical specs when they remain active
  contracts.
