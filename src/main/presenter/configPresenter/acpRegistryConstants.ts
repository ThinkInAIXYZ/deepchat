export const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

export const ACP_REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000

export const ACP_REGISTRY_RESOURCE_PATH = ['resources', 'acp-registry', 'registry.json'] as const

export const ACP_LEGACY_AGENT_ID_ALIASES: Record<string, string> = {
  'kimi-cli': 'kimi',
  'claude-code-acp': 'claude-acp',
  'codex-acp': 'codex-acp',
  'dimcode-acp': 'dimcode'
}

export const resolveAcpAgentAlias = (agentId: string): string =>
  ACP_LEGACY_AGENT_ID_ALIASES[agentId] ?? agentId
