import type { IConversationExporter } from './interface'
import type { NowledgeMemConfig } from './nowledgeMemClient'
import type {
  MESSAGE_METADATA,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  SQLITE_MESSAGE
} from '@shared/types/session'
import type { SessionDatabase } from '@/session/data/database'
import type {
  Message,
  UserMessageCodeBlock,
  UserMessageContent,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'
import {
  buildConversationExportContent,
  buildNowledgeMemExportData,
  generateExportFilename
} from './formats/conversationExporter'
import { NowledgeMemClient } from './nowledgeMemClient'
import type { NowledgeMemThread, NowledgeMemExportSummary } from '@shared/types/nowledgeMem'
import type { SettingsStore } from '@/config/settingsStore'

interface ExporterDependencies {
  sqlitePresenter: SessionDatabase
  settings: SettingsStore
}

export class ConversationExporterService implements IConversationExporter {
  private readonly sqlitePresenter: SessionDatabase
  private readonly nowledgeMemClient: NowledgeMemClient

  constructor(deps: ExporterDependencies) {
    this.sqlitePresenter = deps.sqlitePresenter
    this.nowledgeMemClient = new NowledgeMemClient(deps.settings)
  }

  async exportConversation(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
  ): Promise<{ filename: string; content: string }> {
    const conversation = await this.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }

    const messages = await this.fetchAllMessages(conversationId)
    const sentMessages = messages.filter((msg) => msg.status === 'sent')
    const filename = generateExportFilename(format, conversation)
    const content = buildConversationExportContent(conversation, sentMessages, format)
    return { filename, content }
  }

  async exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread
    summary?: NowledgeMemExportSummary
    errors?: string[]
  }> {
    const conversation = await this.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      return { success: false, errors: ['Conversation not found'] }
    }

    const messages = await this.fetchAllMessages(conversationId)
    const exportResult = buildNowledgeMemExportData(conversation, messages)
    if (!exportResult.valid) {
      return { success: false, errors: exportResult.errors }
    }

    return {
      success: true,
      data: exportResult.data,
      summary: exportResult.summary
    }
  }

  async submitToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    threadId?: string
    data?: NowledgeMemThread
    errors?: string[]
  }> {
    const exportResult = await this.exportToNowledgeMem(conversationId)
    if (!exportResult.success || !exportResult.data) {
      return {
        success: false,
        errors: exportResult.errors ?? ['Export failed']
      }
    }

    const result = await this.nowledgeMemClient.submitThread(exportResult.data)
    if (result.success && result.data) {
      return {
        success: true,
        threadId: result.data.thread_id,
        data: result.data
      }
    }

    return {
      success: false,
      errors: [result.error || 'Failed to submit thread to nowledge-mem']
    }
  }

  async testNowledgeMemConnection(config?: NowledgeMemConfig): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    try {
      const result = await this.nowledgeMemClient.testConnection(config)
      return {
        success: result.success,
        message: result.success ? 'Connection successful' : undefined,
        error: result.error || undefined
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      }
    }
  }

  async updateNowledgeMemConfig(config: Partial<NowledgeMemConfig>): Promise<void> {
    await this.nowledgeMemClient.updateConfig(config)
  }

  getNowledgeMemConfig() {
    return this.nowledgeMemClient.getConfig()
  }

  private async fetchAllMessages(conversationId: string): Promise<Message[]> {
    const rows = await this.sqlitePresenter.queryMessages(conversationId)
    return rows
      .sort((left, right) => left.created_at - right.created_at || left.order_seq - right.order_seq)
      .map((row) => this.convertLegacyMessage(row))
  }

  private convertLegacyMessage(row: SQLITE_MESSAGE): Message {
    let metadata: MESSAGE_METADATA | null = null
    try {
      metadata = JSON.parse(row.metadata)
    } catch (error) {
      console.error('Failed to parse metadata', error)
    }

    const content = JSON.parse(row.content)
    if (row.role === 'user') {
      const userContent = content as UserMessageContent
      if (Array.isArray(userContent.content)) {
        userContent.text = this.formatLegacyUserContent(userContent.content)
      }
    }

    return {
      id: row.id,
      conversationId: row.conversation_id,
      parentId: row.parent_id,
      role: row.role as MESSAGE_ROLE,
      content,
      timestamp: row.created_at,
      status: row.status as MESSAGE_STATUS,
      usage: {
        context_usage: metadata?.contextUsage ?? 0,
        tokens_per_second: metadata?.tokensPerSecond ?? 0,
        total_tokens: metadata?.totalTokens ?? 0,
        generation_time: metadata?.generationTime ?? 0,
        first_token_time: metadata?.firstTokenTime ?? 0,
        input_tokens: metadata?.inputTokens ?? 0,
        output_tokens: metadata?.outputTokens ?? 0,
        reasoning_start_time: metadata?.reasoningStartTime ?? 0,
        reasoning_end_time: metadata?.reasoningEndTime ?? 0
      },
      avatar: '',
      name: '',
      model_name: metadata?.model ?? '',
      model_id: metadata?.model ?? '',
      model_provider: metadata?.provider ?? '',
      error: '',
      is_variant: row.is_variant,
      variants: row.variants?.map((variant) => this.convertLegacyMessage(variant)) ?? []
    }
  }

  private formatLegacyUserContent(
    blocks: Array<UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock>
  ): string {
    return blocks
      .map((block) => {
        if (block.type === 'mention' && block.category === 'context') {
          return `@${block.id?.trim() || 'context'}`
        }
        return block.content || ''
      })
      .join('')
  }
}
