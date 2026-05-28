export const ACP_LEGACY_AGENT_ID_ALIASES: Record<string, string> = {
  'kimi-cli': 'kimi',
  'claude-code-acp': 'claude-acp',
  'codex-acp': 'codex-acp',
  'dimcode-acp': 'dimcode'
}

export const resolveAcpAgentAlias = (agentId: string): string =>
  ACP_LEGACY_AGENT_ID_ALIASES[agentId] ?? agentId
