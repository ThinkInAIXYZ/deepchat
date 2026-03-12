import type { NowledgeMemConfig } from '@shared/presenter'

export interface IConversationExporter {
  testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }>

  updateNowledgeMemConfig(config: Partial<NowledgeMemConfig>): Promise<void>
  getNowledgeMemConfig(): NowledgeMemConfig
}
