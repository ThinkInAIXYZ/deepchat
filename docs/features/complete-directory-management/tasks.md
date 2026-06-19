# Tasks

- [x] Inspect issue #1785 and identify required lifecycle and ordering behavior.
- [x] Inspect current DeepChat directory data flow, settings UI, stores, route contracts, and tests.
- [x] Research drag-and-drop and archive/delete interaction patterns.
- [x] Create SDD proposal docs for discussion.
- [x] Add detailed sidebar frontend technical plan for project-group reorder risks.
- [ ] Confirm scope decisions before implementation:
  - [ ] Delete wording and behavior: "Remove from DeepChat" clears regular `project_dir`, preserves
        messages and real folders.
  - [ ] Drag surface: folder icon/name is the pointer drag target; do not add a separate drag
        affordance icon.
  - [ ] Sidebar behavior: allow sorting project groups in project-group mode, but do not hide
        archived groups in v1.
  - [ ] New chat picker behavior: hide archived/removed directories.
- [ ] Add durable environment preference persistence.
- [ ] Extend shared types and route contracts.
- [ ] Add ProjectPresenter lifecycle and ordering methods.
- [ ] Add route dispatcher cases and renderer ProjectClient methods.
- [ ] Update project store state/actions for active and archived environments.
- [ ] Update `EnvironmentsSettings.vue` with active/archived views, draggable ordering, menu actions,
      and confirmations.
- [ ] Apply managed directory order/status to the new chat project picker if confirmed.
- [ ] Apply sidebar project group ordering and drag/menu reorder in project-group mode if confirmed.
- [ ] Implement sidebar reorder event gates from `sidebar-frontend-technical-plan.md`.
- [ ] Add focused main and renderer tests.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
