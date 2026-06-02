# Tasks

- [x] Inspect current assistant message rendering, reasoning header, tool-call block, stream end flow,
      and display message conversion.
- [x] Write SDD spec with UX requirements, grouping rules, duration rules, ASCII UI, and acceptance
      criteria.
- [x] Write implementation plan with affected files, render-only data model, component plan, and test
      strategy.
- [x] Document persistence and performance decision: renderer-derived grouping, local-only expansion
      state, no disk persistence in the first increment.
- [x] Add `updatedAt` to renderer display message types and conversion.
- [x] Add pure activity grouping and duration formatting helper.
- [x] Add `MessageBlockActivityGroup.vue`.
- [x] Update `MessageItemAssistant.vue` to render grouped activity after settled turns.
- [x] Add i18n keys for activity group title and duration units.
- [x] Add renderer unit/component tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run focused renderer tests.
- [x] Run `pnpm run typecheck` if the touched type surface is broader than expected.
