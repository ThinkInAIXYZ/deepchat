# ACP Client Runtime Tasks

- [x] Add SDD spec, plan, and tasks documents.
- [x] Add internal ACP runtime facade and prompt controller.
- [x] Stop warmup from creating temporary sessions with empty MCP servers.
- [x] Use real MCP selections for debug `session/new` and `session/load`.
- [x] Make debug `initialize` report initialized connection state instead of sending a second initialize request.
- [x] Register load-session handlers before `session/load` replay can emit updates.
- [x] Enforce realpath workspace guards for ACP fs reads/writes.
- [x] Bind terminal cwd to the registered ACP session workdir.
- [x] Refresh ACP settings on agent-change events.
- [x] Release running ACP processes before repair.
- [x] Add targeted ACP regression coverage.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
