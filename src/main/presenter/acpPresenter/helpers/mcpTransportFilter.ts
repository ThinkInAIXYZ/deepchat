import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

export function filterMcpServersByTransportSupport(
  servers: schema.McpServer[],
  mcpCapabilities?: schema.McpCapabilities
): schema.McpServer[] {
  if (!Array.isArray(servers) || servers.length === 0) return []

  return servers.filter((server) => {
    if ('type' in server) {
      if (server.type === 'http') {
        return Boolean(mcpCapabilities?.http)
      }
      if (server.type === 'sse') {
        return Boolean(mcpCapabilities?.sse)
      }
      return false
    }

    // Stdio transport: all agents must support it.
    return true
  })
}
