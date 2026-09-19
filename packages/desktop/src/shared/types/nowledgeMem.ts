export type NowledgeMemMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type NowledgeMemThread = {
  thread_id: string
  title: string | null
  messages: NowledgeMemMessage[]
  source: string
  import_date: string
  metadata: {
    conversation: {
      id: string
      created_at: number
      updated_at: number
      model: string
      provider: string
      description: string
      tags: string[]
      settings: {
        system_prompt: string
        temperature: number
        context_length: number
        max_tokens: number
        enable_search: boolean
        artifacts_enabled: boolean
      }
    }
    message_metadata: Array<{
      index: number
      timestamp: number
      files?: Array<{
        name: string
        type: string
      }>
      links?: string[]
      tool_calls?: Array<{
        name: string
        params: string
        response?: string
      }>
      search_results?: Array<{
        type: string
        total: number
        timestamp: number
      }>
      reasoning?: string
      artifacts?: any[]
      tokens?: {
        input: number
        output: number
        total: number
      }
      generation_time?: number
    }>
  }
}

export type NowledgeMemExportSummary = {
  title: string | null
  description: string
  message_count: number
  total_tokens: number
  duration_hours: number
}
