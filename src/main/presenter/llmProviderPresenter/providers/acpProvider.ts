import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { BaseAgentProvider } from '../baseAgentProvider'
import type {
  ChatMessage,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig,
  AcpAgentConfig,
  LLM_PROVIDER,
  IConfigPresenter
} from '@shared/presenter'
import { createStreamEvent, type LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import { ModelType } from '@shared/model'
import { presenter } from '@/presenter'
import { DIALOG_WARN } from '@shared/dialog'
import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { AcpProcessManager } from '../agent/acpProcessManager'
import { AcpSessionManager } from '../agent/acpSessionManager'
import type { AcpSessionRecord } from '../agent/acpSessionManager'
import { AcpContentMapper } from '../agent/acpContentMapper'
import { AcpMessageFormatter } from '../agent/acpMessageFormatter'
import { AcpSessionPersistence } from '../agent/acpSessionPersistence'

type EventQueue = {
  push: (event: LLMCoreStreamEvent | null) => void
  next: () => Promise<LLMCoreStreamEvent | null>
  done: () => void
}

export class AcpProvider extends BaseAgentProvider<
  AcpSessionManager,
  AcpProcessManager,
  schema.RequestPermissionRequest,
  schema.RequestPermissionResponse
> {
  private readonly processManager: AcpProcessManager
  private readonly sessionManager: AcpSessionManager
  private readonly sessionPersistence: AcpSessionPersistence
  private readonly contentMapper = new AcpContentMapper()
  private readonly messageFormatter = new AcpMessageFormatter()

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    sessionPersistence: AcpSessionPersistence
  ) {
    super(provider, configPresenter)
    this.sessionPersistence = sessionPersistence
    this.processManager = new AcpProcessManager({ providerId: provider.id })
    this.sessionManager = new AcpSessionManager({
      providerId: provider.id,
      processManager: this.processManager,
      sessionPersistence: this.sessionPersistence
    })

    void this.initWhenEnabled()
  }

  protected getSessionManager(): AcpSessionManager {
    return this.sessionManager
  }

  protected getProcessManager(): AcpProcessManager {
    return this.processManager
  }

  protected async requestPermission(
    params: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    const optionButtons = params.options.map((option, index) => ({
      key: option.optionId,
      label: this.mapPermissionLabel(option.kind),
      default: index === 0
    }))

    const response = await presenter.dialogPresenter
      .showDialog({
        title: 'acp.permission.title',
        description: 'acp.permission.description',
        i18n: true,
        icon: DIALOG_WARN,
        buttons: [
          ...optionButtons,
          { key: 'cancel', label: 'dialog.cancel', default: optionButtons.length === 0 }
        ]
      })
      .catch(() => 'cancel')

    const selected =
      typeof response === 'string' && params.options.find((option) => option.optionId === response)

    if (!selected || response === 'cancel') {
      return { outcome: { outcome: 'cancelled' } }
    }

    return {
      outcome: {
        outcome: 'selected',
        optionId: selected.optionId
      }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      const acpEnabled = await this.configPresenter.getAcpEnabled()
      if (!acpEnabled) {
        console.log('[ACP] fetchProviderModels: ACP is disabled, returning empty models')
        this.configPresenter.setProviderModels(this.provider.id, [])
        return []
      }
      const agents = await this.configPresenter.getAcpAgents()
      console.log(
        `[ACP] fetchProviderModels: found ${agents.length} agents, creating models for provider "${this.provider.id}"`
      )

      const models: MODEL_META[] = agents.map((agent) => {
        const model: MODEL_META = {
          id: agent.id,
          name: agent.name,
          group: 'ACP',
          providerId: this.provider.id, // Ensure providerId is explicitly set
          isCustom: true,
          contextLength: 8192,
          maxTokens: 4096,
          description: agent.command,
          functionCall: true,
          reasoning: false,
          enableSearch: false,
          type: ModelType.Chat
        }

        // Validate that providerId is correctly set
        if (model.providerId !== this.provider.id) {
          console.error(
            `[ACP] fetchProviderModels: Model ${model.id} has incorrect providerId: expected "${this.provider.id}", got "${model.providerId}"`
          )
          model.providerId = this.provider.id // Fix it
        }

        return model
      })

      console.log(
        `[ACP] fetchProviderModels: returning ${models.length} models, all with providerId="${this.provider.id}"`
      )
      this.configPresenter.setProviderModels(this.provider.id, models)
      return models
    } catch (error) {
      console.error('[ACP] fetchProviderModels: Failed to load ACP agents:', error)
      return []
    }
  }

  public onProxyResolved(): void {
    // ACP agents run locally; no proxy handling needed
    // When provider is enabled, trigger model loading
    void this.initWhenEnabled()
  }

  /**
   * Override init to send MODEL_LIST_CHANGED event after initialization
   * This ensures renderer is notified when ACP provider is initialized on startup
   */
  protected async init(): Promise<void> {
    const acpEnabled = await this.configPresenter.getAcpEnabled()
    if (!acpEnabled || !this.provider.enable) return

    try {
      this.isInitialized = true
      await this.fetchModels()
      await this.autoEnableModelsIfNeeded()
      // Send MODEL_LIST_CHANGED event to notify renderer to refresh model list
      console.log(`[ACP] init: sending MODEL_LIST_CHANGED event for provider "${this.provider.id}"`)
      eventBus.sendToRenderer(
        CONFIG_EVENTS.MODEL_LIST_CHANGED,
        SendTarget.ALL_WINDOWS,
        this.provider.id
      )
      console.info('Provider initialized successfully:', this.provider.name)
    } catch (error) {
      console.warn('Provider initialization failed:', this.provider.name, error)
    }
  }

  /**
   * Handle provider enable state changes
   * Called when the provider's enable state changes to true
   */
  public async handleEnableStateChange(): Promise<void> {
    const acpEnabled = await this.configPresenter.getAcpEnabled()
    if (acpEnabled && this.provider.enable) {
      console.log('[ACP] handleEnableStateChange: ACP enabled, triggering model fetch')
      await this.fetchModels()
      // Send MODEL_LIST_CHANGED event to notify renderer to refresh model list
      console.log(
        `[ACP] handleEnableStateChange: sending MODEL_LIST_CHANGED event for provider "${this.provider.id}"`
      )
      eventBus.sendToRenderer(
        CONFIG_EVENTS.MODEL_LIST_CHANGED,
        SendTarget.ALL_WINDOWS,
        this.provider.id
      )
    }
  }

  public async refreshAgents(agentIds?: string[]): Promise<void> {
    const ids = agentIds?.length
      ? Array.from(new Set(agentIds))
      : (await this.configPresenter.getAcpAgents()).map((agent) => agent.id)

    const tasks = ids.map(async (agentId) => {
      try {
        await this.sessionManager.clearSessionsByAgent(agentId)
      } catch (error) {
        console.warn(`[ACP] Failed to clear sessions for agent ${agentId}:`, error)
      }

      try {
        await this.processManager.release(agentId)
      } catch (error) {
        console.warn(`[ACP] Failed to release process for agent ${agentId}:`, error)
      }
    })

    await Promise.allSettled(tasks)
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    const enabled = await this.configPresenter.getAcpEnabled()
    if (!enabled) {
      return {
        isOk: false,
        errorMsg: 'ACP is disabled'
      }
    }
    const agents = await this.configPresenter.getAcpAgents()
    if (!agents.length) {
      return {
        isOk: false,
        errorMsg: 'No ACP agents configured'
      }
    }
    return { isOk: true, errorMsg: null }
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const promptMessages: ChatMessage[] = [
      { role: 'system', content: SUMMARY_TITLES_PROMPT },
      ...messages
    ]
    const response = await this.completions(promptMessages, modelId)
    return response.content || ''
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature: number = 0.6,
    maxTokens: number = 4096
  ): Promise<LLMResponse> {
    const modelConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)
    const { content, reasoning } = await this.collectFromStream(
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens
    )

    return {
      content,
      reasoning_content: reasoning
    }
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature: number = 0.6,
    maxTokens: number = 4096
  ): Promise<LLMResponse> {
    return this.completions([{ role: 'user', content: text }], modelId, temperature, maxTokens)
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature: number = 0.6,
    maxTokens: number = 4096
  ): Promise<LLMResponse> {
    return this.completions([{ role: 'user', content: prompt }], modelId, temperature, maxTokens)
  }

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    _temperature: number,
    _maxTokens: number,
    _tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const queue = this.createEventQueue()
    let session: AcpSessionRecord | null = null

    try {
      const acpEnabled = await this.configPresenter.getAcpEnabled()
      if (!acpEnabled) {
        queue.push(createStreamEvent.error('ACP is disabled'))
        queue.done()
      } else {
        const agent = await this.getAgentById(modelId)
        if (!agent) {
          queue.push(createStreamEvent.error(`ACP agent not found: ${modelId}`))
          queue.done()
        } else {
          const conversationKey = modelConfig.conversationId ?? modelId
          const workdir = await this.sessionPersistence.getWorkdir(conversationKey, agent.id)
          session = await this.sessionManager.getOrCreateSession(
            conversationKey,
            agent,
            {
              onSessionUpdate: (notification) => {
                console.log('[ACP] onSessionUpdate: notification:', JSON.stringify(notification))
                const mapped = this.contentMapper.map(notification)
                mapped.events.forEach((event) => queue.push(event))
              },
              onPermission: (request) => this.handlePermissionRequest(queue, request)
            },
            workdir
          )

          const promptBlocks = this.messageFormatter.format(messages, modelConfig)
          void this.runPrompt(session, promptBlocks, queue)
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      queue.push(createStreamEvent.error(`ACP: ${message}`))
      queue.done()
    }

    try {
      while (true) {
        const event = await queue.next()
        if (event === null) break
        yield event
      }
    } finally {
      if (session) {
        try {
          await session.connection.cancel({ sessionId: session.sessionId })
        } catch (error) {
          console.warn('[ACP] cancel failed:', error)
        }
      }
    }
  }

  public async getAcpWorkdir(conversationId: string, agentId: string): Promise<string> {
    return this.sessionPersistence.getWorkdir(conversationId, agentId)
  }

  public async updateAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    const trimmed = workdir?.trim() ? workdir : null
    const existing = await this.sessionPersistence.getSessionData(conversationId, agentId)
    const previous = existing?.workdir ?? null
    await this.sessionPersistence.updateWorkdir(conversationId, agentId, trimmed)
    const previousResolved = this.sessionPersistence.resolveWorkdir(previous)
    const nextResolved = this.sessionPersistence.resolveWorkdir(trimmed)
    if (previousResolved !== nextResolved) {
      try {
        await this.sessionManager.clearSession(conversationId)
      } catch (error) {
        console.warn('[ACP] Failed to clear session after workdir update:', error)
      }
    }
  }

  private async runPrompt(
    session: AcpSessionRecord,
    prompt: schema.ContentBlock[],
    queue: EventQueue
  ): Promise<void> {
    try {
      const response = await session.connection.prompt({
        sessionId: session.sessionId,
        prompt
      })
      console.log('[ACP] runPrompt: response:', response)
      queue.push(createStreamEvent.stop(this.mapStopReason(response.stopReason)))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      queue.push(createStreamEvent.error(`ACP: ${message}`))
    } finally {
      queue.done()
    }
  }

  private async handlePermissionRequest(
    queue: EventQueue,
    params: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    queue.push({
      type: 'reasoning',
      reasoning_content: `ACP agent requests permission: ${params.toolCall.title ?? params.toolCall.toolCallId}`
    })
    return await this.requestPermission(params)
  }

  private async collectFromStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number
  ): Promise<{ content: string; reasoning: string }> {
    const mergedConfig: ModelConfig = {
      ...modelConfig,
      temperature: temperature ?? modelConfig.temperature,
      maxTokens: maxTokens ?? modelConfig.maxTokens
    }

    let content = ''
    let reasoning = ''
    for await (const chunk of this.coreStream(
      messages,
      modelId,
      mergedConfig,
      temperature,
      maxTokens,
      []
    )) {
      console.log('[ACP] collectFromStream: chunk:', chunk)
      if (chunk.type === 'text' && chunk.content) {
        content += chunk.content
      } else if (chunk.type === 'reasoning' && chunk.reasoning_content) {
        reasoning += chunk.reasoning_content
      }
    }
    return { content, reasoning }
  }

  private mapPermissionLabel(kind: schema.PermissionOption['kind']): string {
    switch (kind) {
      case 'allow_once':
        return 'acp.permission.allowOnce'
      case 'allow_always':
        return 'acp.permission.allowAlways'
      case 'reject_always':
        return 'acp.permission.rejectAlways'
      case 'reject_once':
      default:
        return 'acp.permission.rejectOnce'
    }
  }

  private mapStopReason(
    reason: schema.PromptResponse['stopReason']
  ): 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete' {
    switch (reason) {
      case 'max_tokens':
        return 'max_tokens'
      case 'max_turn_requests':
        return 'stop_sequence'
      case 'cancelled':
        return 'error'
      case 'refusal':
        return 'error'
      case 'end_turn':
      default:
        return 'complete'
    }
  }

  private createEventQueue(): EventQueue {
    const queue: Array<LLMCoreStreamEvent | null> = []
    let resolver: ((value: LLMCoreStreamEvent | null) => void) | null = null

    return {
      push: (event) => {
        if (resolver) {
          resolver(event)
          resolver = null
        } else {
          queue.push(event)
        }
      },
      next: async () => {
        if (queue.length > 0) {
          return queue.shift() ?? null
        }
        return await new Promise<LLMCoreStreamEvent | null>((resolve) => {
          resolver = resolve
        })
      },
      done: () => {
        if (resolver) {
          resolver(null)
          resolver = null
        } else {
          queue.push(null)
        }
      }
    }
  }

  private async getAgentById(agentId: string): Promise<AcpAgentConfig | null> {
    const agents = await this.configPresenter.getAcpAgents()
    return agents.find((agent) => agent.id === agentId) ?? null
  }

  private async initWhenEnabled(): Promise<void> {
    const enabled = await this.configPresenter.getAcpEnabled()
    if (!enabled) return
    // Call this.init() instead of super.init() to use the overridden method
    await this.init()
  }
}
