import { createHash } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimDesktopTool } from '@/agent/dim/productTools'
import type { McpService } from '@/mcp'
import type { MCPToolDefinition } from '@shared/types/mcp'
import { CHAT_SETTINGS_TOOL_NAMES } from '@/tool/agentTools/chatSettingsTools'
import { resolvePluginToolPolicy } from '@/plugin/toolPolicyStore'
import { dimContentBlocks } from '@/agent/dim/auxiliaryModels'
import {
  cacheToolCallImagePreviews,
  extractScreenshotPreview,
  type CacheImageCallback
} from '@/lib/toolCallImagePreviews'

interface DesktopToolsOptions {
  desktop: Pick<AgentToolManager, 'getAllToolDefinitions' | 'callTool'>
  mcp: Pick<McpService, 'getAllToolDefinitions' | 'callTool'>
  cacheImage: CacheImageCallback
  supportsVision(sessionId: string): Promise<boolean>
  selection(sessionId: string): Promise<{
    agentId: string
    disabled: string[]
    enabledServerIds?: string[] | null
    bridgeServerNames: string[]
  }>
}

function desktopToolRisk(definition: MCPToolDefinition): DimDesktopTool['risk'] {
  if (definition.function.name === CHAT_SETTINGS_TOOL_NAMES.open) return 'product_approval'
  return definition.execution.effect === 'read' ? 'session' : 'network'
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
      risk: desktopToolRisk(definition),
      execute: async (call, signal) => {
        const result = await options.desktop.callTool(call.name, call.arguments, id, {
          runId: call.turnId,
          signal,
          commitDispatch: () => signal.throwIfAborted()
        })
        if (call.name === 'cdp_send' && (typeof result === 'string' || !result.rawData?.isError)) {
          const screenshot = extractScreenshotPreview(
            call.name,
            JSON.stringify(call.arguments),
            typeof result === 'string' ? result : result.content
          )
          if (screenshot) {
            const [preview] = await cacheToolCallImagePreviews({
              imagePreviews: [{ ...screenshot, id: 'screenshot-1' }],
              cacheImage: options.cacheImage,
              signal
            })
            const supportsVision = await options.supportsVision(call.sessionId)
            signal.throwIfAborted()
            const response = 'Screenshot captured.'
            return {
              content: supportsVision
                ? dimContentBlocks([{ type: 'image_url', image_url: { url: screenshot.data } }])
                : `${response} The current model cannot view images.`,
              structuredContent: {
                deepchatDisplay: {
                  response,
                  imagePreviews: preview?.data?.startsWith('imgcache://')
                    ? [{ ...preview, data: preview.data }]
                    : []
                }
              }
            }
          }
        }
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
                imagePreviews: result.rawData?.imagePreviews ?? [],
                htmlRender: result.rawData?.htmlRender
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
        const originalMcpName = definition.raw?.name ?? definition.function.name
        const policy = () => resolvePluginToolPolicy(definition.server.name, originalMcpName)
        const { managed, decision } = policy()
        if (managed && decision !== 'allow' && decision !== 'ask') continue
        const pinnedDefinition = JSON.stringify(definition)
        // Product MCP namespaces cannot shadow either a native tool or another desktop server.
        const name = `deepchat_mcp_${createHash('sha256')
          .update(JSON.stringify([definition.server.name, definition.function.name]))
          .digest('hex')
          .slice(0, 32)}`
        tools.push({
          definition: { ...definition, function: { ...definition.function, name } },
          originalMcpName,
          risk: decision === 'ask' ? 'product_approval' : managed ? 'session' : 'network',
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
                  const currentPolicy = policy()
                  if (
                    JSON.stringify(current) !== pinnedDefinition ||
                    currentPolicy.managed !== managed ||
                    currentPolicy.decision !== decision
                  )
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
