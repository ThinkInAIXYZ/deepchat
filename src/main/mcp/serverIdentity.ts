import type { MCPServerConfig, McpAuthorizationConfig, McpServerIdentity } from '@shared/types/mcp'
import { createHash, randomUUID } from 'node:crypto'

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }

  return value
}

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value))

const normalizeUrl = (value?: string): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  try {
    const url = new URL(value)
    url.hash = ''
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

const normalizeAuthorization = (
  authorization?: McpAuthorizationConfig
): McpAuthorizationConfig | undefined => {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return undefined
  }

  if (
    !['none', 'interactive', 'client_credentials', 'private_key_jwt', 'cross_app_access'].includes(
      authorization.mode
    )
  ) {
    return undefined
  }

  return {
    mode: authorization.mode,
    protectedResourceUrl: normalizeUrl(authorization.protectedResourceUrl),
    authorizationServerIssuer: normalizeUrl(authorization.authorizationServerIssuer),
    clientMetadataUrl: normalizeUrl(authorization.clientMetadataUrl),
    clientId:
      typeof authorization.clientId === 'string'
        ? authorization.clientId.trim() || undefined
        : undefined,
    scopes: Array.isArray(authorization.scopes)
      ? Array.from(
          new Set(
            authorization.scopes
              .filter((scope): scope is string => typeof scope === 'string')
              .map((scope) => scope.trim())
              .filter(Boolean)
          )
        ).sort()
      : undefined,
    identityProfileId:
      typeof authorization.identityProfileId === 'string'
        ? authorization.identityProfileId.trim() || undefined
        : undefined,
    keyAlgorithm:
      authorization.keyAlgorithm === 'RS256' || authorization.keyAlgorithm === 'ES256'
        ? authorization.keyAlgorithm
        : undefined
  }
}

export const sanitizeMcpAuthorizationConfig = normalizeAuthorization

const bindingMaterial = (config: Partial<MCPServerConfig>): Record<string, unknown> => ({
  type: config.type,
  endpoint: normalizeUrl(config.baseUrl),
  command: config.type === 'stdio' ? config.command?.trim() : undefined,
  authorization: normalizeAuthorization(config.authorization)
})

const generationMaterial = (config: Partial<MCPServerConfig>): Record<string, unknown> => ({
  ...bindingMaterial(config),
  args: config.args ?? [],
  env: config.env ?? {},
  customHeaders: config.customHeaders ?? {},
  inheritEnv: config.inheritEnv
})

export const computeMcpBindingHash = (config: Partial<MCPServerConfig>): string =>
  createHash('sha256')
    .update(canonicalJson(bindingMaterial(config)))
    .digest('hex')

export const hasMcpIdentityBearingChange = (
  current: Partial<MCPServerConfig>,
  next: Partial<MCPServerConfig>
): boolean => canonicalJson(generationMaterial(current)) !== canonicalJson(generationMaterial(next))

const normalizeServerId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalized
  )
    ? normalized
    : undefined
}

export const normalizeMcpServerIdentity = (
  config: Partial<MCPServerConfig>,
  previous?: Partial<MCPServerConfig>
): McpServerIdentity => {
  const changed = previous ? hasMcpIdentityBearingChange(previous, config) : false
  const previousGeneration =
    typeof previous?.configGeneration === 'number' && previous.configGeneration > 0
      ? Math.floor(previous.configGeneration)
      : undefined
  const configuredGeneration =
    typeof config.configGeneration === 'number' && config.configGeneration > 0
      ? Math.floor(config.configGeneration)
      : undefined

  return {
    serverId:
      normalizeServerId(previous?.serverId) || normalizeServerId(config.serverId) || randomUUID(),
    configGeneration: changed
      ? (previousGeneration ?? configuredGeneration ?? 1) + 1
      : (previousGeneration ?? configuredGeneration ?? 1),
    bindingHash: computeMcpBindingHash(config)
  }
}
