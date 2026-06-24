# Markstream Vue 1.0.4 Upgrade

## User need
Keep the renderer dependency aligned with the required upstream package version so the workspace can be committed and reviewed cleanly.

## Goal
Record and ship the `markstream-vue` dependency bump from `1.0.3` to `1.0.4` in `package.json`.

## Acceptance criteria
- `package.json` declares `markstream-vue` at `1.0.4`.
- The change is documented as a small issue-level maintenance update.
- Validation covers formatting, i18n, and lint commands required by the repository workflow.

## Constraints
- Keep the change limited to the dependency version bump already present in the workspace.
- Do not alter unrelated dependencies or application code.

## Non-goals
- Refactoring markdown rendering code.
- Introducing new renderer behavior.

## Open questions
- None.
