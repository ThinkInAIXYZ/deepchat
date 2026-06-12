# Tasks — `/agent` Remote Command

- [x] Types: register `agent` command on each channel command list; add agent menu types, TTL, and callback codecs (`types.ts`).
- [x] BindingStore: agent menu state lifecycle helpers + `setChannelDefaultAgentId`.
- [x] Runner: `listAvailableAgents` + `setChannelDefaultAgent` (alias-tolerant match, ACP workdir guard, new-session creation).
- [x] Telegram router: `/agent` menu, agent callback dispatch, expired-menu handling, success/cancel formatting.
- [x] Text routers (Feishu / QQBot / Discord / Weixin iLink): `case 'agent'` + `handleAgentCommand` + `formatAgentOverview`.
- [x] Tests: bindingStore, runner, Telegram router (menu + callback), Feishu router (text overview + switch).
- [x] `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run i18n`.
- [ ] Manual e2e on at least one channel: list agents, switch (with current agent's same-id case), switch to ACP without workdir → expect failure.
