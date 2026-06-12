# Tasks

- [x] Move `ACP_LEGACY_AGENT_ID_ALIASES` and `resolveAcpAgentAlias` into `src/shared/utils/acpAgentAlias.ts`; re-export from `src/main/presenter/configPresenter/acpRegistryConstants.ts`.
- [x] Rewrite `sanitizeDefaultAgentId` to return the SQLite agent's own id (alias used only for matching).
- [x] Patch `RemoteSettings.vue` `defaultAgentOptions` to alias-reconcile a legacy `currentAgentId` to the canonical option.
- [x] Add main-side unit tests covering the four sanitize outcomes (exact / alias-key / alias-value / no-match).
- [x] Add renderer-side unit test covering `defaultAgentOptions` legacy-id reconciliation.
- [x] Run formatting, i18n generation, lint, typecheck, and the new tests.
