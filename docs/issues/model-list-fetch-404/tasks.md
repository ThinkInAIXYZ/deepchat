# Tasks

- [x] Map stack trace to source and identify failure path.
- [x] Document issue/spec/plan.
- [x] Change `BaseLLMProvider.fetchModels()` catch behavior to handle async rejections.
- [x] Add regression tests for suppressed and non-suppressed async fetch failures.
- [x] Run targeted provider tests and relevant typecheck/lint checks.

- [x] Address review feedback so only provider fetch failures are suppressed; validation/persistence failures now surface.
- [x] Add regression coverage for provider model persistence failures.
