import type { MCPConfig } from '@shared/presenter'

export type McpConfigQueryPayload = {
  mcpServers: MCPConfig['mcpServers']
  defaultServers: string[]
  mcpEnabled: boolean
}

export type McpConfigSyncResult = {
  nextConfig: MCPConfig
  shouldApply: boolean
  mcpEnabledChanged: boolean
}

export const computeMcpConfigUpdate = (
  current: MCPConfig,
  next: McpConfigQueryPayload,
  queryInFlight: boolean
): McpConfigSyncResult => {
  const previousMcpEnabled = current.mcpEnabled
  const previousReady = current.ready

  if (previousReady && previousMcpEnabled && queryInFlight && next.mcpEnabled === false) {
    return {
      nextConfig: current,
      shouldApply: false,
      mcpEnabledChanged: false
    }
  }

  const mcpEnabledChanged = previousMcpEnabled !== next.mcpEnabled

  return {
    nextConfig: {
      mcpServers: next.mcpServers ?? {},
      defaultServers: next.defaultServers ?? [],
      mcpEnabled: next.mcpEnabled,
      ready: true
    },
    shouldApply: true,
    mcpEnabledChanged
  }
}
