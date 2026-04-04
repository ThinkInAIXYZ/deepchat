# ACP Agent Uninstall Plan

## Main Process

- Add `configPresenter.uninstallAcpRegistryAgent(agentId)` as the orchestration entrypoint.
- Keep sqlite persistence in `AgentRepository`.
- Add uninstall cleanup to `AcpLaunchSpecService` for registry install artifacts with path-boundary checks.
- After uninstall, mark the agent disabled and set install state back to `not_installed`.
- Reuse `handleAcpAgentsMutated([agentId])` so ACP processes are released and renderer state refreshes.

## Renderer

- Add uninstall actions in `AcpSettings.vue` for both installed cards and registry overlay rows.
- Confirm uninstall with a lightweight AlertDialog-based confirmation flow (`AlertDialog` component/modal) so the renderer uses the built-in AlertDialog UI for lightweight confirmation.
- Refresh ACP settings data after uninstall completes.

## Tests

- Cover binary uninstall cleanup and safe path handling in `AcpLaunchSpecService`.
- Cover repository/state reset for registry agents.
- Cover renderer uninstall CTA wiring in `AcpSettings.vue`.
