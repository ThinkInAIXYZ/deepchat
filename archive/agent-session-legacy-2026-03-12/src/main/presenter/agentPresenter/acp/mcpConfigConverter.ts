import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { MCPServerConfig } from '@shared/presenter'

const normalizeStringRecordToArray = (
  record: Record<string, unknown> | undefined | null
): Array<{ name: string; value: string }> => {
  if (!record || typeof record !== 'object') return []
  return Object.entries(record)
    .map(([name, value]) => ({
      name: name?.toString().trim(),
      value: typeof value === 'string' ? value : String(value ?? '')
    }))
    .filter((entry) => entry.name.length > 0)
}

const normalizeHeaders = (
  record: Record<string, string> | undefined | null
): Array<{ name: string; value: string }> => {
  if (!record || typeof record !== 'object') return []
  return Object.entries(record)
    .map(([name, value]) => ({
      name: name?.toString().trim(),
      value: value?.toString() ?? ''
    }))
    .filter((entry) => entry.name.length > 0)
}

export function convertMcpConfigToAcpFormat(
  serverName: string,
  config: MCPServerConfig
): schema.McpServer | null {
  if (!config || !serverName) return null

  if (config.type === 'inmemory') {
    return null
  }

  if (config.type === 'stdio') {
    return {
      name: serverName,
      command: config.command,
      args: Array.isArray(config.args) ? config.args : [],
      env: normalizeStringRecordToArray(config.env)
    }
  }

  if (config.type === 'http' || config.type === 'sse') {
    const url = config.baseUrl?.toString().trim()
    if (!url) return null
    return {
      type: config.type,
      name: serverName,
      url,
      headers: normalizeHeaders(config.customHeaders)
    }
  }

  return null
}
