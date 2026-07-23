# Tasks: Independent Agent Skills

- [x] T01 - Remove built-in Agent configuration inheritance
  - Add independent resolver defaults and fail-closed invalid-row behavior.
  - Materialize legacy effective configs under migration version 3.
  - Move app defaults away from built-in Agent aliases.
  - Remove built-in Memory invalidation fan-out.

- [x] T02 - Introduce scoped Skill ownership
  - Add canonical per-Agent roots and management-state v2.
  - Scope discovery, caches, watcher invalidation and catalog events.
  - Scope Skill read/write/install/delete/extension/script operations.

- [x] T03 - Migrate existing Skills and Sessions
  - Migrate v1 management state into the built-in Agent scope.
  - Copy each manual Agent's legacy effective Skills through staging.
  - Filter persisted Session selections against the owning Agent catalog.
  - Make migration restartable and preserve evidence on failure.

- [x] T04 - Enforce runtime Agent scope
  - Resolve Session Agent before Skill prompt/tool/script operations.
  - Remove runtime dependence on `enabledSkillNames` for new writes.
  - Recompute effective Skills after transfer, rebind and subagent creation.

- [x] T05 - Add internal and external Agent import
  - Add typed source, preview and execute contracts.
  - Revalidate and copy safely with skip/rename/overwrite conflicts.
  - Exclude Plugin-owned contributions from snapshot copies.

- [x] T06 - Add renderer workflow
  - Add source/Skill/conflict/result dialog using shadcn-vue controls.
  - Keep target Agent explicit and reject stale async responses.
  - Add i18n strings and scoped refresh behavior.

- [x] T07 - Update maintained architecture contracts
  - Update Agent, Tool and Skills management documentation.
  - Mark historical inheritance statements as superseded.

- [ ] T08 - Validate
  - [x] Run focused main and renderer tests while implementing.
  - [x] Run format, i18n, lint, typecheck and broad test suites.
    - Renderer: 189 files, 1492 tests passed.
    - Main: 380 files, 4384 tests passed; the existing architecture baseline test timed out at the default 10s under the full parallel run and passed standalone with a 30s timeout.
  - [ ] Run the packaged two-Agent same-name Skill E2E (not run in this worktree).
