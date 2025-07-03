import {
  MODEL_META,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage
} from '@shared/presenter'
import { AGENT_CONFIG } from './index'
import { ConfigPresenter } from '../configPresenter'
import { DevicePresenter } from '../devicePresenter'

/**
 * 基础Agent提供商抽象类
 *
 * 该类专门为Agent Flow服务设计，处理各种类型的智能代理交互
 * Agent provider的核心功能是执行特定的智能代理流程
 */
export abstract class BaseAgentProvider {
  protected agent: AGENT_CONFIG
  protected models: MODEL_META[] = []
  protected isInitialized: boolean = false
  protected configPresenter: ConfigPresenter

  protected defaultHeaders: Record<string, string> = {
    'HTTP-Referer': 'https://deepchatai.cn',
    'X-Title': 'DeepChat'
  }

  constructor(agent: AGENT_CONFIG, configPresenter: ConfigPresenter) {
    this.agent = agent
    this.configPresenter = configPresenter
    this.defaultHeaders = DevicePresenter.getDefaultHeaders()
    this.init()
  }

  /**
   * 初始化Agent提供商
   */
  protected async init(): Promise<void> {
    if (this.agent.enabled) {
      try {
        this.isInitialized = true
        await this.fetchModels()
        console.info('Agent Provider initialized successfully:', this.agent.name)
      } catch (error) {
        console.warn('Agent Provider initialization failed:', this.agent.name, error)
      }
    }
  }

  /**
   * 获取Agent提供商的模型列表
   * @returns 模型列表
   */
  public async fetchModels(): Promise<MODEL_META[]> {
    try {
      const models = await this.fetchProviderModels()
      console.log('Fetched Agent models:', models?.length, this.agent.id)
      this.models = models
      this.configPresenter.setProviderModels(this.agent.id, models)
      return models
    } catch (e) {
      console.error('Failed to fetch Agent models:', e)
      if (!this.models) {
        this.models = []
      }
      return []
    }
  }

  /**
   * 获取特定Agent提供商的模型
   * 此方法由具体的Agent提供商子类实现
   * @returns Agent提供商支持的模型列表
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
   * 验证Agent provider是否可用
   */
  public abstract check(): Promise<{ isOk: boolean; errorMsg: string | null }>

  /**
   * 代理更新回调
   */
  public abstract onProxyResolved(): void

  /**
   * Agent核心流式处理方法
   * 这是Agent provider的核心方法，处理Agent的流式输出
   * @param messages 对话消息
   * @param modelId 模型ID
   * @param modelConfig 模型配置
   * @param temperature 温度参数
   * @param maxTokens 最大token数
   * @param tools 工具定义（Agent可能会使用工具）
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
