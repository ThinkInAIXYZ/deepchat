# Plan

- Use `Intl.supportedValuesOf('timeZone')` in the renderer with a UTC/browser fallback.
- Replace the timezone `Input` in `CronJobsSettings.vue` with the existing shadcn `Select`.
- Commit the selected value through the existing `commitJob` path.

