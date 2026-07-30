# Notification and Feedback System Specification

## Background

DeepChat currently treats user feedback as a rendering call rather than a product decision.
Renderer code contains 217 direct Toast calls, including 132 destructive calls and only two
actions. The existing `use-toast.ts` wrapper narrows Sonner's semantic API, supplies a competing
default duration, hides stable IDs from callers, and exposes an update path that replaces the
Sonner toast object.

Main-process notification behavior is also fragmented:

- five `notification.error` emitters publish final strings and timestamp IDs;
- three MCP emitters translate strings in the main process;
- provider deeplink errors forward arbitrary exception messages;
- a process-level network-error fallback decides user interruption from exception substrings;
- main and settings renderers each implement a separate error queue and forced three-second timer;
- the generic event publisher broadcasts the same notification to every window.

These decisions produce duplicate notifications, stale localization, false success, silent
failure, queue-driven Toast trains, and no consistent answer to whether feedback belongs inline,
in one renderer, or nowhere.

The Agent settings save flow exposes the missing model most clearly. The user can start a save, but
the UI has no owned operation state or inline completion feedback. Adding one success Toast would
hide that ownership gap while preserving the same problem at every other call site.

## Goal

Create one notification and feedback architecture in which:

1. business code describes what happened;
2. Operation state owns work that has a lifecycle;
3. Episode state owns whether a recurring problem still exists;
4. Policy decides whether interruption is justified;
5. Surface Lease decides whether feedback remains inline or moves to Toast;
6. the main-process Router selects one target window;
7. Sonner renders an already-decided presentation.

The seven responsibilities form a graph, not a mandatory seven-stage pipeline. A simple copy
confirmation must not create Operation, Episode, Lease, and Router state merely to reach Sonner.

## Required Invariants

### Responsibility graph

Responsibilities are composed only when the scenario needs them:

| Scenario | Required responsibilities |
| --- | --- |
| Copy confirmation | Policy -> Sonner |
| Agent settings save | Operation -> Surface Lease -> Policy -> inline or Sonner |
| MCP connection failure | Episode -> Policy -> Router -> Sonner |
| Main-owned model download | Operation -> Router -> progress surface |
| Download failure | Operation terminal -> Episode -> Policy -> Router |
| Database repair suggestion | Episode -> Policy -> Router -> actionable Sonner |

No layer may become a generic God Object:

- business callers do not select arbitrary durations, queues, positions, or renderer targets;
- Operation does not decide presentation or user interruption;
- Episode does not render or resolve window ownership;
- Policy does not call Vue, Sonner, Electron, or i18n;
- Surface Lease does not change semantic severity;
- Router does not query arbitrary business services to revalidate state;
- Sonner Adapter does not classify errors or own domain lifecycle.

### Shared notification contract

Renderer notification infrastructure lives in `src/renderer/services/notifications` because it is
consumed independently by the chat and settings renderer applications. It may depend on Vue,
Sonner, and cross-process contracts, but it must not import any renderer application root, store,
feature, or composition runtime. Each renderer bundle creates its own runtime instance; no
in-memory singleton is shared across webContents.

Renderer-local requests use a discriminated union:

- simple success and information do not require invented keys or scopes;
- deduplicated notifications require a stable key;
- aggregated notifications require a scope;
- actionable notifications require a stable identity and action;
- progress notifications require an operation ID;
- raw `Error`, VNode, arbitrary callbacks, and arbitrary `type: string` do not cross the shared
  main-to-renderer contract.

Main-process notification intents use a closed, typed semantic union. Each code has typed
parameters and routing metadata. Main never sends final localized title or description strings.
The target renderer translates at delivery time using its current locale.

Notification identity is derived from semantic code, scope, entity, and operation fields. Callers
never use timestamps to manufacture uniqueness.

The existing `databaseSecurity.repairSuggested` event is the first contract migration case. Its
ambiguous `title` and `message` fields become one semantic code with typed `reason` parameters.
The current tree contains two renderer consumers but no active producer, so this migration does not
claim that database repair is already routed at runtime.

### Operation Registry

Operation Registry represents work with an explicit lifecycle:

```text
created -> running -> succeeded | failed | cancelled
```

- each operation has one stable operation ID;
- progress mutations update one record in place;
- progress does not use Episode quiet TTL or recovery;
- business code, not Notification Manager, decides timeout, cancellation, and failure;
- terminal success closes progress and may produce inline or transient confirmation;
- terminal failure closes progress and may produce a failure occurrence;
- Sonner loading identity is never updated in place to success or error.

Operation process ownership is fixed when the operation is created:

- renderer-owned operations are bounded by that renderer's lifetime;
- a component-owned feedback controller is disposed when its owning component unmounts; disposal
  cancels an active renderer operation, scheduled presentation work, and subscriptions;
- asynchronous completion after disposal is an expected lifecycle race and is ignored rather than
  surfaced as an unhandled error;
- data-sensitive renderer operations prevent route or window close until safe or explicitly
  discarded;
- operations intended to outlive a renderer are main-owned from the beginning and use Router;
- renderer records are never serialized and migrated to main during window close.

Window crashes cannot rely on feedback or close guards for correctness. Main-process atomic writes
and reloading the real persisted state remain the data-integrity boundary.

### Episode Registry

Episode Registry represents a problem that can repeat and later recover:

```text
first occurrence
  -> active episode
  -> repeated occurrence: aggregate
  -> explicit recovery or quiet TTL: close
  -> later occurrence: new episode
```

- identity is derived from semantic code, scope, and entity;
- repeated occurrences update count and last-seen time without extending presentation lifetime;
- explicit recovery closes active and pending presentations immediately;
- quiet TTL is only a fallback for sources that cannot emit recovery;
- dismissal suppresses the current episode without claiming the problem recovered;
- a dismissed active episode is not presented again until recovery or quiet-TTL closure;
- scope aggregation and identity deduplication remain separate operations.

Router delivery checks Episode Registry's active state. Router never registers arbitrary
`revalidate` callbacks into MCP, providers, database, or other domain services.

### Policy

Policy owns semantic priority, presentation class, duration budget, maximum lifetime, aggregation,
and overflow behavior.

Initial defaults are explicit and centralized:

| Policy value | Default |
| --- | ---: |
| Success display budget | 2,400 ms |
| Information display budget | 4,000 ms |
| Warning display budget | 6,000 ms |
| Error display budget | 8,000 ms |
| Success maximum lifetime | 15,000 ms |
| Information maximum lifetime | 30,000 ms |
| Warning maximum lifetime | 45,000 ms |
| Error maximum lifetime | 60,000 ms |
| Surface handoff grace | 200 ms |
| Transient candidate freshness | 8,000 ms |
| Actionable renderer queue capacity | 3 records |
| Actionable renderer queue TTL | 10 minutes |
| Main pending actionable capacity | 16 records |
| Main pending actionable TTL | 10 minutes |
| Default inferred-recovery quiet TTL | 30 seconds |

Individual semantic codes may tighten these values. Data-integrity actionable records require
explicit recovery or user resolution and do not use the default queue TTL. Changing a value
requires Policy tests and a user-impact reason; callers cannot override it ad hoc.

Transient presentation contains:

```text
one visible transient + one replacement candidate
```

- same key or scope aggregates into the existing record;
- a higher-priority candidate may preempt the visible lower-priority transient;
- one still-relevant warning or error may remain as the replacement candidate;
- a better candidate replaces the previous candidate;
- low-priority success and information may be dropped while the slot is occupied;
- the candidate is presented only while fresh and, when applicable, while its episode is active;
- transient behavior never grows into a FIFO queue.

Lossiness is intentional. If dropping a notification would prevent the user from completing a
required action, the intent was misclassified and must be actionable.

Actionable presentation contains:

```text
one visible actionable + one bounded arbitration queue
```

- actionable intents never downgrade to finite transient errors;
- same identity aggregates rather than enqueueing;
- higher priority wins, with FIFO order inside one priority;
- the visible component reports the pending count;
- queue capacity, TTL, and overflow are explicit Policy constants;
- overflow retains the highest-priority records and emits diagnostics;
- no "view all" action is shown without a real destination.

Progress and actionable feedback share one persistent visual slot. Actionable feedback preempts a
visible progress record; the still-active progress record keeps updating off-screen and resumes
after actionable arbitration is empty. User dismissal suppresses that progress presentation until
the operation settles, so subsequent progress events do not make it reappear. This preserves one
persistent interruption without losing Operation state.

Sonner manages the pause-aware display budget for finite presentations. Manager owns a separate
absolute `maxLifetime` that repeated aggregation cannot extend. Actionable records do not expire
from display duration; they close from action, dismissal, recovery, or explicit lifecycle policy.

### Surface Lease and inline feedback

A Feedback Record has one logical result and at most one active presentation.

Surface Lease is reserved for feedback bound to an initiating control or editable surface that the
user is expected to keep watching. A one-shot maintenance, refresh, detection, or cache action
whose result is not anchored to a durable inline source uses local pending affordance plus terminal
transient feedback. Operation lifecycle and Surface Lease are independent responsibilities.

The owning view registers a Surface Lease. Inline availability is:

```text
mounted && route-or-section-active
```

Real pixel visibility, intersection observation, occlusion, and focus heuristics are outside the
model.

When inline becomes unavailable:

1. schedule handoff through the injected Scheduler;
2. associate the callback with a generation token;
3. wait the Policy handoff grace period;
4. re-read both Lease and Feedback Record;
5. create Toast only if inline is still unavailable and feedback is still relevant.

Reactivation cancels scheduled handoff. A newly created Lease immediately checks existing feedback.
If Toast already exists, inline reclaims the same record and dismisses Toast with
`surface-reclaimed`; it does not create a second message.

Terminal feedback records whether it has been observed inline:

- settlement while at least one Lease is active and the document is visible marks the result
  observed;
- becoming visible with an active Lease marks an existing terminal result observed;
- only an unobserved terminal result may hand off to Toast;
- leaving after observing inline success or error never replays the same result as Toast;
- a result that settles after its Lease becomes inactive remains unobserved and hands off;
- observation is presentation metadata, not a second business result.

Losing inline availability changes only the presentation surface. It never changes ordinary error
into actionable. Actionability comes from the operation result.

Inline success confirmation:

- appears next to the action source;
- uses a short fade budget;
- does not start or consume that budget while the document is hidden;
- pauses while the document is hidden and resumes when visible;
- does not disappear before the user could observe it;
- errors remain until retry, edit, navigation with explicit discard, or success.

Dirty and in-flight data risk is handled by route and window-close guards, not Toast.

The settings leave guard is the sole owner of its controlled confirmation dialog. Dialog buttons
must issue explicit `cancelLeave` or `discardAndLeave` decisions and must not also use close
primitives that mutate `open`. Escape and outside-dismiss paths explicitly cancel the pending leave
request. A persisted operation result and its local UI projection are separate boundaries: failure
to refresh or project locally after confirmed persistence must not report the persistence itself as
failed.

The framework-facing Surface Feedback Controller is a resilience boundary around the strict
Operation Registry:

- `begin`, terminal settlement, settled-result clearing, and pending cancellation report whether
  the requested transition was accepted;
- lifecycle races, duplicate transitions, invalid display data, and registry integration failures
  are diagnosed with the complete error object and do not throw into business code;
- invalid terminal display data still closes or cancels the underlying operation so it cannot leak;
- `clearSettled`, `cancelPending`, and `dispose` have distinct names and state ownership;
- one `useSurfaceFeedback` binding owns one controller lifetime.

User-facing copy never contains arbitrary exception text. Local developer diagnostics retain the
complete error object, including message, stack, and cause. Privacy-safe structured diagnostics are
required only when data leaves the local logging boundary.

### Sonner Adapter

`vue-sonner` remains the only Toast rendering library. No second component library is added.

Only Sonner Adapter and Host may import `vue-sonner`. The managed Adapter API exposes initial
presentation and dismissal only. It does not expose Promise or same-ID update behavior.

The following are prohibited:

- `toast.promise`;
- calling Sonner again with an existing managed ID;
- using Sonner update-by-ID for aggregation;
- importing `vue-sonner` from business components or stores;
- creating another queue in a renderer root or store.

Simple success and information use Sonner string content. Error, progress, and actionable
presentations may use a stable component-backed record. The Sonner toast object is created once;
aggregation mutates the external observable record without replacing the Sonner object.

Sonner v2.0.9 measures Toast height only at mount. Every component-backed Toast therefore has stable
visual geometry:

- fixed outer block size for its presentation variant;
- stable line count;
- single-line truncated title and entity labels;
- a reserved secondary line where needed;
- tabular, bounded count display such as `99+`;
- non-wrapping action labels;
- full information remains available through the action and accessible labels.

If future UI requires variable-height live content, the height measurement integration must be
fixed or replaced explicitly. DOM mutation hacks are not allowed.

The Host uses:

- top-right placement;
- a 96 px main-window top offset that clears app chrome;
- a 52 px settings-window top offset that clears its title bar;
- one transient and one persistent visible record;
- low-saturation DeepChat semantic tokens;
- localized container and close-button accessible labels.

### Main-process Router

Main-owned semantic notification routing resolves one target:

```text
origin window
  -> compatible focused window
  -> preferred existing window
  -> bounded pending actionable storage
```

- renderer-local feedback does not round-trip through main;
- one intent is sent to one renderer, never broadcast;
- settings-only actions wait for a settings-compatible window;
- passive notifications do not open windows;
- success and information may be dropped with diagnostics when no target exists;
- actionable and data-integrity records may wait in bounded in-memory storage;
- pending records are removed by matching recovery or expiry;
- pending storage is not persisted across application restart;
- durable conditions are re-derived from their actual source on startup;
- delivery after focus or creation still requires an active Episode.

The Router uses existing `WindowPresenter` targeting primitives. It does not add notification
policy to `WindowPresenter`.

### Main emitter migration

The five current `notification.error` emitters are handled by semantics, not mechanically mapped:

1. MCP connection failure becomes a scoped occurrence and explicit recovery.
2. MCP tool-list failure becomes a scoped occurrence and recovery.
3. MCP duplicate add is returned to the initiating UI and rendered inline; it is not a global
   main-process notification.
4. Provider deeplink parsing/opening uses typed domain error codes rather than arbitrary exception
   messages.
5. process-level network-shaped `uncaughtException` remains logging only. User notification moves
   to a business boundary that has operation and entity context.

The old generic `notification.error` event and its renderer consumers are deleted atomically.

### Diagnostics

Policy and Router emit low-cardinality structured diagnostics for:

- lower-priority drop;
- candidate replacement;
- candidate expiry;
- actionable overflow;
- no compatible target;
- stale or recovered pending record.

Diagnostics contain code, reason, policy priority, and scope kind only. They never include final
copy, raw exception strings, entity values, user input, or secrets.

Sustained drop rates trigger classification review. Drop rate alone must not justify increasing
transient capacity.

### Performance

- key and scope lookup are O(1) through `Map`;
- no deep reactive scan or history scan occurs on notification delivery;
- aggregation mutates one observable record and does not remount Toast;
- active deadline scheduling uses one injected scheduler and bounded records;
- no watcher is added per historical event;
- one main-owned intent is serialized to one target renderer;
- pending and actionable collections have hard bounds;
- high-frequency diagnostics are rate-limited or aggregated.

## User Interaction

### Agent settings save

Before:

```text
┌──────────────────────────────────────┐
│ Agent settings                       │
│ ...                                  │
│                         [ Save ]      │
│                                      │
│ No pending, success, or failure state│
└──────────────────────────────────────┘
```

After:

```text
┌──────────────────────────────────────┐
│ Agent settings                       │
│ ...                                  │
│              Saving…    [ Saving… ]  │
│                                      │
│              Saved ✓    [ Save ]     │
└──────────────────────────────────────┘
```

Failure stays inline while the surface exists:

```text
│ Could not save. Your changes remain. │
│                         [ Try again ] │
```

If the surface becomes unavailable and the failure still matters, the same Feedback Record moves
to a Toast after the handoff grace period.

### Toast placement

Before:

```text
┌──────────────────────────── window ──┐
│                                      │
│                                      │
│                         ┌──────────┐ │
│                         │ Toast    │ │
│                         └──────────┘ │
└──────────────────────────────────────┘
```

After:

```text
┌──────────────────────────── window ──┐
│ app chrome                            │
│                         ┌──────────┐ │
│                         │ Toast    │ │
│                         └──────────┘ │
│                                      │
└──────────────────────────────────────┘
```

## Acceptance Criteria

1. Agent settings exposes pending, inline success, persistent inline error, retry, dirty state, and
   route/window-close protection.
2. Inline success does not consume its fade budget while the document is hidden.
3. Surface handoff is debounced, generation-safe, and rechecks availability immediately before
   Toast creation.
4. Returning to the surface reclaims one Feedback Record without duplicate inline and Toast copy.
5. No managed code calls `toast.promise` or updates a Sonner toast by ID.
6. Aggregating a record calls Adapter presentation once, changes external content in place, and
   does not restart the native display budget.
7. `maxLifetime` cannot be extended by repeated occurrences and dismisses a stuck finite
   presentation.
8. Component height and stack offsets remain stable across count changes, long entity labels, and
   locale changes.
9. MCP connection and tool-list failures aggregate by server and close on recovery.
10. Main notifications reach one compatible renderer and never duplicate across main and settings
    windows.
11. Pending actionable records deliver only while their Episode remains active.
12. Provider deeplink errors use typed codes and renderer localization.
13. The process-level network-shaped uncaught-exception Toast is removed.
14. The two renderer error queues and forced three-second timers are removed.
15. The old `notification.error` contract and current `use-toast.ts` compatibility wrapper are
    removed.
16. Every existing Toast call is audited and migrated to inline feedback, a semantic notification,
    or deletion.
17. Stores remain UI-agnostic and expose truthful results to callers.
18. False success paths do not close dialogs, clear state, or report success after failed work.
19. Transient and actionable overflow produce privacy-safe diagnostics.
20. Focused unit and component tests use injected clocks rather than real sleeps.

## Constraints

- Preserve context isolation and typed preload/IPC boundaries.
- Preserve unrelated renderer behavior and user data.
- Use existing shadcn-vue primitives and vue-i18n.
- Retain `vue-sonner@2.0.9`; add no notification or UI component dependency.
- Do not persist notification state.
- Do not introduce a compatibility alias for the removed wrapper.
- Keep code, identifiers, comments, and repository documentation in English.
- Before every commit, review the complete staged diff by severity for hidden side effects,
  compatibility, edge cases, performance, security, naming, test gaps, and maintenance cost.
- Fix findings before committing.
- Do not push the branch.

## Non-Goals

- Building a notification center or historical inbox.
- Sending operating-system notifications.
- Persisting pending notifications across application restart.
- Replacing Sonner or the existing component library.
- Turning every async function into an Operation.
- Turning every error into an Episode or actionable alert.
- Rewriting unrelated settings forms or stores.
- Inferring operation failure from missing progress events.

## Open Questions

None. Responsibility ownership, lifecycle boundaries, routing, timing, overflow, localization, and
window-close behavior are fixed by this specification.
