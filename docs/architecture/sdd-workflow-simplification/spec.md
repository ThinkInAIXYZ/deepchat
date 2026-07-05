# SDD Workflow Simplification

## Problem

DeepChat's SDD process currently treats features, issues, and architecture work as the same
three-file workflow. That is useful for larger changes but too noisy for small bug fixes and too
eager about cleanup during normal implementation.

## Goal

Make the SDD workflow lighter by classification:

- New features keep the existing `spec.md`, `plan.md`, and `tasks.md` flow under
  `docs/features/<goal>/`.
- Small bug fixes use one `docs/issues/<goal>/spec.md` document that contains issue details,
  location, fix plan, task checklist, and validation.
- Architecture refactors keep the three-file SDD flow under `docs/architecture/<goal>/`.
- SDD cleanup moves into a separate manually triggered skill.

## Acceptance Criteria

- `docs/spec-driven-dev.md` documents the classified workflow.
- `AGENTS.md` summarizes the classified workflow without duplicating full SDD policy.
- `.agents/skills/deepchat-sdd/SKILL.md` drives agents through the new classification.
- A separate `.agents/skills/deepchat-sdd-cleanup/` skill exists for manual documentation cleanup.
- Feature and small bug workflows document GitHub issue sync when local `gh` is usable.
- PR guidance requires `Closes #NNN` when a GitHub issue was created or linked.

## Non-Goals

- Do not clean existing SDD folders in this change.
- Do not create GitHub issues for this architecture documentation change.
- Do not add scripts unless the workflow needs deterministic automation.

## Open Questions

None.
