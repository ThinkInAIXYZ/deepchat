import type {
  ToolCatalogPort,
  ToolExecutionPort,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IToolPresenter, ToolDefinitionContext } from '@shared/types/presenters/tool.presenter'
import type { ToolOutputGuard } from './toolOutputGuard'

export interface ToolCatalogCacheEntry<TProfile extends string = string> {
  profile: TProfile
  fingerprint: string
  tools: MCPToolDefinition[]
}

export function createToolCatalogPort<TProfile extends string>(input: {
  toolPresenter: IToolPresenter | null
  resolveContext(activeSkillNames?: string[]): Promise<{
    profile: TProfile
    fingerprint: string
    context: ToolDefinitionContext
    cached?: ToolCatalogCacheEntry<TProfile>
  }>
  commitCache(entry: ToolCatalogCacheEntry<TProfile>): void
}): ToolCatalogPort {
  return {
    resolve: async (request) => {
      if (!input.toolPresenter) {
        return []
      }

      const resolved = await input.resolveContext(request?.activeSkillNames)
      if (
        resolved.cached?.profile === resolved.profile &&
        resolved.cached.fingerprint === resolved.fingerprint
      ) {
        input.toolPresenter.syncAgentToolContext?.({
          chatMode: resolved.context.chatMode,
          agentWorkspacePath: resolved.context.agentWorkspacePath
        })
        return resolved.cached.tools
      }

      const tools = await input.toolPresenter.getAllToolDefinitions(resolved.context)
      input.commitCache({
        profile: resolved.profile,
        fingerprint: resolved.fingerprint,
        tools
      })
      return tools
    }
  }
}

export function createToolExecutionPort(
  toolPresenter: IToolPresenter | null
): ToolExecutionPort | null {
  if (!toolPresenter) {
    return null
  }

  return {
    ...(toolPresenter.preCheckToolPermission
      ? {
          preCheck: (call, options) => toolPresenter.preCheckToolPermission!(call, options)
        }
      : {}),
    execute: (call, options) => toolPresenter.callTool(call, options)
  }
}

export function createToolResultPort(input: {
  outputGuard: Pick<ToolOutputGuard, 'prepareToolOutput' | 'fitToolBatchOutputs'>
  normalize: ToolResultPort['normalize']
}): ToolResultPort {
  return {
    normalize: input.normalize,
    prepare: (request) => input.outputGuard.prepareToolOutput(request),
    fitBatch: (request) => input.outputGuard.fitToolBatchOutputs(request)
  }
}
