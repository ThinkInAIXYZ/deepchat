# ACP Startup Notification Order Spec

## User Need

Startup should not log an ACP typed event failure when the ACP registry finishes before the unified
agent repository is attached.

## Problem

`ConfigPresenter` starts ACP registry initialization during the config lifecycle hook. If the registry
finishes before `Presenter` attaches `AgentRepository`, `notifyAcpAgentsChanged()` attempts to read
ACP state through `getAcpAgents()`, which throws `Unified agent repository is not attached.`

## Acceptance Criteria

- ACP registry startup notification is deferred while the unified agent repository is unavailable.
- The deferred ACP notification is emitted once the repository is attached.
- Runtime ACP mutations still publish model, agent, and session refresh notifications immediately.
- Real repository errors after attachment are not silently swallowed.
- Unit coverage verifies deferred startup notification behavior.

## Constraints

- Keep the fix inside existing Presenter/ConfigPresenter boundaries.
- Do not change ACP provider data shape, route contracts, or stored configuration.
- Do not add renderer UI changes.

## Non-Goals

- Do not redesign all early startup typed event publishing.
- Do not change provider DB refresh behavior.

## Open Questions

None.
