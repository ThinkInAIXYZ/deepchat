# ACP Runtime Install-State Identity Regression

## Issue

A direct ACP draft can start its process and complete `session/new`, then fail when the presenter
immediately reads the session snapshot:

```text
Error: ACP session identity mismatch for <app-session-id>
```

The remote ACP session exists at this point, but the app session cannot finish initialization.

## Location and root cause

`AcpAgentRuntime` caches a serialized identity for each hydrated app session. The identity currently
includes the complete ACP descriptor and config, including `installState.installedAt` and
`installState.lastCheckedAt`.

Preparing a registry ACP agent resolves its launch spec and persists a refreshed install state.
That refresh changes the observation timestamps after the first hydration. The following direct
`snapshot()` operation rebuilds its runtime input from the catalog, serializes the refreshed
timestamps, and falsely treats the same ACP agent as a different runtime identity.

The ACP process startup, protocol handshake, and remote session creation are successful. The failure
is in the local identity projection performed immediately afterward.

## Fix plan

- Exclude install observation timestamps from the cached runtime identity.
- Keep all launch- and catalog-relevant descriptor/config fields in the identity.
- Add a regression test that rehydrates the same registry agent after only its install timestamps
  change.
- Confirm that a meaningful install-state change still rejects reuse of the cached runtime.

## Compatibility boundaries

- Preserve strict mismatch rejection for ACP id, source, descriptor/config, scope, distribution,
  version, status, and install-directory changes.
- Preserve workdir update behavior; workdir remains outside runtime identity.
- Do not change ACP process ownership, protocol messages, remote-session persistence, presenter
  routing, memory behavior, or DeepChat agent behavior.
- Do not clear or recreate a healthy remote ACP session for timestamp-only catalog refreshes.

## Tasks

- [x] Add the timestamp-refresh regression test.
- [x] Normalize volatile install observation fields in ACP runtime identity.
- [x] Verify meaningful identity changes still fail closed.
- [x] Run focused tests and required repository checks.

## Validation

- Rehydrating a registry ACP session after `installedAt` and `lastCheckedAt` refresh returns the
  existing instance.
- Changing a launch-relevant install-state field still reports `ACP session identity mismatch`.
- Existing ACP runtime, direct backend, and presenter tests pass.
- Formatting, i18n validation, lint, Node typecheck, architecture lint, and main-process tests pass.

## GitHub issue

Not linked. No GitHub issue sync was requested.
