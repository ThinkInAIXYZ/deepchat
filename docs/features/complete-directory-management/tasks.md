# Tasks

- [x] Inspect issue #1785 and identify required lifecycle and ordering behavior.
- [x] Inspect current DeepChat directory data flow, settings UI, stores, route contracts, and tests.
- [x] Research drag-and-drop and archive/delete interaction patterns.
- [x] Create SDD proposal docs for discussion.
- [x] Add detailed sidebar frontend technical plan for project-group reorder risks.
- [x] Confirm scope decisions before implementation:
  - [x] Delete wording and behavior: "Remove from DeepChat" clears regular `project_dir`, preserves
        messages and real folders.
  - [x] Drag surface: folder icon/name is the pointer drag target; do not add a separate drag
        affordance icon.
  - [x] Sidebar behavior: allow sorting project groups in project-group mode, but do not hide
        archived groups in v1.
  - [x] New chat picker behavior: hide archived/removed directories.
- [x] Add durable environment preference persistence.
- [x] Extend shared types and route contracts.
- [x] Add ProjectPresenter lifecycle and ordering methods.
- [x] Add route dispatcher cases and renderer ProjectClient methods.
- [x] Update project store state/actions for active and archived environments.
- [x] Update `EnvironmentsSettings.vue` with active/archived views, draggable ordering, menu actions,
      and confirmations.
- [x] Apply managed directory order/status to the new chat project picker if confirmed.
- [x] Apply sidebar project group ordering and drag/menu reorder in project-group mode if confirmed.
- [x] Implement sidebar reorder event gates from `sidebar-frontend-technical-plan.md`.
- [x] Add focused main and renderer tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run node and web typecheck.
- [x] Run focused main and renderer regression tests.
- [x] Run e2e/local-data smoke validation.
- [x] Run independent implementation review.
- [x] Fix review findings:
  - [x] Removed paths do not reappear from recent projects after restart/refetch.
  - [x] Environment changes publish a cross-window refresh event.
  - [x] Removing a directory no longer changes session recency.
  - [x] Reorder cannot reactivate archived or removed paths.
  - [x] Archived Settings rows do not expose drag handle semantics.
- [x] Complete non-English locale copy for the directory management UI.
- [x] Fix new chat directory dropdown height and hide missing directories.
- [x] Address PR review comments:
  - [x] Show a destructive toast when settings reorder persistence fails.
  - [x] Send only current known environment paths when reordering.
  - [x] Reject blank project path route inputs after trimming.
  - [x] Scope archived-tab e2e assertions to archived content.
  - [x] Correct Vietnamese Temp copy.
- [ ] User acceptance.
