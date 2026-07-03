# Plan

## Dependency

Add `@vue-js-cron/core` only when implementation starts.

Do not add `@vue-js-cron/light` unless the renderless core path proves too expensive. Do not add
Ant/Element/Vuetify adapters because DeepChat does not use those UI systems.

## Implementation

1. Wrap `@vue-js-cron/core` in a local renderer component under the Cron Jobs settings feature.
2. Render the controls with existing shadcn-vue primitives.
3. Emit a 5-field cron expression compatible with the current `cron-parser` validation path.
4. Keep the raw cron input beside or behind the visual editor for unsupported expressions.
5. Reuse the existing preview chips and error state.

## Data Flow

```text
Visual editor
  -> cronExpr string
  -> CronJobsSettings.commitJob()
  -> cronJobs.upsert
  -> CronExpressionService validation and next-run calculation
```

## Validation

- Renderer component test for common schedules: every N minutes, hourly, daily, weekdays.
- Existing `CronExpressionService` tests remain the parser source of truth.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.

