/**
 * Identity of the built-in DeepChat agent. Lives in kernel contracts so runtime modules can
 * reference it without importing the SQLite-backed repository barrel; the repository re-exports
 * it for host consumers.
 */
export const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'
