# Project Skills Implementation

- [x] Add scoped project discovery, catalog composition, and source identity in SkillService.
- [x] Carry session scope through runtime listing, validation, materialization, and execution.
- [x] Share the workspace catalog between composer picker and slash suggestions; handle refresh
      and stale responses without changing layout.
- [x] Review precedence, isolation, filesystem boundaries, and existing behavior against spec.md.
- [x] Add focused regression protection after implementation; run format, i18n, lint, typecheck,
      and relevant main/renderer suites.

Validation: format, i18n, lint, and main/renderer type checks pass. The full main suite passes
8531 tests (493 skipped); the selected renderer suites pass 17 tests. Regression coverage includes
workspace discovery, precedence, unsafe paths, content and credential isolation, session selection,
shared deletion, and stale composer responses.
