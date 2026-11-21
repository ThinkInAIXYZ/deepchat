import type { MCPServerConfig } from '@shared/types/mcp'
import type { DimMcpServer } from '@/agent/dim/mcp'
import { resolveMcpEnvironmentBinding } from './environmentBindings'

interface ConfigurationOptions {
  selectedServerIds?: readonly string[] | null
  enabled: boolean
  servers: Record<string, MCPServerConfig>
  pluginOwns(serverName: string): boolean
  authorization(serverName: string, config: MCPServerConfig): Promise<string | undefined>
  // Process packaging remains a desktop concern. A null result requires the compatibility
  // plugin (for example an isolated process environment the pinned native transport cannot set).
  stdio(serverName: string, config: MCPServerConfig): Promise<DimMcpServer | null>
}

/** Export only selected transport configuration. No tool calls, live clients or stores cross it. */
export async function nativeMcpSessionConfiguration(options: ConfigurationOptions): Promise<{
  servers: Record<string, DimMcpServer>
  bridgeServerNames: string[]
}> {
  const selected = options.selectedServerIds == null ? null : new Set(options.selectedServerIds)
  const servers: Record<string, DimMcpServer> = Object.create(null)
  const bridgeServerNames: string[] = []
  for (const [name, config] of Object.entries(options.servers)) {
    if (selected && !selected.has(name)) continue
    const pluginOwned =
      options.pluginOwns(name) || !!config.ownerPluginId || config.source === 'plugin'
    if ((!options.enabled && !pluginOwned) || !config.enabled) continue
    // Plugin-managed processes and in-memory desktop services retain their existing product
    // lifetime. The injected compatibility catalog exposes their non-native capabilities.
    if (pluginOwned || config.type === 'inmemory') {
      bridgeServerNames.push(name)
      continue
    }
    if (config.type === 'stdio') {
      const native = await options.stdio(name, config)
      if (native) servers[name] = native
      else bridgeServerNames.push(name)
      continue
    }
    const endpoint = new URL(config.baseUrl ?? '')
    if (
      !['https:', 'http:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    )
      throw new Error('MCP remote endpoint is invalid')
    const headers: Record<string, string> = Object.create(null)
    for (const [key, value] of Object.entries(config.customHeaders ?? {})) {
      if (typeof value !== 'string') throw new Error('MCP custom header is invalid')
      headers[key] = resolveMcpEnvironmentBinding(value, config.environmentVariables)
    }
    const authKeys = Object.keys(headers).filter((key) => key.toLowerCase() === 'authorization')
    if (authKeys.length > 1)
      throw new Error('MCP configuration has duplicate Authorization headers')
    if (!authKeys.length) {
      const authorization = await options.authorization(name, config)
      if (authorization) headers.Authorization = authorization
    }
    servers[name] = { type: config.type, url: endpoint.toString(), headers }
  }
  return { servers, bridgeServerNames }
}
