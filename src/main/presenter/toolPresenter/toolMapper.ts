import type { MCPToolDefinition } from '@shared/presenter'

export type ToolSource = 'mcp' | 'agent'

export interface ToolMapping {
  toolName: string
  source: ToolSource
  originalName?: string
}

/**
 * ToolMapper - Maps tool names to their sources (MCP or Agent)
 * Supports future tool deduplication and mapping features
 */
export class ToolMapper {
  private toolNameToSource = new Map<string, ToolSource>()
  private toolMappings: ToolMapping[] = []

  /**
   * Register a tool mapping
   */
  registerTool(toolName: string, source: ToolSource, originalName?: string): void {
    this.toolNameToSource.set(toolName, source)
    this.toolMappings.push({
      toolName,
      source,
      originalName: originalName || toolName
    })
  }

  /**
   * Register multiple tools from tool definitions
   */
  registerTools(tools: MCPToolDefinition[], source: ToolSource): void {
    for (const tool of tools) {
      this.registerTool(tool.function.name, source)
    }
  }

  /**
   * Get the source for a tool name
   */
  getToolSource(toolName: string): ToolSource | undefined {
    return this.toolNameToSource.get(toolName)
  }

  /**
   * Check if a tool is mapped
   */
  hasTool(toolName: string): boolean {
    return this.toolNameToSource.has(toolName)
  }

  /**
   * Clear all mappings
   */
  clear(): void {
    this.toolNameToSource.clear()
    this.toolMappings = []
  }

  /**
   * Get all mappings
   */
  getAllMappings(): ToolMapping[] {
    return [...this.toolMappings]
  }

  /**
   * Future: Support tool deduplication
   * If MCP and Agent have the same tool name, map to MCP by default
   */
  resolveDuplicate(toolName: string, preferredSource?: ToolSource): ToolSource {
    const existing = this.toolNameToSource.get(toolName)
    if (existing && preferredSource && existing !== preferredSource) {
      // Future: Allow configuration to prefer one source over another
      return preferredSource
    }
    return existing || 'mcp'
  }
}
