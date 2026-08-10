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

## Validation

- [x] Run focused main and renderer Vitest suites.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [ ] Complete Windows and POSIX manual validation from the plan.

## Validation Notes

- Renderer validation passes: Project store 13/13, full Session store 80/80 (with an 8 GB Node
  heap because the default 4 GB runner exhausts memory), sidebar 62/62, and New Thread 43/43.
- Focused Project service validation for environment projection and directory selection passes 9/9,
  including new/reactivated top insertion and duplicate active order stability.
- The native SQLite preference-table suite is skipped because its optional native runtime is not
  available in this workspace; the reactivation/order regression is included for CI hosts with
  that runtime.
- The full `projectService.test.ts` file has two existing Windows-only failures: its default
  workspace assertions expect `/mock/...`, while Node resolves the mocked path as `C:\mock\...`.
  The failures do not execute the changed renderer code or the added selection-order contracts.
