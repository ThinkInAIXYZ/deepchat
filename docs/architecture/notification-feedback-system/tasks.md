# Notification and Feedback System Tasks

## Specification

- [x] Audit renderer Toast volume, variants, actions, wrapper behavior, and duplicate queues.
- [x] Trace the five main-process error emitters and current localization ownership.
- [x] Verify Sonner v2.0.9 same-ID timer and height-measurement behavior.
- [x] Define the responsibility graph, lifecycle ownership, routing, overflow, and timing invariants.
- [x] Write `spec.md`, `plan.md`, and `tasks.md`.

## Contracts and lifecycle cores

- [x] Add the renderer notification request contract.
- [x] Add the main semantic notification intent contract.
- [x] Add injectable Clock, Scheduler, and privacy-safe diagnostics ports.
- [x] Add observable notification records.
- [x] Implement and test Operation Registry.
- [x] Implement and test Episode Registry.
- [x] Implement and test transient and actionable Policy.
- [x] Implement and test Notification Manager.

## Sonner presentation

- [x] Add the one-way Sonner Adapter without Promise or update APIs.
- [x] Add stable-height aggregate, progress, and actionable content.
- [x] Replace both raw Toaster mounts with the shared Host.
- [x] Add top-right offsets, localized accessibility labels, and semantic tokens.
- [x] Enforce the direct `vue-sonner` import boundary.
- [x] Test stable identity, native timing, maximum lifetime, height, and stack offsets.

## Inline feedback and Agent settings

- [x] Add generation-safe Surface Lease handoff.
- [x] Pause inline success fade while the document is hidden.
- [x] Add the inline operation feedback component/controller.
- [x] Add Agent settings pending, success, persistent failure, and retry states.
- [x] Derive Agent dirty state from canonical editable data.
- [x] Guard route and window close for dirty or in-flight Agent data.
- [x] Test handoff races, reclamation, hidden-document timing, and close behavior.
- [x] Prevent observed inline results from replaying as Toast.
- [x] Dispose component-owned controllers and active operations on unmount.
- [x] Make framework-facing feedback transitions non-throwing and diagnostic.
- [x] Give settled clearing and pending cancellation unambiguous names.
- [x] Make the controlled leave dialog dispatch one explicit decision per user action.
- [x] Keep persisted Agent success independent from fallible local projection.

## Main Router and semantic producers

- [x] Add single-target Window Notification Router.
- [x] Add bounded pending actionable storage and recovery cancellation.
- [x] Migrate MCP connection occurrence and recovery.
- [x] Migrate MCP tool-list occurrence and recovery.
- [x] Return duplicate MCP add failure to the initiating surface.
- [x] Replace provider deeplink arbitrary messages with typed error codes.
- [x] Remove process-level network-shaped user notification.
- [x] Generalize database repair suggestion to the semantic intent contract.
- [x] Delete main-process notification localization and timestamp IDs.
- [x] Delete the old `notification.error` contract and both renderer queues.

## Renderer audit and migration

- [x] Classify every existing Toast call.
- [x] Move visible save/edit outcomes inline.
- [x] Remove redundant success and duplicate error messages.
- [x] Correct false-success dialog and state transitions.
- [x] Migrate retained transient, actionable, and progress intents.
- [x] Keep stores UI-agnostic and return truthful typed outcomes.
- [x] Delete `use-toast.ts` without a compatibility entry point.
- [x] Re-audit every Surface Lease against a durable inline source.
- [x] Move unanchored maintenance, refresh, cache, and detection results to transient feedback.
- [x] Restore complete error objects in local diagnostics without exposing them in UI copy.

## Validation and delivery

- [x] Run focused core, Router, Adapter, Surface Lease, Agent, MCP, and deeplink tests.
- [x] Run formatter and i18n validation.
- [x] Run lint and type checking.
- [x] Run relevant main and renderer suites.
- [x] Run the full test suite and production build when permitted.
- [x] Complete a severity-ordered review before every commit and fix all findings.
- [x] Commit locally with Conventional Commits.
- [x] Do not push.
- [x] Add real-dialog discard, observed-result non-replay, and unmount-disposal seam tests.
- [x] Add real-router coverage for settings navigation blocking.
- [x] Re-run focused and full validation after the corrective audit.
