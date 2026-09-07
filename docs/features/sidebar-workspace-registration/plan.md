# Sidebar Workspace Registration Plan

## Previous Data Flow

```text
project.selectDirectory
  -> new_projects upsert + environment preference active (no explicit top insertion)
  -> Project snapshot version + environments-changed event
  -> projectStore.environments
                                  \
                                   X  WindowSideBar uses only order metadata
                                  /
paginated Session store -> filtered Session groups -> remove empty groups -> sidebar rows
```

The main process already persists zero-Session selections, but a new preference receives the
fallback sort order and therefore appears after explicitly ordered workspaces. The missing behavior
spans the Project ordering mutation and the renderer projection. It does not require another
persistence entity.

## Target Data Flow

```text
Add workspace
  -> Project picker/register + prepend newly active path
     (without changing current draft selection)
  -> versioned projectStore snapshot
  -> reveal policy: clear search + set project grouping
                                      |
projectStore active environments -----+----> local sidebar workspace view model
Session store visible groups ---------+        |
                                               +-> empty row
                                               +-> populated row + Sessions
                                               +-> historical Session-only row

Empty row activation
  -> projectStore.selectProject(path, 'manual')
  -> sessionStore.startNewConversation({ refresh: true, projectDir: path })
  -> one-shot intent survives active-session teardown
  -> first non-draft Session updates both Session and Project projections
```

## Renderer Store Changes

Extend `projectStore.openFolderPicker` with the minimum caller control needed to separate adding a
sidebar workspace from selecting the current New Thread workspace:

```ts
openFolderPicker(options?: { select?: boolean }): Promise<string | null>
```

- Default `select` to `true` so New Thread keeps its current behavior.
- Return `null` only for native picker cancellation.
- On selection, wait for `refreshProjectSnapshot()` and return the committed path.
- When `select !== false`, preserve the current `selectProject(path, 'manual')` behavior.
- On a real failure, set the store error and rethrow so the caller can notify the user. Update the
  New Thread caller to handle that rejection rather than leaving a fire-and-forget promise.
- Let the existing refresh owner coalesce the route response and the potentially earlier
  `project:environments-changed` event. Do not create a second event listener in the sidebar.

Add an idempotent `sessionStore.setGroupMode(mode)` action and keep `toggleGroupMode()` as its UI
wrapper. Add success needs a deterministic project-mode request after a modal picker; calling a
toggle based on stale pre-picker state can switch in the wrong direction if the user or another
window changes the setting while the picker is open. Serialize requested writes, track the last
persisted mode separately, and return the exact in-flight promise to same-target callers. A failed
write rolls back only the latest visible request to the last successfully persisted mode.

## Sidebar View Model

Keep the merged type local to `WindowSideBar.vue` unless tests show a second real consumer. It needs
enough metadata to avoid inferring domain state from visible children:

```ts
type SidebarWorkspaceGroup = SessionGroup & {
  environment?: EnvironmentSummary
}
```

True-empty, lifecycle, availability, and action state are derived from this optional environment
at render time. Do not add this renderer-only metadata to shared contracts.

### Project-Mode Merge

1. Build filtered Session groups exactly as today, retaining only groups with at least one matching
   Session when search is active.
2. Extract the Chat/no-project groups before the workspace merge.
3. Build path-identity maps for active, archived, and removed Project summaries. Comparison removes
   trailing separators from ordinary paths while preserving POSIX and Windows drive roots. Do not
   introduce unsafe cross-platform case folding or separator rewriting in the renderer.
4. Once Project metadata is ready and Session search is empty, iterate active environments in
   persisted order:
   - skip `defaultChatWorkspacePath`;
   - attach the matching visible Session group or `[]`;
   - use `environment.name` for a zero-Session row;
   - set `isTrueEmpty` only when `sessionCount === 0 && sessions.length === 0`;
   - set `canStartConversation` only for active, existing paths.
5. Mark consumed Session groups by path, then append remaining Session-derived workspace groups in
   their existing stable order. Classify known archived/removed paths as historical and disable
   reorder/new-conversation actions.
6. Use the Project store's committed-snapshot readiness as the only metadata readiness signal. If
   Project metadata is not ready, fall back to the current Session-only rendering and keep reorder
   disabled. Never fabricate active metadata from a failed snapshot.
7. During Session search, do not synthesize active rows without matching children. Existing active
   matches still use Project order; historical matches remain after active matches.

Date grouping remains Session-only. The successful Add handler switches to project grouping before
attempting to focus the result.

### Ordering And Drag

- Iterate active environments in their Project order rather than sorting a Session-derived subset.
- Keep the Chat workspace outside the draggable list and preserve its hidden position when sending
  a full reorder payload, matching the current visible-subset merge.
- Include true empty and missing active rows in active reorder.
- Keep historical groups after active groups and outside reorder.
- Keep reorder disabled during Session search, initial loading, pin animation, and drag, as today.
- Preserve path-keyed collapse state across reorder and the empty-to-populated transition.

## Sidebar Interaction Changes

### Header Action

Add `isAddingWorkspace` and a guarded `handleAddWorkspace`:

1. capture no pre-picker grouping or selection assumptions;
2. call `projectStore.openFolderPicker({ select: false })`;
3. return without side effects on `null`;
4. clear `sessionSearchQuery` after success;
5. await `sessionStore.setGroupMode('project')`;
6. await the reactive render, find the path-keyed row, and `scrollIntoView({ block: 'nearest' })`;
7. focus the row and apply a brief, reduced-motion-safe reveal state;
8. if the path is `defaultChatWorkspacePath`, reveal/focus Chat instead;
9. notify on picker, snapshot, or grouping failure and always release the busy guard.

The selected path is already durable before reveal. A grouping-persistence or focus failure must
not roll it back.

### Group Row

- True empty and existing: omit `aria-expanded`; primary activation and the always-visible plus
  call `handleNewChatForProject(path)`.
- Populated active: retain folder click-to-collapse and the hover/focus plus action.
- Active missing: show a warning icon and localized unavailable tooltip; omit/disable the plus and
  do not interpret row activation as a draft request.
- Historical: retain collapse and Session access, but hide new-conversation and reorder affordances.
- Show the ellipsis menu for every active managed group rather than coupling it to the reorder gate.
  Keep move items disabled through `canMoveProjectGroup`; place Archive after a separator.
- Archive opens a local guarded confirmation dialog using the existing
  `settings.environments.confirm.*`, `actions.archive`, and `errors.archiveTitle` copy. On confirm,
  call `projectStore.archiveEnvironment(path)` and keep the dialog open until the archive route's
  returned snapshot version is committed and the path is projected as archived.
- Keep the dialog open and notify on archive failure. Disable cancel and confirmation while the
  request is pending so the mutation cannot be submitted twice.
- Use `sessions.length > 0` as a safety override when a Session event arrives before the updated
  Project snapshot, so a temporarily stale `sessionCount === 0` cannot turn a populated header into
  a new-conversation action.

The new conversation continues through the existing sidebar helper and one-shot intent. No new
Session route is required.

## Main Process And Contracts

A small main-process ordering change is required:

- `NewEnvironmentPreferencesTable.activateAtTop()` uses one upsert to preserve an already-active
  path's order or assign a newly active path before the current minimum explicit order.
- `ProjectService.selectDirectory()` wraps recent-project upsert and preference activation in one
  database transaction. It does not call `getEnvironments()` or synchronously check unrelated
  filesystem paths.
- It increments the snapshot version and returns that exact version with the selected path.
- `ProjectService.getSnapshot()` already unions usage with preferences, so a selected zero-Session
  path appears in `environments`.
- `project.selectDirectory` publishes the same version in its `select` event.
- first non-draft Session persistence already refreshes environment usage and notifies the Project
  snapshot owner.

Keep the ordering decision in Project rather than synthesizing a temporary renderer order. Do not
add a parallel `workspace.add` route or another table.

Sidebar archive adds the mutation version to the existing typed `project.archiveEnvironment`
result. The Project store requires that version and the archived lifecycle projection before the
dialog can close. No new route or i18n key is required.

`ProjectSnapshot` also carries `defaultChatWorkspacePath`. The Project store marks snapshot
readiness when it commits that complete projection; the sidebar does not maintain a second local
readiness flag. A committed lifecycle snapshot clears a manually selected path when that path is
archived or removed.

## Compatibility And Edge Cases

- **Duplicate active selection:** one path-keyed row; explicit order survives; focus the existing
  row.
- **Archived/removed selection:** `markActive` clears the lifecycle state and the selection mutation
  places the reactivated path first. Regular Sessions cleared during remove remain unassigned;
  preserved ACP workdir remains an existing Session concern.
- **Default Chat selection:** no Workspace duplicate; reveal Chat.
- **Missing after registration:** the committed active row remains visible with unavailable state;
  starting a conversation is blocked until the path exists again, but Archive remains available.
- **Single active workspace:** its menu remains available for Archive while all four move actions
  are disabled.
- **Archive with Session history:** the active affordances disappear after the snapshot, while the
  Session-derived historical group remains navigable.
- **Archive without Session history:** the synthetic active row disappears after the snapshot.
- **Archive failure:** keep the dialog and row, suppress exception details from user copy, and allow
  an explicit retry or cancel.
- **Pinned-only or agent-filtered workspace:** active row remains but is not called Empty when the
  durable count is non-zero.
- **Pagination:** active headers may render before their Session page. Scroll loading remains driven
  by the existing container; headers must not trigger duplicate Session fetches.
- **Event ordering:** path identity and the safety override make Session-first and Project-first
  updates converge on one row.
- **Multiple windows:** every renderer receives the versioned Project event. Only the initiating
  sidebar changes its local search, grouping, scroll, and focus.
- **Temporary paths:** a zero-Session environment can exist only through durable preference
  metadata. The built-in Chat path is excluded; existing Session-derived temporary behavior stays
  unchanged.

## Affected Files

Expected implementation surface:

- `src/main/project/index.ts`
- `src/main/project/data/tables/newEnvironmentPreferences.ts`
- `src/main/project/routes.ts`
- `src/renderer/src/components/WindowSideBar.vue`
- `src/renderer/src/stores/ui/project.ts`
- `src/renderer/src/stores/ui/session.ts`
- `src/renderer/src/pages/NewThreadPage.vue`
- `src/shared/contracts/routes/project.routes.ts`
- `src/shared/utils/filesystem.ts`
- `src/renderer/src/i18n/*/chat.json`
- focused renderer and Project service tests

The archive result and Project snapshot gain required fields. No database schema or new route is
required.

## Test Strategy

### Project Store

- picker cancellation returns `null` and changes neither selection nor snapshot state;
- sidebar registration mode returns the path without changing `selectedProjectPath`;
- New Thread default mode still selects the path;
- an event arriving before the route response coalesces into the requested snapshot version;
- picker/snapshot failure is rethrown after setting store error;
- duplicate, archived, and removed selection converge on one active snapshot row.

### Session Store

- `setGroupMode('project')` is idempotent and persists once;
- concurrent set/toggle requests serialize and the last requested mode wins;
- persistence failure rolls back only the corresponding current request;
- consecutive failed writes roll back to the last persisted mode, and same-target callers observe
  the in-flight failure.

### Sidebar Component

- header action accessibility, busy guard, cancellation, failure, and success;
- success from date mode and active search reveals/focuses the selected project row;
- active zero-Session environment renders without a Session-derived group;
- default Chat is not duplicated;
- exact path identity preserves same-named workspaces;
- search hides empty rows; agent filtering, pinning, and pagination do not mislabel non-empty paths;
- empty row and plus dispatch the exact one-shot `projectDir` flow;
- active missing and historical groups cannot start a new conversation;
- empty groups participate in persisted reorder;
- one active group still exposes Archive while move items are disabled;
- archive confirmation dispatches the exact path, prevents duplicate submission, and preserves the
  row/dialog on failure;
- archived rows converge to hidden zero-Session or navigable historical presentation according to
  Session history;
- Session-first and Project-first first-Session updates produce one populated row and preserve
  collapse identity.
- POSIX and Windows drive roots remain workspace identities rather than collapsing into Chat or a
  drive-relative path.
- initial Project failure followed by a later successful store refresh enables the merged
  projection without remounting the sidebar.

### Project Main Process

- selecting a directory performs no environment projection or unrelated filesystem existence
  checks;
- recent-project and preference activation execute in one transaction;
- new/reactivated paths sort first while duplicate active selection retains its explicit order;
- archive responses expose the exact committed snapshot version.

### Main And Integration

- selected directory with no usage appears in the active snapshot with `sessionCount: 0`;
- a newly selected or reactivated directory is persisted before every previously active path;
- duplicate active selection does not create duplicate preference/project rows or reset explicit
  order;
- archived/removed selection reactivates the path and advances the version;
- first regular and ACP non-draft Session updates advance the environment projection;
- a renderer-level integration test covers event-driven empty-row appearance without remounting.

## Validation

During implementation, run the smallest relevant Project, store, New Thread, and sidebar Vitest
suites. Before handoff run:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Manually verify native picker cancellation/success, keyboard focus, add from date/search modes,
duplicate selection, missing path recovery, active-session teardown, and DeepChat/ACP first-Session
transitions on at least Windows plus one POSIX platform.

## Rollback

The feature adds no schema or persisted workspace entity. Removing the header action and merged
renderer projection restores the previous UI; directories selected while the feature was enabled
remain valid managed environments in Settings and New Thread, and their latest persisted order
remains intact.
