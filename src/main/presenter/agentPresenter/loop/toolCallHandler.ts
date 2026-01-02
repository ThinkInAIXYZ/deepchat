import type { AssistantMessageBlock } from '@shared/chat'
import { finalizeAssistantMessageBlocks } from '@shared/chat/messageBlocks'
import type {
  LLMAgentEventData,
  MCPToolResponse,
  ISQLitePresenter,
  MCPContentItem,
  MCPResourceContent
} from '@shared/presenter'
import { nanoid } from 'nanoid'
import type { MessageManager } from '../../sessionPresenter/managers/messageManager'
import type { GeneratingMessageState } from '../streaming/types'
import type { CommandPermissionService } from '../../permission/commandPermissionService'

interface PermissionRequestPayload {
  permissionType?: string
  toolName?: string
  serverName?: string
  providerId?: string
  requestId?: string
  sessionId?: string
  agentId?: string
  agentName?: string
  conversationId?: string
  command?: string
  commandSignature?: string
  commandInfo?: {
    command: string
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    suggestion: string
    signature?: string
    baseCommand?: string
  }
  rememberable?: boolean
  [key: string]: unknown
}

export class ToolCallHandler {
  private static readonly MCP_UI_MIME_TYPES = new Set([
    'text/html',
    'text/uri-list',
    'application/vnd.mcp-ui.remote-dom'
  ])

  private readonly messageManager: MessageManager
  private readonly sqlitePresenter: ISQLitePresenter
  private readonly searchingMessages: Set<string>
  private readonly commandPermissionHandler?: CommandPermissionService

  constructor(options: {
    messageManager: MessageManager
    sqlitePresenter: ISQLitePresenter
    searchingMessages: Set<string>
    commandPermissionHandler?: CommandPermissionService
  }) {
    this.messageManager = options.messageManager
    this.sqlitePresenter = options.sqlitePresenter
    this.searchingMessages = options.searchingMessages
    this.commandPermissionHandler = options.commandPermissionHandler
  }

  async processToolCallStart(
    state: GeneratingMessageState,
    event: LLMAgentEventData,
    currentTime: number
  ): Promise<void> {
    this.finalizeLastBlock(state)
    state.message.content.push({
      type: 'tool_call',
      content: '',
      status: 'loading',
      timestamp: currentTime,
      tool_call: {
        id: event.tool_call_id,
        name: event.tool_call_name,
        params: event.tool_call_params || '',
        server_name: event.tool_call_server_name,
        server_icons: event.tool_call_server_icons,
        server_description: event.tool_call_server_description
      }
    })
  }

  async processToolCallUpdate(
    state: GeneratingMessageState,
    event: LLMAgentEventData
  ): Promise<void> {
    const block = state.message.content.find(
      (item) =>
        item.type === 'tool_call' &&
        item.tool_call?.id === event.tool_call_id &&
        item.status === 'loading'
    )

    if (!block || block.type !== 'tool_call' || !block.tool_call) {
      return
    }

    block.tool_call.params = event.tool_call_params || ''

    if (event.tool_call === 'running') {
      block.tool_call.server_name = event.tool_call_server_name
      block.tool_call.server_icons = event.tool_call_server_icons
      block.tool_call.server_description = event.tool_call_server_description
    }
  }

  async processToolCallEnd(state: GeneratingMessageState, event: LLMAgentEventData): Promise<void> {
    const toolCallBlock = state.message.content.find(
      (block) =>
        block.type === 'tool_call' &&
        block.tool_call?.id === event.tool_call_id &&
        block.status === 'loading'
    )

    if (toolCallBlock && toolCallBlock.type === 'tool_call') {
      toolCallBlock.status = 'success'
      if (toolCallBlock.tool_call) {
        toolCallBlock.tool_call.response = event.tool_call_response || ''
      }
    }

    const lastBlock = state.message.content[state.message.content.length - 1]
    if (
      lastBlock &&
      lastBlock.type === 'action' &&
      lastBlock.action_type === 'tool_call_permission'
    ) {
      lastBlock.status = 'success'
    }

    this.searchingMessages.delete(event.eventId)
    state.isSearching = false
    state.pendingToolCall = undefined
  }

  async processToolCallPermission(
    state: GeneratingMessageState,
    event: LLMAgentEventData,
    currentTime: number
  ): Promise<void> {
    if (event.tool_call === 'permission-required') {
      this.handlePermissionRequired(state, event, currentTime)
      return
    }

    const lastBlock = state.message.content[state.message.content.length - 1]
    if (
      lastBlock &&
      lastBlock.type === 'action' &&
      lastBlock.action_type === 'tool_call_permission'
    ) {
      if (event.tool_call === 'permission-granted') {
        lastBlock.status = 'granted'
        lastBlock.content = event.tool_call_response || ''
        if (lastBlock.extra) {
          lastBlock.extra.needsUserAction = false
          if (
            !lastBlock.extra.grantedPermissions &&
            typeof lastBlock.extra.permissionType === 'string'
          ) {
            lastBlock.extra.grantedPermissions = lastBlock.extra.permissionType
          }
        }

        this.searchingMessages.delete(event.eventId)
        state.isSearching = false
        state.pendingToolCall = this.buildPendingToolCall(event)
        return
      }

      if (event.tool_call === 'permission-denied') {
        lastBlock.status = 'denied'
        lastBlock.content = event.tool_call_response || ''
        if (lastBlock.extra) {
          lastBlock.extra.needsUserAction = false
        }
        this.searchingMessages.delete(event.eventId)
        state.isSearching = false
        state.pendingToolCall = undefined
        return
      }

      if (event.tool_call === 'continue') {
        lastBlock.status = 'success'
        return
      }
    }
  }

  async processMcpUiResourcesFromToolCall(
    state: GeneratingMessageState,
    event: LLMAgentEventData,
    currentTime: number
  ): Promise<boolean> {
    if (event.tool_call !== 'end') {
      return false
    }

    try {
      const response = event.tool_call_response_raw as MCPToolResponse | null
      const contentItems = Array.isArray(response?.content)
        ? (response.content as MCPContentItem[])
        : []

      const uiResourceItems = contentItems.filter((item): item is MCPResourceContent => {
        if (item.type !== 'resource') {
          return false
        }
        const uri = item.resource?.uri
        const mimeType = item.resource?.mimeType || ''
        return (
          typeof uri === 'string' &&
          uri.startsWith('ui://') &&
          ToolCallHandler.MCP_UI_MIME_TYPES.has(mimeType)
        )
      })

      if (uiResourceItems.length === 0) {
        return false
      }

      const uiBlocks: AssistantMessageBlock[] = uiResourceItems
        .map((item) => {
          const resource = item.resource
          if (!resource?.uri) {
            return null
          }

          const mimeType = resource.mimeType || ''
          if (!ToolCallHandler.MCP_UI_MIME_TYPES.has(mimeType)) {
            return null
          }
          const typedMimeType = mimeType as
            | 'text/html'
            | 'text/uri-list'
            | 'application/vnd.mcp-ui.remote-dom'

          const meta = (
            resource as MCPResourceContent['resource'] & { _meta?: Record<string, unknown> }
          )._meta

          return {
            type: 'mcp_ui_resource',
            status: 'success',
            timestamp: currentTime,
            mcp_ui_resource: {
              uri: resource.uri,
              mimeType: typedMimeType,
              text: typeof resource.text === 'string' ? resource.text : undefined,
              blob: typeof resource.blob === 'string' ? resource.blob : undefined,
              _meta: meta && typeof meta === 'object' ? meta : undefined
            }
          }
        })
        .filter(Boolean) as AssistantMessageBlock[]

      if (uiBlocks.length === 0) {
        return false
      }

      this.finalizeLastBlock(state)
      state.message.content.push(...uiBlocks)
      await this.messageManager.editMessage(event.eventId, JSON.stringify(state.message.content))
      return true
    } catch (error) {
      console.error('[ToolCallHandler] Error processing MCP UI resources from tool call:', error)
      return false
    }
  }

  async processSearchResultsFromToolCall(
    state: GeneratingMessageState,
    event: LLMAgentEventData,
    currentTime: number
  ): Promise<boolean> {
    if (event.tool_call !== 'end') {
      return false
    }

    try {
      const response = event.tool_call_response_raw as MCPToolResponse | null
      const contentItems = Array.isArray(response?.content)
        ? (response?.content as MCPContentItem[])
        : []

      const resourceItems = contentItems.filter((item): item is MCPResourceContent => {
        return (
          item.type === 'resource' && item.resource?.mimeType === 'application/deepchat-webpage'
        )
      })

      if (resourceItems.length === 0) {
        return false
      }

      const searchResults = resourceItems
        .map((item) => {
          try {
            const blobContent = JSON.parse(item.resource?.text ?? '{}') as {
              title?: string
              url?: string
              content?: string
              icon?: string
              description?: string
              favicon?: string
              rank?: number
            }
            return {
              title: blobContent.title || '',
              url: blobContent.url || item.resource?.uri || '',
              content: blobContent.content || '',
              description: blobContent.description || blobContent.content || '',
              icon: blobContent.icon || '',
              favicon: blobContent.favicon || '',
              rank: blobContent.rank
            }
          } catch (error) {
            console.error('[ToolCallHandler] Failed to parse search result blob:', error)
            return null
          }
        })
        .filter(Boolean) as Array<{
        title: string
        url: string
        content: string
        description: string
        icon: string
        favicon?: string
        rank?: number
      }>

      if (searchResults.length === 0) {
        return false
      }

      const searchId = nanoid()
      const pages = searchResults
        .filter((item) => item.icon || item.favicon)
        .slice(0, 6)
        .map((item) => ({
          url: item.url,
          icon: item.icon || item.favicon || ''
        }))

      const searchBlock: AssistantMessageBlock = {
        id: searchId,
        type: 'search',
        content: '',
        status: 'success',
        timestamp: currentTime,
        extra: {
          total: searchResults.length,
          searchId,
          pages,
          label: event.tool_call_name || 'web_search',
          name: event.tool_call_name || 'web_search',
          engine: event.tool_call_server_name || undefined,
          provider: event.tool_call_server_name || undefined
        }
      }

      this.finalizeLastBlock(state)
      state.message.content.push(searchBlock)

      for (const result of searchResults) {
        await this.sqlitePresenter.addMessageAttachment(
          event.eventId,
          'search_result',
          JSON.stringify({
            title: result.title,
            url: result.url,
            content: result.content,
            description: result.description,
            icon: result.icon || result.favicon || '',
            rank: typeof result.rank === 'number' ? result.rank : undefined,
            searchId
          })
        )
      }

      await this.messageManager.editMessage(event.eventId, JSON.stringify(state.message.content))
      return true
    } catch (error) {
      console.error('[ToolCallHandler] Error processing search results from tool call:', error)
      return false
    }
  }

  private handlePermissionRequired(
    state: GeneratingMessageState,
    event: LLMAgentEventData,
    currentTime: number
  ): void {
    const ALLOWED_PERMISSION_TYPES = ['read', 'write', 'all', 'command'] as const
    type PermissionType = (typeof ALLOWED_PERMISSION_TYPES)[number]

    let permissionType: PermissionType = 'read'
    const requestedType = event.permission_request?.permissionType
    if (typeof requestedType === 'string') {
      const normalizedType = requestedType.toLowerCase()
      if (ALLOWED_PERMISSION_TYPES.includes(normalizedType as PermissionType)) {
        permissionType = normalizedType as PermissionType
      } else {
        console.warn(
          `[ToolCallHandler] Invalid permission type received: "${requestedType}". Defaulting to "read".`
        )
      }
    } else if (requestedType !== undefined) {
      console.warn(
        `[ToolCallHandler] Permission type is not a string: ${typeof requestedType}. Defaulting to "read".`
      )
    }

    const lastBlock = state.message.content[state.message.content.length - 1]
    if (lastBlock && lastBlock.type === 'tool_call' && lastBlock.tool_call) {
      lastBlock.status = 'success'
    }

    this.finalizeLastBlock(state)
    const permissionExtra: Record<string, string | boolean> = {
      needsUserAction: true
    }

    const permissionRequest = event.permission_request as PermissionRequestPayload | undefined
    permissionExtra.permissionType = permissionRequest?.permissionType ?? permissionType
    if (permissionRequest) {
      permissionExtra.permissionRequest = JSON.stringify(permissionRequest)
      if (permissionRequest.commandInfo) {
        permissionExtra.commandInfo = JSON.stringify(permissionRequest.commandInfo)
      } else {
        const commandFromRequest = permissionRequest.command
        if (commandFromRequest && this.commandPermissionHandler) {
          permissionExtra.commandInfo = JSON.stringify(
            this.commandPermissionHandler.buildCommandInfo(commandFromRequest)
          )
        }
      }
      if (permissionRequest.toolName) {
        permissionExtra.toolName = permissionRequest.toolName
      }
      if (permissionRequest.serverName) {
        permissionExtra.serverName = permissionRequest.serverName
      }
      if (permissionRequest.providerId) {
        permissionExtra.providerId = permissionRequest.providerId
      }
      if (permissionRequest.requestId) {
        permissionExtra.permissionRequestId = permissionRequest.requestId
      }
      if (permissionRequest.rememberable === false) {
        permissionExtra.rememberable = false
      }
      if (permissionRequest.agentId) {
        permissionExtra.agentId = permissionRequest.agentId
      }
      if (permissionRequest.agentName) {
        permissionExtra.agentName = permissionRequest.agentName
      }
      if (permissionRequest.sessionId) {
        permissionExtra.sessionId = permissionRequest.sessionId
      }
      if (!permissionExtra.commandInfo && this.commandPermissionHandler) {
        try {
          const parsedParams = JSON.parse(event.tool_call_params || '{}') as { command?: string }
          if (typeof parsedParams.command === 'string' && parsedParams.command.trim()) {
            permissionExtra.commandInfo = JSON.stringify(
              this.commandPermissionHandler.buildCommandInfo(parsedParams.command)
            )
          }
        } catch {
          // Ignore parsing failures for command info fallback.
        }
      }
    } else {
      if (event.tool_call_name) {
        permissionExtra.toolName = event.tool_call_name
      }
      if (event.tool_call_server_name) {
        permissionExtra.serverName = event.tool_call_server_name
      }
    }

    state.message.content.push({
      type: 'action',
      content: event.tool_call_response || '',
      status: 'pending',
      timestamp: currentTime,
      action_type: 'tool_call_permission',
      tool_call: {
        id: event.tool_call_id,
        name: event.tool_call_name,
        params: event.tool_call_params || '',
        server_name: event.tool_call_server_name,
        server_icons: event.tool_call_server_icons,
        server_description: event.tool_call_server_description
      },
      extra: permissionExtra
    })

    state.pendingToolCall = this.buildPendingToolCall(event)
    this.searchingMessages.add(event.eventId)
    state.isSearching = true
  }

  private buildPendingToolCall(event: LLMAgentEventData) {
    if (!event.tool_call_id && !event.tool_call_name) {
      return undefined
    }

    return {
      id: event.tool_call_id || '',
      name: event.tool_call_name || '',
      params: event.tool_call_params || '',
      serverName: event.tool_call_server_name,
      serverIcons: event.tool_call_server_icons,
      serverDescription: event.tool_call_server_description
    }
  }

  private finalizeLastBlock(state: GeneratingMessageState): void {
    finalizeAssistantMessageBlocks(state.message.content)
  }
}
