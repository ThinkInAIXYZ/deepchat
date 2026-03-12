import type { ToolRegistrySource } from './toolRegistry'

export type ToolRouteDecision = {
  target: ToolRegistrySource
  permissionType?: 'read' | 'write' | 'all' | 'command'
}

export function resolveToolRoute(_toolName: string): ToolRouteDecision {
  return { target: 'mcp' }
}
