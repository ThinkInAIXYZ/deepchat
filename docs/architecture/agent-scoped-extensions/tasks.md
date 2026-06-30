# Tasks: Agent-scoped Plugins, Skills, and MCP

- [x] Inspect current plugin, skill, MCP, and DeepChat agent architecture.
- [x] Create SDD artifacts for agent-scoped extension architecture.
- [x] Resolve open questions about plugin runtime boundary and new-agent defaults.
- [x] Extend DeepChat agent config types with plugin/skill/MCP policy fields.
- [x] Normalize/merge policy fields in `AgentRepository`.
- [x] Filter runtime MCP tools/servers by session agent policy and enforce call-time allow-list checks.
- [x] Filter runtime skill catalog and active skill loading by session agent policy.
- [ ] Split plugin-contributed runtime resources and plugin-owned MCP servers by session agent policy.
- [x] Add renderer client/helpers for reading and saving selected agent policies.
- [x] Add chat plugin hub UI for per-agent plugin/skill/MCP selection.
- [x] Keep `/plugins/skills` on the original Skills management view while making enable/disable update only the current agent.
- [x] Keep `/plugins/mcp` on the original MCP management view while making server enable/disable update only the current agent.
- [x] Update i18n strings.
- [x] Add or update tests.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck:web`, and targeted Vitest suites after the latest UI-scope correction.
- [x] Address review findings: preserve undefined MCP/plugin runtime policies, respect the global MCP master switch in agent pages, use effective agent config in management views, keep skill detail state fresh, allow agent-scoped toggles for DeepChat-managed MCP servers, and enforce `enabledSkillNames` for `skill_list`/`skill_view`.
- [x] Address review hardening for plugin-sourced MCP ownership, stale agent policy loads, and omitted active-skill overrides.
