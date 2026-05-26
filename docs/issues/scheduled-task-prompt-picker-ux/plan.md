# Plan

## Approach

- Keep the fix scoped to `src/renderer/settings/components/ScheduledTasksSettings.vue`.
- Make the settings page feel less cramped by separating the page header, empty state, task header, trigger panel, and action panel with clearer surfaces and spacing.
- Simplify visual weight by using softer panels, clearer section headers, and responsive control groups instead of dense nested card chrome.
- Keep each task card scannable with a compact status/summary row, a prominent editable name, and action buttons that wrap cleanly on smaller widths.
- Change the prompt action control grid so each column can shrink (`min-w-0`) and stacks earlier when space is tight.
- Force select triggers/buttons to use `w-full min-w-0` and truncate visible labels.
- Replace the model ID input with a `Popover` + existing `ModelSelect` picker.
- Resolve the displayed model name through `useModelStore.enabledModels`, with a fallback to the stored model ID.
- Close the model popover after selection and persist via the existing task upsert path.

## Data Flow

- Existing task action stores `providerId` and `modelId`.
- Agent selection may set both fields from `agent.config.defaultModelPreset`.
- Model picker selection updates `providerId` and `modelId` explicitly.

## Validation

- Run formatting and lint checks required by repository guidelines.
- Run i18n validation and ensure any new user-facing text is backed by locale keys.
- Review the changed template for responsive truncation and no new raw strings.
