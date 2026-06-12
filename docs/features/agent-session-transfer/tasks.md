# Tasks - Agent Session Transfer

- [x] Contracts: add typed session transfer routes and shared schemas in `sessions.routes.ts`.
- [x] Client: expose `getAgentTransferImpact`, `moveAgentSessions`, `deleteAgentSessions`, and
      `moveSessionToAgent` from `SessionClient`.
- [x] SQLite/session manager: add precise `updateAgentId(sessionId, agentId)` and any small counting
      helpers needed for impact summaries.
- [x] Runtime: add a DeepChat runtime method to update session agent context without deleting
      messages; reject generating sessions and invalidate agent-dependent caches.
- [x] Main presenter: implement `AgentSessionPresenter` impact summary, batch move, single-session
      move, and delete-by-agent flows.
- [x] ACP handling: clear stale source ACP bindings when moving ACP chats to DeepChat, and block ACP
      targets so DeepChat-to-ACP and ACP-to-ACP moves cannot occur.
- [x] Agent deletion safety: remove silent DeepChat fallback reassignment and prevent deleting an
      agent while sessions still point at it.
- [x] Renderer dialog: build a responsive transfer dialog with a viewport-aware max height, fixed
      header/footer, internal scroll body, move/delete states, target-agent selection,
      blocked-session messaging, loading, and error states.
- [x] Settings integration: replace `window.confirm` deletion in `DeepChatAgentsSettings.vue` and
      manual-agent deletion in `AcpSettings.vue`.
- [x] Review fix: route installed registry ACP uninstall through the transfer dialog and keep a
      repository/config fallback that blocks uninstall while sessions remain.
- [x] Review fix: clear source ACP provider bindings only after target DeepChat context and
      `new_sessions` ownership updates succeed.
- [x] Review fix: report partial batch move/delete results when a multi-session operation fails
      after some mutations have already completed.
- [x] Chat-level move: add `Move conversation` to `ChatTopBar.vue`'s right-side `...` menu between
      pin/unpin and clear messages, then wire it to the transfer dialog and store/client integration.
- [x] i18n: add English and Chinese strings first, then run the repository i18n workflow for other
      locales.
- [ ] Tests: main presenter coverage exists for impact summaries, DeepChat moves, ACP-to-DeepChat,
      and ACP target rejection; renderer dialog/store and repository regression tests remain as
      follow-up coverage.
- [x] Validation: run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, typecheck, targeted
      tests, and `git diff --check`.
