# Tasks

- [x] Re-state issue #1762 after the previous fix and capture the updated failure modes.
- [x] Inspect current sidebar pagination, grouping, and lightweight session data flow.
- [x] Add tests that reproduce pagination getting stuck when rendered content changes without a scroll event.
- [x] Update sidebar pagination triggers so visible-height changes schedule auto-fill checks.
- [x] Harden the auto-fill loop against cursor stalls without stopping on harmless dedupe.
- [x] Compare the live renderer state with the local database session list.
- [x] Clone the next-page cursor before sending it through IPC.
- [x] Run focused tests.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
