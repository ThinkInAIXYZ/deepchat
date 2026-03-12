export type NowledgeMemConfig = {
  baseUrl: string
  apiKey?: string
  timeout: number
}

export interface IConversationExporter {
  testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }>

  updateNowledgeMemConfig(config: Partial<NowledgeMemConfig>): Promise<void>
  getNowledgeMemConfig(): NowledgeMemConfig
}
