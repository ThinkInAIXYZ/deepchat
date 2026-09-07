# Notification and Feedback System Implementation Plan

## 1. Establish contracts and pure lifecycle cores

Add shared discriminated unions for renderer notification requests and main semantic notification
intents. Replace stringly typed main payloads with code-specific parameter schemas.

Implement framework-independent cores:

- injected monotonic Clock and Scheduler;
- observable Notification Record;
- Operation Registry;
- Episode Registry;
- Notification Policy;
- Notification Manager;
- structured diagnostics port.

Keep Vue, Sonner, Electron, and i18n outside these modules. Add deterministic tests for lifecycle,
aggregation, deadlines, suppression, overflow, and diagnostics before connecting UI.

## 2. Add the Sonner Adapter and Host

Place the renderer-owned implementation in `src/renderer/services/notifications`, outside every
renderer application root. Expose it through the narrow `@renderer-notifications` alias and enforce
that the service never imports chat, settings, floating, splash, or browser-overlay application
code.

Create one adapter boundary that is the only managed caller of `vue-sonner`. It presents a new
Sonner object once and subscribes component-backed content to the external Notification Record.
It exposes dismissal but no Promise or same-ID update API.

Replace both raw Toaster mounts with a shared Host that owns:

- top-right placement and per-renderer offset;
- rich semantic colors overridden by low-saturation DeepChat tokens;
- localized accessibility labels;
- one transient slot and one progress/actionable persistent slot;
- Adapter attach and detach.

Create a stable-height component for aggregate, progress, and actionable records. Verify height and
stack offsets with component tests.

Enforce the import boundary so no business component can reintroduce direct Sonner access.

## 3. Implement Surface Lease and inline operation feedback

Create a composable/controller that:

- owns one operation Feedback Record;
- registers mounted and active Lease state;
- records whether terminal feedback was actually observable while inline;
- uses generation-safe scheduled handoff;
- rechecks the Lease immediately before Toast presentation;
- hands off only terminal feedback that was never observed inline;
- lets returning inline UI reclaim and dismiss Toast;
- pauses inline success fade while the document is hidden;
- keeps error state until retry, edit, discard, or success.
- disposes component-owned controllers and cancels their active Operation records on unmount;
- treats late completions and invalid transition requests as diagnosed no-ops instead of throwing
  through the business operation.

Adopt it first in Agent settings. Derive dirty state from a canonical normalized editable payload,
not from a second manually synchronized flag. Add route-leave and settings-window-close behavior for
dirty or in-flight data. Keep the leave guard as the only owner of the controlled confirmation
dialog, and verify the real dialog action ordering rather than only calling the guard in isolation.

## 4. Add the main-process Window Notification Router

Introduce a main service beside composition, not inside `WindowPresenter`. Inject narrow window
target operations:

- resolve origin and focused window;
- resolve settings and main window IDs;
- send one typed event to one window;
- subscribe to focus/create readiness.

Maintain bounded in-memory actionable pending state and Episode activity. Drop finite low-priority
records when no target exists. Cancel pending records through recovery and quiet expiry.

Replace the generic broadcast publisher only for semantic notification intents. Other typed events
continue to use the existing broadcast behavior.

## 5. Migrate main-owned notification producers

Migrate by meaning:

1. MCP connection failure emits occurrence with server scope; successful connection and explicit
   stop emit recovery.
2. MCP tool-list failure emits occurrence with server scope; a successful list emits recovery.
3. Duplicate MCP add returns a typed route result to the initiating form and displays inline.
4. Provider deeplink parsing returns code-specific failures and routes one localized actionable or
   transient result to settings.
5. Remove process-level network-shaped uncaught-exception notification while retaining structured
   logging.
6. Generalize database repair suggestion to the semantic intent contract and use it as the
   actionable routing acceptance case.

Delete `getErrorMessageLabels` from the migrated main notification path, remove timestamp IDs, and
remove the old event payload.

## 6. Audit and migrate renderer feedback

Classify each current Toast call:

- inline because the initiating surface remains visible;
- semantic transient because the outcome is cross-context or the source disappears;
- actionable because user action remains required;
- progress because a main- or renderer-owned operation continues;
- delete because the UI already expresses the result or the message is redundant.

Apply the same classification to every Surface Lease integration. Retain inline feedback only when
there is a durable initiating control or editable surface with a reserved feedback location.
Maintenance, refresh, cache, and detection actions use a local pending affordance and terminal
transient feedback unless the concrete layout gives the result a meaningful inline home.

The completed Surface Lease audit uses these source-level decisions:

| Decision | Integrations |
| --- | --- |
| Retain editable-surface feedback | Agent, notification hook, provider rate-limit, privacy, MCP policy/API-key, Nowledge, knowledge provider, prompt, OCR configuration, cloud configuration |
| Retain page/dialog feedback | ACP, Cron load/CRUD, environment management, Skills management/import/install, data import/security/repair/reset, Remote channel configuration |
| Retain dedicated-section feedback | update channel/check, Debug guidance/splash, MCP registry configuration |
| Move to transient | provider model refresh; data backup and provider database refresh; sandbox and OCR cache cleanup completion; Cron manual run and restart failure |
| Delete redundant feedback | MCP market install, whose card already owns pending, installed, and per-item error state |

The MCP registry source controls remain inline: URL validation, custom-source persistence, current
source state, and re-detection fallback share one durable advanced-settings surface. They are not a
detached maintenance result despite containing a detection step.

Destructive cleanup failures remain inside their still-open confirmation dialog so retry context
cannot be lost to transient arbitration. Successful completion closes the dialog and uses transient
confirmation.

Migrate callers to the new API and remove `use-toast.ts`. Do not create a compatibility re-export.
Keep stores presentation-free and preserve typed outcomes so components decide the surface.

Keep raw exceptions out of user copy but pass complete error objects to local diagnostics. Treat a
successful persistence response as the persistence truth before applying fallible local projection
or reload work.

Prioritize high-risk false-success paths:

- dialog close after failed add/update/delete;
- blob/download helpers that swallow errors;
- optimistic shortcut/config writes;
- model/config load failures that replace real state with writable defaults;
- Agent settings save and unsaved navigation.

## 7. Validation

Run focused tests after each layer:

- pure core tests with fake clock and scheduler;
- Router tests with fake target windows;
- Adapter tests proving one presentation and no same-ID update;
- stable-height and stack-offset component tests;
- Surface Lease race and document-hidden timing tests;
- observed-inline non-replay and component-unmount disposal tests;
- Agent settings save/dirty/leave tests;
- a real controlled leave-dialog action test and a real-router navigation guard test;
- MCP occurrence/recovery and single-target tests;
- provider deeplink semantic localization tests;
- migrated component regression tests.

Then run:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- relevant main and renderer suites
- full `pnpm test`
- production build when the environment permits

Before every commit:

1. inspect the entire staged diff;
2. list findings in severity order;
3. review hidden side effects, compatibility, edge cases, performance, security, naming, tests, and
   maintenance;
4. fix every finding;
5. rerun affected validation;
6. commit with a Conventional Commit describing the actual behavior, never "review fixes";
7. do not push.

## Compatibility and rollout

The notification API is internal. Migrate producers and consumers atomically within each typed
boundary. Do not keep the old generic event or wrapper as a fallback.

Existing i18n keys may be reused when their semantics remain correct. New keys are added for
previously hard-coded provider deeplink outcomes and inline operation feedback.

Notification state is intentionally ephemeral. Application restart reconstructs durable problems
from their owning services.
