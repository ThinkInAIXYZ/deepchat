# Scheduled Task Prompt Picker UX

## User Story

As a user configuring scheduled tasks, I want the task list to feel clean, balanced, and easy to scan, and I want prompt agent/model controls to fit cleanly in the task card with selectable options, so I can configure automation without overlapping fields or manually typing model IDs.

## Acceptance Criteria

- Scheduled task settings use a cleaner, more balanced layout with readable hierarchy between page header, task header, trigger settings, and action settings.
- Task cards avoid overly heavy nested borders and keep controls aligned in a responsive two-panel composition.
- Agent and model controls in prompt actions do not overlap at common settings window widths.
- Long agent names or IDs are truncated inside their control instead of expanding the grid column.
- The model field is a selectable model picker populated from enabled models, not a free-form text input.
- Selecting an agent still applies its default model preset when available.
- Selecting a model persists both `providerId` and `modelId` for the scheduled task.
- Existing notify actions, trigger controls, and prompt text fields keep their current behavior.

## Non-Goals

- No changes to scheduled task execution semantics.
- No new model filtering rules beyond excluding ACP and using enabled models.
- No new IPC or persistence schema changes.

## Constraints

- Follow existing Vue 3 Composition API and shadcn/Tailwind patterns.
- Reuse existing model picker components where possible.
- Avoid new user-facing strings unless required.
