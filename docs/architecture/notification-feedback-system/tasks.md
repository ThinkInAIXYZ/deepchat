# Notification and Feedback System Tasks

## Specification

- [x] Audit renderer Toast volume, variants, actions, wrapper behavior, and duplicate queues.
- [x] Trace the five main-process error emitters and current localization ownership.
- [x] Verify Sonner v2.0.9 same-ID timer and height-measurement behavior.
- [x] Define the responsibility graph, lifecycle ownership, routing, overflow, and timing invariants.
- [x] Write `spec.md`, `plan.md`, and `tasks.md`.

## Contracts and lifecycle cores

- [x] Add the renderer notification request contract.
- [ ] Add the main semantic notification intent contract.
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
- [ ] Enforce the direct `vue-sonner` import boundary.
- [ ] Test stable identity, native timing, maximum lifetime, height, and stack offsets.

## Inline feedback and Agent settings

- [ ] Add generation-safe Surface Lease handoff.
- [ ] Pause inline success fade while the document is hidden.
- [ ] Add the inline operation feedback component/controller.
- [ ] Add Agent settings pending, success, persistent failure, and retry states.
- [ ] Derive Agent dirty state from canonical editable data.
- [ ] Guard route and window close for dirty or in-flight Agent data.
- [ ] Test handoff races, reclamation, hidden-document timing, and close behavior.

## Main Router and semantic producers

- [ ] Add single-target Window Notification Router.
- [ ] Add bounded pending actionable storage and recovery cancellation.
- [ ] Migrate MCP connection occurrence and recovery.
- [ ] Migrate MCP tool-list occurrence and recovery.
- [ ] Return duplicate MCP add failure to the initiating surface.
- [ ] Replace provider deeplink arbitrary messages with typed error codes.
- [ ] Remove process-level network-shaped user notification.
- [ ] Generalize database repair suggestion to the semantic intent contract.
- [ ] Delete main-process notification localization and timestamp IDs.
- [ ] Delete the old `notification.error` contract and both renderer queues.

## Renderer audit and migration

- [ ] Classify every existing Toast call.
- [ ] Move visible save/edit outcomes inline.
- [ ] Remove redundant success and duplicate error messages.
- [ ] Correct false-success dialog and state transitions.
- [ ] Migrate retained transient, actionable, and progress intents.
- [ ] Keep stores UI-agnostic and return truthful typed outcomes.
- [ ] Delete `use-toast.ts` without a compatibility entry point.

## Validation and delivery

- [ ] Run focused core, Router, Adapter, Surface Lease, Agent, MCP, and deeplink tests.
- [ ] Run formatter and i18n validation.
- [ ] Run lint and type checking.
- [ ] Run relevant main and renderer suites.
- [ ] Run the full test suite and production build when permitted.
- [ ] Complete a severity-ordered review before every commit and fix all findings.
- [ ] Commit locally with Conventional Commits.
- [ ] Do not push.
