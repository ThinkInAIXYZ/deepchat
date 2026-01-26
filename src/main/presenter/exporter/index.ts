import type { IConversationExporter } from './interface'
import type { ISQLitePresenter, IConfigPresenter, NowledgeMemConfig } from '@shared/presenter'
import type { Message } from '@shared/chat'
import { MessageManager } from '../sessionPresenter/managers/messageManager'
import {
  buildConversationExportContent,
  buildNowledgeMemExportData,
  generateExportFilename
} from './formats/conversationExporter'
import { NowledgeMemPresenter } from '../nowledgeMemPresenter'
import type { NowledgeMemThread, NowledgeMemExportSummary } from '@shared/types/nowledgeMem'

interface ExporterDependencies {
  sqlitePresenter: ISQLitePresenter
  configPresenter: IConfigPresenter
}

export class ConversationExporterService implements IConversationExporter {
  private readonly sqlitePresenter: ISQLitePresenter
  private readonly messageManager: MessageManager
  private readonly nowledgeMemPresenter: NowledgeMemPresenter

  constructor(deps: ExporterDependencies) {
    this.sqlitePresenter = deps.sqlitePresenter
    this.messageManager = new MessageManager(deps.sqlitePresenter)
    this.nowledgeMemPresenter = new NowledgeMemPresenter(deps.configPresenter)
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
    const content = await buildConversationExportContent(conversation, sentMessages, format)
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
    const exportResult = await buildNowledgeMemExportData(conversation, messages)
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

    const result = await this.nowledgeMemPresenter.submitThread(exportResult.data)
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

  async testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    try {
      const result = await this.nowledgeMemPresenter.testConnection()
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
    await this.nowledgeMemPresenter.updateConfig(config)
  }

  getNowledgeMemConfig() {
    return this.nowledgeMemPresenter.getConfig()
  }

  private async fetchAllMessages(conversationId: string): Promise<Message[]> {
    const pageSize = 1000
    let page = 1
    let total = 0
    const allMessages: Message[] = []

    do {
      const res = await this.messageManager.getMessageThread(conversationId, page, pageSize)
      total = res.total
      allMessages.push(...res.list)
      page += 1
    } while (allMessages.length < total && page <= Math.ceil(total / pageSize) + 1)

    return allMessages
  }
}
