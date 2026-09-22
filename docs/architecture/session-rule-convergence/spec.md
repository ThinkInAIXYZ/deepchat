# Session rule convergence

## Context and scope

Regular and detached creation duplicate persistence, runtime initialization and result assembly.
DeepChat, Remote and renderer duplicate pending action eligibility. ChatService duplicates the
two cleanup operations used by user Stop and timed-out submissions.

Converge these rules at their existing owners, without a new service, schema or public API.

## Design and invariants

- SessionLifecycle owns a private regular-session creation core: normalize DeepChat-only policy
  and tool mode, persist, initialize and clean up initialization failure. Desktop binding, initial
  turn, abort handling, detached metadata and active skills remain in their entry adapters.
- Creation results use the persisted SessionRecord rather than inventing timestamps and repeating
  its fields. Runtime status/provider/model still use the existing assignment fallback. Do not use
  SessionQuery.materializeRequired here: its missing-snapshot provider/model fallback is empty.
- A shared pure pending-action projection owns eligibility and tool identity only. Runtime order
  and origin, Remote payload sanitization and selection, and renderer nested subagent interactions
  retain their current owners. Permission and question payload parsing remain adapter-specific.
- ChatService shares only the concurrent, all-settled cleanup operations. Stop and best-effort
  cancellation retain their timeout boundaries, warning timing and result/error semantics.
- Remote/Scheduler cancel, ACP protocol handling, subagent lifecycle and pending-input scheduling
  are unchanged. No new credentials, dependencies, configuration or external writes are required.

## Acceptance and compatibility

Both creation paths preserve assignment normalization and initialization rollback, return stored
record fields, and retain assignment fallback when runtime snapshot is absent. Desktop abort and
detached skills/metadata continue to behave as before. All three interaction consumers agree on
ordinary pending permission/question eligibility while preserving their specialized projections.
Cleanup attempts both operations even when either throws synchronously; permission cleanup failure
alone does not make Stop fail, cancellation failure or timeout does, and cleanup never replaces a
submission's original timeout error.

This is a local refactor with a correction to returned creation timestamps; rollback requires only
reverting source commits, not migrating data. No unresolved product decisions are included.
