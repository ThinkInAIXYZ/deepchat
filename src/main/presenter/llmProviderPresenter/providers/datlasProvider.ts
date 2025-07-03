import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage,
  KeyStatus
} from '@shared/presenter'
import { BaseRagProvider } from '../baseRagProvider'
import { ConfigPresenter } from '../../configPresenter'
import { proxyConfig } from '../../proxyConfig'
import { ProxyAgent } from 'undici'
import { ModelType } from '@shared/model'

// RAG接口参数类型
export interface RagRetrieveParams {
  question: string // 用户输入问题, 必填
  method?: string // 提示词id
  file_tags?: string[] // 使用的模型
  prompt_id?: string // 标签筛选
  session_id?: string // 会话id, 用于追问(注: 开发中尚不可用)
}

// Mock接口参数类型
export interface MockRagRetrieveParams {
  question?: string // 输入问题, 会部分影响输出, 非必填
  interval?: number // 每个字的输出间隔, 默认值为0.05。设置为0输出速度最快
}

// 步骤接口
export interface Step {
  step: string // 步骤, 所有的Step按照这个值聚合
  title: string // 标题。markdown格式
  content: string // 内容。 markdown格式
  is_error?: boolean // 这个如果存在，则表示这个step是错误状态
  error_message?: string // 错误消息
  replace_content?: boolean // 如果replace为true，则替换相同step内容
  replace_title?: boolean // 如果replace为true，则替换相同step名称
}

// 块接口
export interface Chunk {
  reasoning_content?: Step // 推理内容。如果是一个Step对象，包含step标识、内容等属性
  content?: string // 回答内容
  files?: { id: string; name: string }[] // 文章ID。如果存在，则表示整个问答得到的文章列表
  is_error?: boolean // 这个如果存在，则表示问答失败
  error_message?: string // 这个如果存在，则表示问答失败的消息
  extra?: {
    match_reference: {
      id: number // 是第几个文件引用, 从0开始
      short_id: number // 匹配的向量块id
      file_id: string // 匹配的文件id
    }[]
  }
}

export class DatlasProvider extends BaseRagProvider {
  private readonly baseUrl = 'https://ai.maicedata.com/api/knowbase/rag'
  private agentId: string
  private token: string
  private isMockMode: boolean

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)

    // 从配置中获取敏感信息
    const config = provider.config || {}
    this.agentId = config.agentId || ''
    this.token = config.token || ''
    this.isMockMode = config.mockMode || false

    if (!this.agentId || !this.token) {
      console.warn('Datlas RAG provider missing required configuration: agentId or token')
    }
  }

  // RAG provider的模型列表
  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    return [
      {
        id: 'datlas-rag',
        name: 'Datlas RAG',
        group: 'RAG',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32768,
        maxTokens: 4096,
        description: 'Datlas RAG retrieval and generation service',
        vision: false,
        functionCall: false,
        reasoning: true,
        type: ModelType.RAG
      }
    ]
  }

  // 代理更新回调
  public onProxyResolved(): void {
    // RAG provider不需要特殊的代理处理
  }

  // 验证provider是否可用
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.agentId || !this.token) {
      return { isOk: false, errorMsg: 'Missing agentId or token configuration' }
    }

    try {
      const response = await this.makeRequest('POST', `${this.baseUrl}/${this.agentId}/retrieve`, {
        question: 'test',
        interval: 0
      })

      return { isOk: response.ok, errorMsg: response.ok ? null : 'RAG service unavailable' }
    } catch (error) {
      return { isOk: false, errorMsg: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  // 处理代理的通用请求方法
  private async makeRequest(method: string, url: string, body?: any): Promise<Response> {
    const proxyUrl = proxyConfig.getProxyUrl()
    const fetchOptions: RequestInit & { dispatcher?: ProxyAgent } = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.token,
        ...this.defaultHeaders
      }
    }

    if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    if (proxyUrl) {
      console.log(`[Datlas Provider] Using proxy: ${proxyUrl}`)
      const proxyAgent = new ProxyAgent(proxyUrl)
      fetchOptions.dispatcher = proxyAgent
    }

    return fetch(url, fetchOptions)
  }

  // RAG provider不支持标题生成
  public async summaryTitles(_messages: ChatMessage[], _modelId: string): Promise<string> {
    throw new Error('RAG provider does not support title generation')
  }

  // RAG provider不支持同步完成
  async completions(
    _messages: ChatMessage[],
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    throw new Error('RAG provider only supports streaming mode')
  }

  // RAG provider不支持文本总结
  async summaries(
    _text: string,
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    throw new Error('RAG provider does not support text summarization')
  }

  // RAG provider不支持文本生成
  async generateText(
    _prompt: string,
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    throw new Error('RAG provider does not support text generation')
  }

  // RAG provider不支持key状态检查
  public async getKeyStatus(): Promise<KeyStatus | null> {
    return null
  }

  // 将ChatMessage转换为问题字符串
  private extractQuestionFromMessages(messages: ChatMessage[]): string {
    // 取最后一个用户消息作为问题
    const lastUserMessage = messages
      .filter(msg => msg.role === 'user')
      .pop()

    if (!lastUserMessage?.content) {
      return ''
    }

    if (typeof lastUserMessage.content === 'string') {
      return lastUserMessage.content
    }

    // 如果是数组，提取文本部分
    if (Array.isArray(lastUserMessage.content)) {
      return lastUserMessage.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join(' ')
    }

    return ''
  }

  // 核心流式处理方法
  public async *coreStream(
    messages: ChatMessage[],
    _modelId: string,
    _modelConfig: ModelConfig,
    _temperature: number,
    _maxTokens: number,
    _tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.agentId || !this.token) {
      yield {
        type: 'error',
        error_message: 'RAG provider not properly configured'
      }
      return
    }

    const question = this.extractQuestionFromMessages(messages)

    if (!question) {
      yield {
        type: 'error',
        error_message: 'No question found in messages'
      }
      return
    }

    const url = `${this.baseUrl}/${this.agentId}/retrieve`
    const requestBody = this.isMockMode
      ? { question, interval: 0.05 }
      : { question }

    try {
      const response = await this.makeRequest('POST', url, requestBody)

      if (!response.ok) {
        yield {
          type: 'error',
          error_message: `HTTP ${response.status}: ${response.statusText}`
        }
        return
      }

      // 从响应头获取会话ID
      const historyId = response.headers.get('X-History-Id')
      if (historyId) {
        console.log('RAG session ID:', historyId)
      }

      if (!response.body) {
        yield {
          type: 'error',
          error_message: 'No response body'
        }
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine) continue

            try {
              const chunk: Chunk = JSON.parse(trimmedLine)
              yield* this.processChunk(chunk)
            } catch (parseError) {
              console.warn('Failed to parse chunk:', trimmedLine, parseError)
              // 继续处理其他块
            }
          }
        }

        // 处理最后的buffer
        if (buffer.trim()) {
          try {
            const chunk: Chunk = JSON.parse(buffer)
            yield* this.processChunk(chunk)
          } catch (parseError) {
            console.warn('Failed to parse final chunk:', buffer, parseError)
          }
        }

        yield {
          type: 'stop',
          stop_reason: 'complete'
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      console.error('RAG stream error:', error)
      yield {
        type: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // 处理单个chunk
  private async *processChunk(chunk: Chunk): AsyncGenerator<LLMCoreStreamEvent> {
    // 处理错误
    if (chunk.is_error) {
      yield {
        type: 'error',
        error_message: chunk.error_message || 'RAG processing error'
      }
      return
    }

    // 处理推理内容
    if (chunk.reasoning_content) {
      const step = chunk.reasoning_content
      yield {
        type: 'reasoning',
        reasoning_content: step.content,
        step: step.step,
        step_title: step.title,
        step_content: step.content,
        step_is_error: step.is_error,
        step_error_message: step.error_message,
        step_replace_content: step.replace_content,
        step_replace_title: step.replace_title
      }
    }

    // 处理文本内容
    if (chunk.content) {
      yield {
        type: 'text',
        content: chunk.content
      }
    }

    // 处理文件列表
    if (chunk.files && chunk.files.length > 0) {
      yield {
        type: 'rag_files',
        rag_files: chunk.files
      }
    }

    // 处理引用信息
    if (chunk.extra?.match_reference && chunk.extra.match_reference.length > 0) {
      yield {
        type: 'rag_references',
        rag_references: chunk.extra.match_reference
      }
    }
  }
}
