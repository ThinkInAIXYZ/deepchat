import type { NowledgeMemThread, NowledgeMemExportSummary } from '@shared/types/nowledgeMem'
import type { NowledgeMemConfig } from './nowledgeMemClient'

export interface IConversationExporter {
  exportConversation(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
  ): Promise<{ filename: string; content: string }>

  exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread
    summary?: NowledgeMemExportSummary
    errors?: string[]
  }>

  submitToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    threadId?: string
    data?: NowledgeMemThread
    errors?: string[]
  }>

  testNowledgeMemConnection(config?: NowledgeMemConfig): Promise<{
    success: boolean
    message?: string
    error?: string
  }>

  updateNowledgeMemConfig(config: Partial<NowledgeMemConfig>): Promise<void>
  getNowledgeMemConfig(): NowledgeMemConfig
}
