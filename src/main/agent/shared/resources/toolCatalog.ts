import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort, ToolDefinitionContext } from '@shared/types/tool'

export interface ToolCatalogRequest {
  activeSkillNames?: string[]
  failClosed?: boolean
}

export interface ToolCatalogPort {
  resolve(input?: ToolCatalogRequest): Promise<MCPToolDefinition[]>
}

export interface ToolCatalogCacheEntry<TProfile extends string = string> {
  profile: TProfile
  fingerprint: string
  tools: MCPToolDefinition[]
}

export function createToolCatalogPort<TProfile extends string>(input: {
  toolService: ToolServicePort
  resolveContext(request?: ToolCatalogRequest): Promise<{
    profile: TProfile
    fingerprint: string
    context: ToolDefinitionContext
    cached?: ToolCatalogCacheEntry<TProfile>
  }>
  commitCache(entry: ToolCatalogCacheEntry<TProfile>): void
  onResolved?(input: { context: ToolDefinitionContext; tools: MCPToolDefinition[] }): void
}): ToolCatalogPort {
  return {
    resolve: async (request) => {
      const resolved = await input.resolveContext(request)
      if (
        resolved.cached?.profile === resolved.profile &&
        resolved.cached.fingerprint === resolved.fingerprint
      ) {
        input.toolService.syncAgentToolContext({
          chatMode: resolved.context.chatMode,
          agentWorkspacePath: resolved.context.agentWorkspacePath
        })
        input.onResolved?.({ context: resolved.context, tools: resolved.cached.tools })
        return resolved.cached.tools
      }

      const tools = await input.toolService.getAllToolDefinitions(resolved.context)
      input.commitCache({
        profile: resolved.profile,
        fingerprint: resolved.fingerprint,
        tools
      })
      input.onResolved?.({ context: resolved.context, tools })
      return tools
    }
  }
}
