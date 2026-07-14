# Retire Agent Session Presenter - Tasks

## Specification

- [x] Confirm the facade contains forwarding only.
- [x] Inventory production, shared-type, test, guard, and baseline references.
- [x] Define direct owner mapping and compatibility invariants.
- [x] Resolve all clarification items.

## Composition and consumers

- [x] Remove facade construction/property/imports from the composition root.
- [x] Rewire agent tool runtime, skill state, hooks, floating widget, and MCP consumers.
- [x] Replace the route-runtime facade dependency with four separate owner dependencies.
- [x] Keep SessionService, ChatService, Remote, and Cron on their existing narrow ports.

## Retirement

- [x] Delete `AgentSessionPresenter` and its production directory.
- [x] Delete `IAgentSessionPresenter`, its barrel export, and the shared `IPresenter` property.
- [x] Remove all main-process and main-test facade symbols.

## Tests and enforcement

- [x] Remove forwarding-only tests and relocate retained integration coverage.
- [x] Update route/composition consumer tests to use explicit owners.
- [x] Convert architecture checks and fixtures to enforce retirement.
- [x] Update baseline generation and verify reports in an isolated output directory.

## Documentation and validation

- [x] Update maintained session architecture documentation.
- [x] Run focused tests and architecture guards.
- [x] Run full typecheck, main tests, and renderer tests.
- [x] Run format, i18n validation, and lint.
- [x] Review final diff and mark the SDD implemented.

## Baseline note

Canonical reports are generated only from a clean committed tree. The updated generator completed
successfully against an isolated output directory; canonical regeneration belongs to the later
commit/PR workflow.
