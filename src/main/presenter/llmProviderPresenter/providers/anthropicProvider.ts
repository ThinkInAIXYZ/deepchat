import { LLM_PROVIDER, LLMResponse, LLMResponseStream, MODEL_META } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { ConfigPresenter } from '../../configPresenter'
import Anthropic from '@anthropic-ai/sdk'
import { ChatMessage } from '../baseProvider'

export class AnthropicProvider extends BaseLLMProvider {
  private anthropic!: Anthropic
  private defaultModel = 'claude-3-7-sonnet-20250219'

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      try {
        const apiKey = this.provider.apiKey || process.env.ANTHROPIC_API_KEY
        this.anthropic = new Anthropic({
          apiKey: apiKey,
          baseURL: this.provider.baseUrl || 'https://api.anthropic.com'
        })
        await super.init()
      } catch (error) {
        console.error('Failed to initialize Anthropic provider:', error)
      }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // Anthropic 目前没有提供获取模型列表的 API，所以我们手动定义支持的模型
    return [
      {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.7',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-5-sonnet-20240620',
        name: 'Claude 3.5 Sonnet (Legacy)',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3.5',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3',
        isCustom: false,
        contextLength: 200000
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        providerId: this.provider.id,
        maxTokens: 200000,
        group: 'Claude 3',
        isCustom: false,
        contextLength: 200000
      }
    ]
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.anthropic) {
        return { isOk: false, errorMsg: '未初始化 Anthropic SDK' }
      }

      // 发送一个简单请求来检查 API 连接状态
      await this.anthropic.messages.create({
        model: this.defaultModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }]
      })

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      console.error('Anthropic API check failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: `API 检查失败: ${errorMessage}` }
    }
  }

  private formatMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const formattedMessages: Anthropic.MessageParam[] = []
    let systemContent = ''

    // 收集所有系统消息
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemContent +=
          (typeof msg.content === 'string'
            ? msg.content
            : msg.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n')) + '\n'
      } else {
        // 处理消息内容
        let formattedContent: Anthropic.ContentBlockParam[] = []
        if (typeof msg.content === 'string') {
          formattedContent = [{ type: 'text', text: msg.content }]
        } else {
          formattedContent = msg.content.map((content) => {
            if (content.type === 'image_url') {
              return {
                type: 'image',
                source: content.image_url!.url.startsWith('data:image')
                  ? {
                      type: 'base64',
                      data: content.image_url!.url,
                      media_type: content.image_url!.url.split(';')[0].split(':')[1] as
                        | 'image/jpeg'
                        | 'image/png'
                        | 'image/gif'
                        | 'image/webp'
                    }
                  : { type: 'url', url: content.image_url!.url }
              }
            } else {
              return { type: 'text', text: content.text || '' }
            }
          })
        }

        formattedMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: formattedContent
        })
      }
    }

    // 如果有系统消息，添加到第一个用户消息前
    if (systemContent) {
      if (formattedMessages.length > 0 && formattedMessages[0].role === 'user') {
        // 在现有内容前添加系统消息
        const existingContent = formattedMessages[0].content
        formattedMessages[0].content = [
          { type: 'text' as const, text: systemContent },
          ...(Array.isArray(existingContent)
            ? existingContent
            : [{ type: 'text' as const, text: String(existingContent) }])
        ]
      } else {
        // 创建新的用户消息
        formattedMessages.unshift({
          role: 'user',
          content: [{ type: 'text' as const, text: systemContent }]
        })
      }
    }

    return formattedMessages
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const prompt = `
请为以下对话生成一个简短的标题，不超过6个字：

${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}

只输出标题，不要有任何额外文字。
`
    const response = await this.generateText(prompt, modelId, 0.3, 50)
    return response.content.trim()
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const formattedMessages = this.formatMessages(messages)

      const response = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: formattedMessages
      })

      return {
        content: response.content.reduce((acc, item) => {
          if (item.type === 'text') {
            return acc + item.text
          }
          return acc
        }, ''),
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic completions error:', error)
      throw error
    }
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const prompt = `请对以下内容进行摘要:

${text}

请提供一个简洁明了的摘要。`

    return this.generateText(prompt, modelId, temperature, maxTokens)
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const response = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: [{ role: 'user', content: prompt }]
      })

      return {
        content: response.content.reduce((acc, item) => {
          if (item.type === 'text') {
            return acc + item.text
          }
          return acc
        }, ''),
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic generate text error:', error)
      throw error
    }
  }

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const prompt = `
根据下面的上下文，给出3个可能的回复建议，每个建议一行，不要有编号或者额外的解释：

${context}
`
    try {
      const response = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: [{ role: 'user', content: prompt }]
      })

      const suggestions = response.content
        .reduce((acc, item) => (item.type === 'text' ? acc + item.text : acc), '')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 3)

      return suggestions
    } catch (error) {
      console.error('Anthropic suggestions error:', error)
      return ['建议生成失败']
    }
  }

  async *streamCompletions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    const formattedMessages = this.formatMessages(messages)

    try {
      const stream = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: formattedMessages,
        stream: true
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          yield {
            content: chunk.delta.text,
            reasoning_content: undefined
          }
        }
      }

      yield {
        content: undefined,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic stream completions error:', error)
      throw error
    }
  }

  async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    const prompt = `请对以下内容进行摘要:

${text}

请提供一个简洁明了的摘要。`

    yield* this.streamGenerateText(prompt, modelId, temperature, maxTokens)
  }

  async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    try {
      const stream = await this.anthropic.messages.create({
        model: modelId,
        max_tokens: maxTokens || 1024,
        temperature: temperature || 0.7,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          yield {
            content: chunk.delta.text,
            reasoning_content: undefined
          }
        }
      }

      yield {
        content: undefined,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Anthropic stream generate text error:', error)
      throw error
    }
  }
}
