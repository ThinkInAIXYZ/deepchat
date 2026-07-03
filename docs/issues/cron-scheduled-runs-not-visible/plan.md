# Plan

1. Add a service-level test that processes a scheduled due event and verifies the session starter runs once.
2. Refresh visible run histories from `CronJobsSettings.vue` when scheduler status changes after polling.
3. Keep the diff scoped to cron jobs service tests and the settings component.
4. Run format, i18n, lint, and focused tests.
