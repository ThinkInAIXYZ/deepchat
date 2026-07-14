# Multi-Agent Isolation — Phase 0 Tasks

- [x] Write architecture isolation contract
- [x] Write issue specs for MCP allow-list, workspace leak, transfer reset
- [x] Wire `enabledMcpServerIds` into DeepChat extension policy / catalog / fingerprint / call
- [x] Fix AgentToolManager allowed-directories cross-session leak
- [x] Reset permissions / skills / plan on `setSessionAgentContext`
- [x] Block permission-retry success leak; align deferred tool options
- [x] Update tests and run format / i18n / lint / focused vitest
- [x] Phase 1: subagent target host policy isolation
- [x] Make missing conversation workdirs fall back to the isolated default, never manager state
- [x] Clear MCP session approvals through the aggregate permission port
- [x] Reject tool calls absent from the current session definitions
- [x] Add review regression tests and rerun validation
