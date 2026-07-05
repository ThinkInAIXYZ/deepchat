---
name: deepchat-sdd-cleanup
description: Use only when a developer explicitly asks to clean, prune, tidy, or organize DeepChat SDD documentation after implementation and validation. Scans docs/features, docs/issues, and docs/architecture; prefers multi-agent review when available; removes completed issue docs tied to closed GitHub issues, drops stale plan/tasks files from completed feature or architecture goals, and deletes obsolete feature or architecture docs.
---

# DeepChat SDD Cleanup

## Rule

Run this skill only when the developer explicitly asks for SDD cleanup, documentation tidying, pruning,
or removal of completed/stale SDD files. Do not run it as an automatic final step of ordinary
feature, bug, architecture, or release work.

## Workflow

1. Inspect `docs/spec-driven-dev.md`, `docs/README.md`, and `git status`.
2. Inventory `docs/features`, `docs/issues`, and `docs/architecture` with `find` or `rg`.
3. Prefer parallel sub-agent review when available:
   - one pass for `docs/features`
   - one pass for `docs/issues`
   - one pass for `docs/architecture`
   - optional verifier pass over proposed deletes
4. Apply only changes with clear evidence. Keep a concise keep/delete/update list for handoff.
5. Validate references after edits.

## Cleanup Rules

- Completed feature or architecture goal: delete `plan.md` and `tasks.md`; keep `spec.md` only when
  it still defines a maintained contract, regression guard, platform policy, or architecture
  decision.
- Completed issue goal: delete the issue folder when a linked GitHub issue is closed or the local
  code and tests prove the bug no longer exists.
- Removed feature: delete its folder when the product/code path is gone and the spec has no reusable
  decision record.
- Obsolete architecture: delete its folder when the module was fully replaced and the doc no longer
  describes a maintained boundary; otherwise update the spec.
- Historical feature spec affected by an architecture refactor: update the retained spec instead of
  leaving contradictory docs.

## GitHub Checks

Use `gh` only when it is installed and authenticated. For linked issue docs, verify closure with
`gh issue view <number> --json state,url,title` when possible. If `gh` is unavailable, do not delete
solely because a GitHub link looks old.

## Never Delete

- Active work with unchecked tasks.
- Any document containing unresolved `[NEEDS CLARIFICATION]`.
- A document referenced by `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/FLOWS.md`, or AGENTS
  instructions unless the reference is updated in the same change.
- Runtime baselines or machine-read files unless the cleanup request explicitly covers them.

## Validation

- Run `rg -n "plan.md|tasks.md|docs/archives|NEEDS CLARIFICATION" docs AGENTS.md .agents/skills`
  and inspect any stale policy references.
- Run `git status --short`.
- For Markdown-only cleanup, formatting/lint commands are optional unless repository instructions or
  touched generated files require them.
