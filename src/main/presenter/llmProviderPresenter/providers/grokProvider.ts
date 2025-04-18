import { LLM_PROVIDER, LLMResponse, LLMResponseStream } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ConfigPresenter } from '../../configPresenter'
import { ChatMessage } from '../baseProvider'

export class GrokProvider extends OpenAICompatibleProvider {
  // 图像生成模型ID
  private static readonly IMAGE_MODEL_ID = 'grok-2-image'
  // private static readonly IMAGE_ENDPOINT = '/images/generations'

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    console.log('init grok provider')
    super(provider, configPresenter)
  }

  // 判断是否为图像模型
  private isImageModel(modelId: string): boolean {
    return modelId.startsWith(GrokProvider.IMAGE_MODEL_ID)
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // 图像生成模型需要特殊处理
    if (this.isImageModel(modelId)) {
      return this.handleImageGeneration(messages)
    }
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // 图像生成模型不支持摘要
    if (this.isImageModel(modelId)) {
      throw new Error('Image generation model does not support summaries')
    }
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // 图像生成模型使用特殊处理
    if (this.isImageModel(modelId)) {
      return this.handleImageGeneration([{ role: 'user', content: prompt }])
    }
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    // 图像生成模型不支持建议
    if (this.isImageModel(modelId)) {
      throw new Error('Image generation model does not support suggestions')
    }
    const response = await this.openAICompletion(
      [
        {
          role: 'user',
          content: `基于以下上下文，给出3个可能的回复建议，每个建议一行：\n${context}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
    return response.content.split('\n').filter((line) => line.trim().length > 0)
  }

  async *streamCompletions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    // 图像生成模型需要特殊处理
    if (this.isImageModel(modelId)) {
      const result = await this.handleImageGeneration(messages)
      yield {
        content: result.content
      }
    } else {
      yield* this.openAIStreamCompletion(messages, modelId, temperature, maxTokens)
    }
  }

  async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    // 图像生成模型不支持摘要
    if (this.isImageModel(modelId)) {
      throw new Error('Image generation model does not support summaries')
    }
    yield* this.openAIStreamCompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    // 图像生成模型使用特殊处理
    if (this.isImageModel(modelId)) {
      const result = await this.handleImageGeneration([{ role: 'user', content: prompt }])
      yield {
        content: result.content
      }
      return
    }
    yield* this.openAIStreamCompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  // 处理图像生成请求的特殊方法
  private async handleImageGeneration(messages: ChatMessage[]): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    // 提取提示词（使用最后一条用户消息）
    const userMessage = messages.findLast((msg) => msg.role === 'user')
    if (!userMessage) {
      throw new Error('No user message found for image generation')
    }

    const prompt =
      typeof userMessage.content === 'string'
        ? userMessage.content
        : userMessage.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')

    // 创建图像生成请求
    try {
      const response = await this.openai.images.generate({
        model: GrokProvider.IMAGE_MODEL_ID,
        prompt,
        response_format: 'b64_json'
      })

      // 处理响应
      if (response.data && response.data.length > 0) {
        const imageData = response.data[0]
        if (imageData.b64_json) {
          // 返回base64编码的图像
          return {
            content: `![生成的图像](data:image/png;base64,${imageData.b64_json})`
          }
        } else if (imageData.url) {
          // 返回图像URL
          return {
            content: `![生成的图像](${imageData.url})`
          }
        }
      }
      throw new Error('No image data received from API')
    } catch (error: unknown) {
      console.error('Image generation failed:', error)
      throw new Error(`图像生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
