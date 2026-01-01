import { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { CONVERSATION } from '@shared/presenter'
import { getNormalizedUserMessageText } from '../../agentPresenter/message/messageFormatter'
import { NowledgeMemMessage, NowledgeMemThread } from '@shared/types/nowledgeMem'

export function generateNowledgeMemExportFilename(
  conversation: CONVERSATION,
  timestamp: Date = new Date()
): string {
  const safeTitle = conversation.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 50)

  const formattedTimestamp = timestamp
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19)

  return `nowledge_mem_${safeTitle}_${formattedTimestamp}.json`
}

export function convertDeepChatToNowledgeMemFormat(
  conversation: CONVERSATION,
  messages: Message[]
): NowledgeMemThread {
  const nowledgeMessages: NowledgeMemMessage[] = []
  const messageMetadataArray: any[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]

    if (message.role === 'user') {
      const userContent = message.content as UserMessageContent
      const messageText = getNormalizedUserMessageText(userContent)

      // Store message-level metadata in array
      const messageMetadata: any = {
        index: i,
        timestamp: message.timestamp,
        files: userContent.files
          ? userContent.files.map((file) => ({
              name: file.name || '',
              type: file.mimeType || 'unknown'
            }))
          : [],
        links: userContent.links || []
      }

      messageMetadataArray.push(messageMetadata)

      nowledgeMessages.push({
        role: 'user',
        content: messageText
      })
    } else if (message.role === 'assistant') {
      const assistantBlocks = message.content as AssistantMessageBlock[]

      // Combine content blocks into a single message
      let content = ''
      const metadata: {
        tool_calls: any[]
        search_results: any[]
        reasoning: string
        artifacts: any[]
        tokens?: {
          input: number
          output: number
          total: number
        }
        generation_time?: number
        model?: string
        provider?: string
      } = {
        tool_calls: [],
        search_results: [],
        reasoning: '',
        artifacts: []
      }

      for (const block of assistantBlocks) {
        switch (block.type) {
          case 'content':
            if (block.content) {
              content += block.content + '\n'
            }
            break

          case 'reasoning_content':
            if (block.content) {
              metadata.reasoning = (metadata.reasoning || '') + block.content + '\n'
            }
            break

          case 'tool_call':
            if (block.tool_call) {
              metadata.tool_calls?.push({
                name: block.tool_call.name || '',
                params: block.tool_call.params || '',
                response: block.tool_call.response
              })
            }
            break

          case 'search':
            if (block.extra) {
              metadata.search_results?.push({
                type: 'search',
                total: block.extra.total,
                timestamp: block.timestamp
              })
            }
            break

          case 'artifact-thinking':
            if (block.content) {
              content += `[Artifact Thinking] ${block.content}\n`
            }
            break

          case 'image':
            content += '[Image Content]\n'
            break

          case 'mcp_ui_resource':
            if (block.mcp_ui_resource) {
              content += `[MCP Resource] ${block.mcp_ui_resource.uri}\n`
            }
            break

          case 'error':
            if (block.content) {
              content += `[Error] ${block.content}\n`
            }
            break
        }
      }

      // Add token usage and generation info from message metadata
      Object.assign(metadata, extractTokenMetadata(message))

      // Store message-level metadata
      const assistantMessageMetadata: any = {
        index: i,
        timestamp: message.timestamp,
        tool_calls: metadata.tool_calls || [],
        search_results: metadata.search_results || [],
        reasoning: metadata.reasoning || '',
        artifacts: metadata.artifacts || []
      }

      // Add token usage and generation info to per-message metadata
      const tokenMeta = extractTokenMetadata(message)
      if (tokenMeta.tokens) {
        assistantMessageMetadata.tokens = tokenMeta.tokens
      }
      if (tokenMeta.generation_time !== undefined) {
        assistantMessageMetadata.generation_time = tokenMeta.generation_time
      }

      messageMetadataArray.push(assistantMessageMetadata)

      nowledgeMessages.push({
        role: 'assistant',
        content: content.trim()
      })
    } else if (message.role === 'system') {
      // Handle system messages if they exist
      nowledgeMessages.push({
        role: 'system',
        content:
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      })
    }
  }

  // Generate thread_id from title
  let threadId = conversation.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50)

  // Fallback to conversation ID if title produces empty thread_id
  if (!threadId || threadId.trim().length === 0) {
    threadId = conversation.id
  }

  return {
    thread_id: threadId,
    title: conversation.title || null,
    messages: nowledgeMessages,
    source: 'deepchat',
    import_date: new Date().toISOString(),
    metadata: {
      conversation: {
        id: conversation.id,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
        model: conversation.settings.modelId || 'unknown',
        provider: conversation.settings.providerId || 'unknown',
        description: `Exported from DeepChat - ${messages.length} messages`,
        tags: [
          'deepchat-export',
          conversation.settings.providerId,
          conversation.settings.modelId
        ].filter(Boolean) as string[],
        settings: {
          system_prompt: conversation.settings.systemPrompt || '',
          temperature: conversation.settings.temperature || 0.7,
          context_length: conversation.settings.contextLength || 4000,
          max_tokens: conversation.settings.maxTokens || 2048,
          enable_search: conversation.settings.enableSearch || false,
          artifacts_enabled: conversation.settings.artifacts === 1
        }
      },
      message_metadata: messageMetadataArray
    }
  }
}

function extractTokenMetadata(message: Message): {
  tokens?: { input: number; output: number; total: number }
  generation_time?: number
  model?: string
  provider?: string
} {
  const messageMeta = (message as any).metadata || {}
  const result: {
    tokens?: { input: number; output: number; total: number }
    generation_time?: number
    model?: string
    provider?: string
  } = {}
  if (messageMeta) {
    if (
      typeof messageMeta.inputTokens === 'number' ||
      typeof messageMeta.outputTokens === 'number' ||
      typeof messageMeta.totalTokens === 'number'
    ) {
      result.tokens = {
        input: messageMeta.inputTokens || 0,
        output: messageMeta.outputTokens || 0,
        total: messageMeta.totalTokens || 0
      }
    }
    if (typeof messageMeta.generationTime === 'number') {
      result.generation_time = messageMeta.generationTime
    }
    if (messageMeta.model) result.model = messageMeta.model
    if (messageMeta.provider) result.provider = messageMeta.provider
  }
  return result
}

export function buildNowledgeMemExportContent(
  conversation: CONVERSATION,
  messages: Message[]
): string {
  try {
    const nowledgeMemThread = convertDeepChatToNowledgeMemFormat(conversation, messages)
    return JSON.stringify(nowledgeMemThread, null, 2)
  } catch (error) {
    throw new Error(
      `Failed to build Nowledge Mem export content: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Validates if the converted thread meets nowledge-mem API requirements
 */
export function validateNowledgeMemThread(thread: NowledgeMemThread): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!thread.thread_id || thread.thread_id.trim().length === 0) {
    errors.push('Thread ID is required')
  }

  if (!thread.messages || thread.messages.length === 0) {
    errors.push('Thread must have at least one message')
  }

  if (thread.messages) {
    thread.messages.forEach((message, index) => {
      if (!message.role || !['user', 'assistant', 'system'].includes(message.role)) {
        errors.push(`Message ${index + 1} has invalid role: ${message.role}`)
      }

      if (!message.content || message.content.trim().length === 0) {
        errors.push(`Message ${index + 1} has empty content`)
      }
    })
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
