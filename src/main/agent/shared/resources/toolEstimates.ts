import { estimateTokenCount } from 'tokenx'
import { stripToolExecutionContract, type MCPToolDefinition } from '@shared/types/core/mcp'
export function estimateToolReserveTokens(tools: MCPToolDefinition[]): number {
  return tools.reduce(
    (total, tool) => total + estimateTokenCount(JSON.stringify(stripToolExecutionContract(tool))),
    0
  )
}
