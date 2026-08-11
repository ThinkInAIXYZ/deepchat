# Sidebar Workspace Registration Tasks

## Specification

- [x] Reclassify #2115 as a user-visible capability change rather than a local sidebar defect.
- [x] Audit current Chat/Workspace layout, Project snapshot ownership, Session grouping, draft
  intent, lifecycle, pagination, and reorder behavior.
- [x] Define true empty workspace semantics independently of visible filtered children.
- [x] Reject unfiltered numeric Session counts in the filtered/paginated sidebar.
- [x] Define add, reveal, duplicate, default Chat, missing, archived, and removed behavior.
- [x] Update the maintained complete-directory-management contract.

## Picker And Store Semantics

- [x] Let `projectStore.openFolderPicker` return the selected path and support registration without
  replacing the current New Thread selection.
- [x] Surface real picker/snapshot failures while keeping cancellation a no-op.
- [x] Add idempotent persisted `sessionStore.setGroupMode(mode)` behavior and retain the toggle UI.
- [x] Add focused Project and Session store tests for cancellation, selection mode, event races,
  duplicate selection, serialization, and rollback.

## Sidebar Projection And UX

- [x] Add the accessible, guarded Add workspace header action.
- [x] Merge active Project environments with visible Session groups in persisted path order.
- [x] Exclude the built-in Chat path and keep historical groups Session-derived only.
- [x] Render true empty and missing states without global Session counts.
- [x] Reveal successful additions by clearing search, setting project grouping, scrolling, and
  focusing the path-keyed row.
- [x] Route empty-row activation through the existing one-shot workspace intent.
- [x] Disable new-conversation for missing groups and both new/reorder affordances for historical
  groups.
- [x] Preserve drag, collapse, pagination, pin animation, shortcuts, and reduced-motion behavior.
- [x] Add localized Add workspace, Empty, unavailable, and failure copy.

## Regression Coverage

- [x] Cover zero-Session rendering and event-driven refresh without remounting.
- [x] Cover add from date grouping and Session search, plus cancellation and failure.
- [x] Cover duplicate, archived/removed reactivation, missing paths, and default Chat deduplication.
- [x] Cover agent-filtered, pinned-only, paginated, searched, and reordered workspace groups.
- [x] Cover exact project intent through active-session teardown for DeepChat and ACP.
- [x] Cover both first-Session event orderings and assert one stable populated row.
- [x] Keep committed tests focused on observable cross-domain contracts.

## Ordering Follow-up

- [x] Define newly selected/reactivated paths as first while keeping duplicate active selection
  order-idempotent.
- [x] Persist the ordering rule in `ProjectService.selectDirectory()`.
- [x] Cover new, reactivated, and duplicate active selection in focused Project service tests.
- [x] Assert that the sidebar renders the committed newly selected path first.
- [x] Synchronize the feature and maintained directory-management contracts.

## Sidebar Archive Follow-up

- [x] Define Archive availability independently from reorder availability.
- [x] Reuse the existing Project archive route, store action, confirmation copy, and lifecycle
  projection without a new contract or i18n key.
- [x] Add Archive after the move actions in every active workspace row menu.
- [x] Add guarded confirmation, pending state, and localized failure feedback.
- [x] Cover single-row availability, successful lifecycle projection, and failure retention.
- [x] Run focused and repository validation.

## Stability Hardening

- [x] Return the archive mutation version and keep confirmation open until that snapshot commits.
- [x] Make Project-store snapshot readiness authoritative and include Chat workspace identity in
  the snapshot.
- [x] Clear manually selected New Thread paths when lifecycle state becomes archived or removed.
- [x] Preserve POSIX and Windows drive roots in workspace grouping identity.
- [x] Roll group-mode failures back to the latest persisted mode and propagate coalesced failures.
- [x] Replace directory-selection projection scans with one transactional database activation.
- [x] Add focused regression coverage for every hardening contract.

## Validation

- [x] Run focused main and renderer Vitest suites.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [ ] Complete Windows and POSIX manual validation from the plan.

## Validation Notes

- Renderer validation passes: Project store 15/15, full Session store 83/83, sidebar 64/64, both
  New Thread suites 42/42, and Project client coverage 43/43. The Session suite requires an 8 GB
  worker heap because the default 4 GB runner exhausts memory.
- Focused main validation passes 139 tests across Project service, route contracts/dispatch, and
  shared filesystem utilities.
- The native SQLite preference-table suite is skipped because its optional native runtime is not
  available in this workspace. Its five regression tests remain enabled for CI hosts with that
  runtime, and the exact activation SQL was exercised successfully with the system SQLite runtime.
- Formatting, i18n validation, lint, node/web typecheck, and the renderer architecture baseline
  check pass.
