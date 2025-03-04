import {
  LLM_PROVIDER,
  LLMResponse,
  LLMResponseStream,
  MODEL_META,
  OllamaModel,
  ProgressResponse
} from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { ConfigPresenter } from '../../configPresenter'
import ollama, { ShowResponse } from 'ollama'

export class OllamaProvider extends BaseLLMProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  // 基础 Provider 功能实现
  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      // 获取 Ollama 本地已安装的模型列表
      const ollamaModels = await this.listModels()

      // 将 Ollama 模型格式转换为应用程序的 MODEL_META 格式
      return ollamaModels.map((model) => ({
        id: model.name,
        name: model.name,
        providerId: this.provider.id,
        contextLength: 8192, // 默认值，可以根据实际模型信息调整
        maxTokens: 2048, // 添加必需的 maxTokens 字段
        isCustom: false,
        group: model.details?.family || 'default',
        description: `${model.details?.parameter_size || ''} ${model.details?.family || ''} model`
      }))
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error)
      return []
    }
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      // 尝试获取模型列表来检查 Ollama 服务是否可用
      await ollama.list()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      console.error('Ollama service check failed:', error)
      return {
        isOk: false,
        errorMsg: `无法连接到 Ollama 服务: ${(error as Error).message}`
      }
    }
  }

  public async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string
  ): Promise<string> {
    try {
      const prompt = `根据以下对话生成一个简短的标题（不超过6个字）：\n\n${messages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n')}`

      const response = await ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: 0.3,
          num_predict: 30
        }
      })

      return response.response.trim()
    } catch (error) {
      console.error('Failed to generate title with Ollama:', error)
      return '新对话'
    }
  }

  public async completions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const response = await ollama.chat({
        model: modelId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content
        })),
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        }
      })

      return {
        content: response.message.content,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Ollama completions failed:', error)
      throw error
    }
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const prompt = `请对以下内容进行总结：\n\n${text}`

      const response = await ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.5,
          num_predict: maxTokens
        }
      })

      return {
        content: response.response,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Ollama summaries failed:', error)
      throw error
    }
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    try {
      const response = await ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        }
      })

      return {
        content: response.response,
        reasoning_content: undefined
      }
    } catch (error) {
      console.error('Ollama generate text failed:', error)
      throw error
    }
  }

  public async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    try {
      const prompt = `基于以下上下文，生成5个可能的后续问题或建议：\n\n${context}`

      const response = await ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.8,
          num_predict: maxTokens || 200
        }
      })

      // 简单处理返回的文本，按行分割，并过滤掉空行
      return response.response
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line.length > 0)
        .slice(0, 5) // 最多返回5个建议
    } catch (error) {
      console.error('Ollama suggestions failed:', error)
      return []
    }
  }

  public async *streamCompletions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    try {
      const stream = await ollama.chat({
        model: modelId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content
        })),
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        },
        stream: true
      })

      for await (const chunk of stream) {
        if (chunk.message?.content) {
          yield {
            content: chunk.message.content,
            reasoning_content: undefined
          }
        }
      }

      // 最终流结束时不需要传递 isEnd 参数
    } catch (error) {
      console.error('Ollama stream completions failed:', error)
      throw error
    }
  }

  public async *streamSummaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    try {
      const prompt = `请对以下内容进行总结：\n\n${text}`

      const stream = await ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.5,
          num_predict: maxTokens
        },
        stream: true
      })

      for await (const chunk of stream) {
        if (chunk.response) {
          yield {
            content: chunk.response,
            reasoning_content: undefined
          }
        }
      }

      // 最终流结束时不需要传递 isEnd 参数
    } catch (error) {
      console.error('Ollama stream summaries failed:', error)
      throw error
    }
  }

  public async *streamGenerateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMResponseStream> {
    try {
      const stream = await ollama.generate({
        model: modelId,
        prompt: prompt,
        options: {
          temperature: temperature || 0.7,
          num_predict: maxTokens
        },
        stream: true
      })

      for await (const chunk of stream) {
        if (chunk.response) {
          yield {
            content: chunk.response,
            reasoning_content: undefined
          }
        }
      }

      // 最终流结束时不需要传递 isEnd 参数
    } catch (error) {
      console.error('Ollama stream generate text failed:', error)
      throw error
    }
  }

  // Ollama 特有的模型管理功能
  public async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await ollama.list()
      // 返回类型转换，适应我们的 OllamaModel 接口
      return response.models as unknown as OllamaModel[]
    } catch (error) {
      console.error('Failed to list Ollama models:', error)
      return []
    }
  }

  public async listRunningModels(): Promise<OllamaModel[]> {
    try {
      const response = await ollama.ps()
      return response.models as unknown as OllamaModel[]
    } catch (error) {
      console.error('Failed to list running Ollama models:', error)
      return []
    }
  }

  public async pullModel(
    modelName: string,
    onProgress?: (progress: ProgressResponse) => void
  ): Promise<boolean> {
    try {
      const stream = await ollama.pull({
        model: modelName,
        insecure: true,
        stream: true
      })

      for await (const chunk of stream) {
        if (onProgress) {
          onProgress(chunk as ProgressResponse)
        }
      }

      return true
    } catch (error) {
      console.error(`Failed to pull Ollama model ${modelName}:`, error)
      return false
    }
  }

  public async deleteModel(modelName: string): Promise<boolean> {
    try {
      await ollama.delete({
        model: modelName
      })
      return true
    } catch (error) {
      console.error(`Failed to delete Ollama model ${modelName}:`, error)
      return false
    }
  }

  public async showModelInfo(modelName: string): Promise<ShowResponse> {
    try {
      const response = await ollama.show({
        model: modelName
      })
      return response
    } catch (error) {
      console.error(`Failed to show Ollama model info for ${modelName}:`, error)
      throw error
    }
  }
}
