# Tasks - Agent Session Transfer

- [ ] Contracts: add typed session transfer routes and shared schemas in `sessions.routes.ts`.
- [ ] Client: expose `getAgentTransferImpact`, `moveAgentSessions`, `deleteAgentSessions`, and
      `moveSessionToAgent` from `SessionClient`.
- [ ] SQLite/session manager: add precise `updateAgentId(sessionId, agentId)` and any small counting
      helpers needed for impact summaries.
- [ ] Runtime: add a DeepChat runtime method to update session agent context without deleting
      messages; reject generating sessions and invalidate agent-dependent caches.
- [ ] Main presenter: implement `AgentSessionPresenter` impact summary, batch move, single-session
      move, and delete-by-agent flows.
- [ ] ACP handling: clear stale source ACP bindings and prepare/set target ACP workdir for ACP
      targets.
- [ ] Agent deletion safety: remove silent DeepChat fallback reassignment and prevent deleting an
      agent while sessions still point at it.
- [ ] Renderer dialog: build `AgentDeleteImpactDialog.vue` with move/delete states, target-agent
      selection, blocked-session messaging, loading, and error states.
- [ ] Settings integration: replace `window.confirm` deletion in `DeepChatAgentsSettings.vue` and
      manual-agent deletion in `AcpSettings.vue`.
- [ ] Chat-level move: add the regular idle conversation move action and store/client integration.
- [ ] i18n: add English and Chinese strings first, then run the repository i18n workflow for other
      locales.
- [ ] Tests: add main presenter/runtime/repository coverage and renderer dialog/store coverage.
- [ ] Validation: run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and targeted tests.
