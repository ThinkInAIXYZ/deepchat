import type { ProviderSettingsPort } from '@/provider/settings'
import type { AgentManager } from '@/agent/manager/agentManager'
import type { SessionTranscriptReadPort } from '@/session/data/contracts'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import type { Message } from '@shared/chat'
import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  SessionGenerationSettings,
  SessionRecord,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { CONVERSATION } from '@shared/types/session'
import {
  buildConversationExportContent,
  generateExportFilename,
  type ConversationExportFormat
} from './formats/conversationExporter'
import {
  normalizeAttachmentRepresentationPreference,
  normalizeAttachmentResolvedRepresentation
} from '@shared/utils/attachmentRepresentation'

export class AgentSessionExportService {
  constructor(
    private readonly dependencies: {
      agentManager: Pick<AgentManager, 'resolveBackend' | 'resolveSessionHandle'>
      appSessionService: Pick<AppSessionService, 'get'>
      transcript: Pick<SessionTranscriptReadPort, 'getMessages'>
      providerSettings: Pick<ProviderSettingsPort, 'getModelConfig'>
    }
  ) {}

  async export(
    sessionId: string,
    format: ConversationExportFormat
  ): Promise<{ filename: string; content: string }> {
    const session = this.dependencies.appSessionService.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const handle = this.dependencies.agentManager.resolveSessionHandle(
      toAppSessionId(sessionId)
    ).handle
    const state = await handle.snapshot()
    const generationSettings = await handle.settings.getGenerationSettings()
    const providerId = state?.providerId?.trim() ?? ''
    const modelId = state?.modelId?.trim() ?? ''
    const conversation = this.buildConversation(session, providerId, modelId, generationSettings)
    const records = await this.dependencies.transcript.getMessages(sessionId)
    const messages = records
      .filter((record) => record.status === 'sent')
      .sort((left, right) => left.orderSeq - right.orderSeq)
      .map((record) => this.mapMessage(record, providerId, modelId))
    return {
      filename: generateExportFilename(format, conversation),
      content: buildConversationExportContent(conversation, messages, format)
    }
  }

  private buildConversation(
    session: SessionRecord,
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings | null
  ): CONVERSATION {
    const isAcpAgent = this.dependencies.agentManager.resolveBackend(session.agentId).kind === 'acp'
    const resolvedProviderId = providerId || (isAcpAgent ? 'acp' : '')
    const resolvedModelId = modelId || (isAcpAgent ? session.agentId : '')
    const modelConfig =
      resolvedProviderId && resolvedModelId
        ? this.dependencies.providerSettings.getModelConfig(resolvedModelId, resolvedProviderId)
        : undefined
    return {
      id: session.id,
      title: session.title,
      settings: {
        systemPrompt: generationSettings?.systemPrompt ?? '',
        temperature: generationSettings?.temperature ?? modelConfig?.temperature ?? 0.7,
        contextLength: generationSettings?.contextLength ?? modelConfig?.contextLength ?? 32000,
        maxTokens: generationSettings?.maxTokens ?? modelConfig?.maxTokens ?? 8000,
        providerId: resolvedProviderId,
        modelId: resolvedModelId,
        artifacts: 0,
        thinkingBudget: generationSettings?.thinkingBudget,
        reasoningEffort: generationSettings?.reasoningEffort,
        verbosity: generationSettings?.verbosity
      },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      is_pinned: session.isPinned ? 1 : 0
    }
  }

  private mapMessage(
    record: ChatMessageRecord,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Message {
    const metadata = this.parseMetadata(record.metadata)
    const base: Omit<Message, 'content' | 'role'> = {
      id: record.id,
      timestamp: record.createdAt,
      avatar: '',
      name: record.role === 'user' ? 'You' : 'Assistant',
      model_name: metadata.model ?? fallbackModelId,
      model_id: metadata.model ?? fallbackModelId,
      model_provider: metadata.provider ?? fallbackProviderId,
      status: record.status,
      error: '',
      usage: {
        context_usage: 0,
        tokens_per_second: metadata.tokensPerSecond ?? 0,
        total_tokens: metadata.totalTokens ?? 0,
        generation_time: metadata.generationTime ?? 0,
        first_token_time: metadata.firstTokenTime ?? 0,
        reasoning_start_time: 0,
        reasoning_end_time: 0,
        input_tokens: metadata.inputTokens ?? 0,
        output_tokens: metadata.outputTokens ?? 0
      },
      conversationId: record.sessionId,
      is_variant: 0
    }
    return record.role === 'user'
      ? { ...base, role: 'user', content: this.parseUserContent(record.content) }
      : {
          ...base,
          role: 'assistant',
          content: this.parseAssistantBlocks(record.content, record.createdAt)
        }
  }

  private parseUserContent(content: string): Message['content'] {
    const fallback = { text: '', files: [], links: [], search: false, think: false }
    try {
      const parsed = JSON.parse(content) as UserMessageContent | Record<string, unknown> | string
      if (typeof parsed === 'string') return { ...fallback, text: parsed }
      if (!parsed || typeof parsed !== 'object') return fallback
      const record = parsed as Record<string, unknown>
      const files = Array.isArray(record.files)
        ? (record.files as Array<Record<string, unknown>>).map((file) => ({
            name: typeof file.name === 'string' ? file.name : '',
            content: '',
            mimeType:
              typeof file.mimeType === 'string'
                ? file.mimeType
                : typeof file.type === 'string'
                  ? file.type
                  : 'application/octet-stream',
            metadata: {
              fileName: typeof file.name === 'string' ? file.name : '',
              fileSize: typeof file.size === 'number' ? file.size : 0,
              fileCreated: new Date(),
              fileModified: new Date()
            },
            token: 0,
            path: typeof file.path === 'string' ? file.path : '',
            requestedRepresentation: normalizeAttachmentRepresentationPreference(
              file.requestedRepresentation
            ),
            resolvedRepresentation: normalizeAttachmentResolvedRepresentation(
              file.resolvedRepresentation
            )
          }))
        : []
      const links = Array.isArray(record.links)
        ? (record.links as unknown[]).filter((link): link is string => typeof link === 'string')
        : []
      return {
        ...fallback,
        text: typeof record.text === 'string' ? record.text : '',
        files,
        links,
        search: Boolean(record.search),
        think: Boolean(record.think)
      }
    } catch {
      return { ...fallback, text: content.trim() }
    }
  }

  private parseAssistantBlocks(content: string, timestamp: number): Message['content'] {
    try {
      const parsed = JSON.parse(content) as AssistantMessageBlock[] | string
      if (typeof parsed === 'string') {
        return [{ type: 'content', content: parsed, status: 'success', timestamp }]
      }
      return Array.isArray(parsed) ? (parsed as unknown as Message['content']) : []
    } catch {
      return content.trim()
        ? [{ type: 'content', content: content.trim(), status: 'success', timestamp }]
        : []
    }
  }

  private parseMetadata(raw: string): {
    totalTokens?: number
    inputTokens?: number
    outputTokens?: number
    generationTime?: number
    firstTokenTime?: number
    tokensPerSecond?: number
    model?: string
    provider?: string
  } {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') return {}
      return {
        totalTokens: typeof parsed.totalTokens === 'number' ? parsed.totalTokens : undefined,
        inputTokens: typeof parsed.inputTokens === 'number' ? parsed.inputTokens : undefined,
        outputTokens: typeof parsed.outputTokens === 'number' ? parsed.outputTokens : undefined,
        generationTime:
          typeof parsed.generationTime === 'number' ? parsed.generationTime : undefined,
        firstTokenTime:
          typeof parsed.firstTokenTime === 'number' ? parsed.firstTokenTime : undefined,
        tokensPerSecond:
          typeof parsed.tokensPerSecond === 'number' ? parsed.tokensPerSecond : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        provider: typeof parsed.provider === 'string' ? parsed.provider : undefined
      }
    } catch {
      return {}
    }
  }
}
