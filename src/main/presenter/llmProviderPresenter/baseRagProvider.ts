import {
  LLM_PROVIDER,
  MODEL_META,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage
} from '@shared/presenter'
import { ConfigPresenter } from '../configPresenter'
import { DevicePresenter } from '../devicePresenter'

/**
 * 基础RAG提供商抽象类
 *
 * 该类专门为RAG（检索增强生成）服务设计，与传统LLM provider分离
 * RAG provider的核心功能是通过检索相关文档来增强回答质量
 */
export abstract class BaseRagProvider {
  protected provider: LLM_PROVIDER
  protected models: MODEL_META[] = []
  protected isInitialized: boolean = false
  protected configPresenter: ConfigPresenter

  protected defaultHeaders: Record<string, string> = {
    'HTTP-Referer': 'https://deepchatai.cn',
    'X-Title': 'DeepChat'
  }

  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    this.provider = provider
    this.configPresenter = configPresenter
    this.defaultHeaders = DevicePresenter.getDefaultHeaders()
    this.init()
  }

  /**
   * 初始化RAG提供商
   */
  protected async init(): Promise<void> {
    if (this.provider.enable) {
      try {
        this.isInitialized = true
        await this.fetchModels()
        console.info('RAG Provider initialized successfully:', this.provider.name)
      } catch (error) {
        console.warn('RAG Provider initialization failed:', this.provider.name, error)
      }
    }
  }

  /**
   * 获取RAG提供商的模型列表
   * @returns 模型列表
   */
  public async fetchModels(): Promise<MODEL_META[]> {
    try {
      const models = await this.fetchProviderModels()
      console.log('Fetched RAG models:', models?.length, this.provider.id)
      this.models = models
      this.configPresenter.setProviderModels(this.provider.id, models)
      return models
    } catch (e) {
      console.error('Failed to fetch RAG models:', e)
      if (!this.models) {
        this.models = []
      }
      return []
    }
  }

  /**
   * 获取特定RAG提供商的模型
   * 此方法由具体的RAG提供商子类实现
   * @returns RAG提供商支持的模型列表
   */
  protected abstract fetchProviderModels(): Promise<MODEL_META[]>

  /**
   * 获取所有模型
   * @returns 模型列表
   */
  public getModels(): MODEL_META[] {
    return this.models
  }

  /**
   * 验证RAG provider是否可用
   */
  public abstract check(): Promise<{ isOk: boolean; errorMsg: string | null }>

  /**
   * 代理更新回调
   */
  public abstract onProxyResolved(): void

  /**
   * RAG核心流式处理方法
   * 这是RAG provider的核心方法，处理检索和生成的流式输出
   * @param messages 对话消息
   * @param modelId 模型ID
   * @param modelConfig 模型配置
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @param tools 工具定义（RAG通常不使用工具，但保留接口一致性）
   */
  public abstract coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent>
}
