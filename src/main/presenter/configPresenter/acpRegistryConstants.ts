export const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

export const ACP_REGISTRY_ICON_PREFIX = 'https://cdn.agentclientprotocol.com/registry/'

export const ACP_REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000

export const ACP_REGISTRY_RESOURCE_DIR = ['resources', 'acp-registry'] as const

export const ACP_REGISTRY_RESOURCE_PATH = ['resources', 'acp-registry', 'registry.json'] as const

export const ACP_REGISTRY_ICON_RESOURCE_DIR = ['resources', 'acp-registry', 'icons'] as const

export const ACP_REGISTRY_ICON_CACHE_DIRNAME = 'icons'

const ACP_REGISTRY_FILE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

export const ACP_LEGACY_AGENT_ID_ALIASES: Record<string, string> = {
  'kimi-cli': 'kimi',
  'claude-code-acp': 'claude-acp',
  'codex-acp': 'codex-acp',
  'dimcode-acp': 'dimcode'
}

export const resolveAcpAgentAlias = (agentId: string): string =>
  ACP_LEGACY_AGENT_ID_ALIASES[agentId] ?? agentId

export const isAcpRegistryIconUrl = (iconUrl: string): boolean =>
  iconUrl.startsWith(ACP_REGISTRY_ICON_PREFIX) && iconUrl.endsWith('.svg')

export const sanitizeAcpRegistryFileSegment = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed || !ACP_REGISTRY_FILE_SEGMENT_PATTERN.test(trimmed)) {
    throw new Error(`Unsafe ACP registry file segment: ${value}`)
  }
  return trimmed
}

export const getAcpRegistryIconFileName = (agentId: string): string =>
  `${sanitizeAcpRegistryFileSegment(agentId)}.svg`
