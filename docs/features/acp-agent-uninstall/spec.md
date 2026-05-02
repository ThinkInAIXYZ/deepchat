# ACP Agent Uninstall

## Summary

Add uninstall support for registry-backed ACP agents. The current ACP settings flow can install and enable registry agents, but it cannot uninstall them after they are added.

## User Stories

- As a user, I can uninstall an installed ACP registry agent from settings.
- As a user, uninstall removes local install artifacts and hides the agent from enabled ACP model choices.
- As a user, old sessions referencing that agent are preserved and can recover by reinstalling later.

## Acceptance Criteria

- ACP settings shows an uninstall action for installed registry agents.
- Uninstall deletes local binary install directories when the agent uses a binary distribution.
- Uninstall resets registry install state to `not_installed` and disables the agent.
- Uninstalled registry agents no longer appear in the enabled ACP model list.
- Existing session records keep their `agentId`; uninstall does not delete session history.

## Non-Goals

- No hard-delete of the registry agent row.
- No schema migration.
- No forced rewrite of historical session, remote binding, or subagent references.
