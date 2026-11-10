import { createHash } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimDesktopTool } from '@/agent/dim/productTools'
import type { McpService } from '@/mcp'

interface DesktopToolsOptions {
  desktop: Pick<AgentToolManager, 'getAllToolDefinitions' | 'callTool'>
  mcp: Pick<McpService, 'getAllToolDefinitions' | 'callTool'>
  selection(sessionId: string): Promise<{
    agentId: string
    disabled: string[]
    enabledServerIds?: string[] | null
    bridgeServerNames: string[]
  }>
}

/** Native filesystem, process, search, skills, agent and schedule tools are never collected here. */
export function createDimDesktopTools(options: DesktopToolsOptions) {
  return async (binding: Readonly<DimSessionBinding>): Promise<DimDesktopTool[]> => {
    const id = binding.sessionId
    const selection = await options.selection(id)
    const definitions = await options.desktop.getAllToolDefinitions({
      chatMode: 'agent',
      conversationId: id,
      requireCompleteCatalog: true
    })
    const tools: DimDesktopTool[] = definitions.map((definition) => ({
      definition,
      risk: 'session',
      execute: async (call, signal) => {
        const result = await options.desktop.callTool(call.name, call.arguments, id, {
          runId: call.turnId,
          signal,
          commitDispatch: () => signal.throwIfAborted()
        })
        if (typeof result === 'string') return { content: result }
        return {
          content: result.content,
          isError: result.rawData?.isError,
          structuredContent: {
            deepchatDisplay: JSON.parse(
              JSON.stringify({
                response: result.rawData?.toolResult
                  ? JSON.stringify(result.rawData.toolResult)
                  : result.content,
                imagePreviews: result.rawData?.imagePreviews ?? []
              })
            ) as JsonValue
          }
        }
      }
    }))
    const bridges = new Set(selection.bridgeServerNames)
    if (bridges.size) {
      const definitions = await options.mcp.getAllToolDefinitions({
        agentId: selection.agentId,
        conversationId: id,
        enabledServerIds: [...bridges]
      })
      for (const definition of definitions) {
        if (!bridges.has(definition.server.name)) continue
        const pinnedDefinition = JSON.stringify(definition)
        // Product MCP namespaces cannot shadow either a native tool or another desktop server.
        const name = `deepchat_mcp_${createHash('sha256')
          .update(JSON.stringify([definition.server.name, definition.function.name]))
          .digest('hex')
          .slice(0, 32)}`
        tools.push({
          definition: { ...definition, function: { ...definition.function, name } },
          risk: 'session',
          execute: async (call, signal) => {
            const result = await options.mcp.callTool(
              {
                id: call.callId,
                type: 'function',
                function: {
                  name: definition.function.name,
                  arguments: JSON.stringify(call.arguments)
                },
                conversationId: id
              },
              {
                signal,
                agentId: selection.agentId,
                enabledServerIds: [...bridges],
                assertCurrentToolDefinition: (current) => {
                  signal.throwIfAborted()
                  if (JSON.stringify(current) !== pinnedDefinition)
                    throw new Error('Desktop MCP capability changed before native dispatch')
                }
              }
            )
            return {
              content: result.content,
              isError: result.rawData.isError,
              ...(result.rawData.toolResult
                ? { structuredContent: { result: result.rawData.toolResult as JsonValue } }
                : {})
            }
          }
        })
      }
    }
    const disabled = new Set(selection.disabled)
    return tools.filter((tool) => !disabled.has(tool.definition.function.name))
  }
}
