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
import {
  createStreamEvent,
  type LLMCoreStreamEvent,
  type PermissionRequestPayload,
  type PermissionRequestOption
} from '@shared/types/core/llm-events'
import { ModelType } from '@shared/model'
import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { AcpProcessManager } from '../agent/acpProcessManager'
import { AcpSessionManager } from '../agent/acpSessionManager'
import type { AcpSessionRecord } from '../agent/acpSessionManager'
import { AcpContentMapper } from '../agent/acpContentMapper'
import { AcpMessageFormatter } from '../agent/acpMessageFormatter'
import { AcpSessionPersistence } from '../agent/acpSessionPersistence'
import { nanoid } from 'nanoid'
import { presenter } from '@/presenter'

type EventQueue = {
  push: (event: LLMCoreStreamEvent | null) => void
  next: () => Promise<LLMCoreStreamEvent | null>
  done: () => void
}

type PermissionRequestContext = {
  agent: AcpAgentConfig
  conversationId: string
}

type PendingPermissionState = {
  requestId: string
  sessionId: string
  params: schema.RequestPermissionRequest
  context: PermissionRequestContext
  resolve: (response: schema.RequestPermissionResponse) => void
  reject: (error: Error) => void
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
  private readonly pendingPermissions = new Map<string, PendingPermissionState>()

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    sessionPersistence: AcpSessionPersistence
  ) {
    super(provider, configPresenter)
    this.sessionPersistence = sessionPersistence
    this.processManager = new AcpProcessManager({
      providerId: provider.id,
      getUseBuiltinRuntime: () => this.configPresenter.getAcpUseBuiltinRuntime(),
      getNpmRegistry: async () => {
        // Get npm registry from MCP presenter's server manager
        // This will use the fastest registry from speed test
        return presenter.mcpPresenter.getNpmRegistry?.() ?? null
      },
      getUvRegistry: async () => {
        // Get uv registry from MCP presenter's server manager
        // This will use the fastest registry from speed test
        return presenter.mcpPresenter.getUvRegistry?.() ?? null
      }
    })
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
    void params
    return { outcome: { outcome: 'cancelled' } }
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
              onPermission: (request) =>
                this.handlePermissionRequest(queue, request, {
                  agent,
                  conversationId: conversationKey
                })
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
        this.clearPendingPermissionsForSession(session.sessionId)
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
    params: schema.RequestPermissionRequest,
    context: PermissionRequestContext
  ): Promise<schema.RequestPermissionResponse> {
    const { requestId, promise } = this.registerPendingPermission(params, context)

    const toolLabel = params.toolCall.title ?? params.toolCall.toolCallId
    queue.push(
      createStreamEvent.reasoning(
        `ACP agent "${context.agent.name}" requests permission: ${toolLabel}`
      )
    )
    queue.push(
      createStreamEvent.permission(this.buildPermissionPayload(params, context, requestId))
    )

    return await promise
  }

  private registerPendingPermission(
    params: schema.RequestPermissionRequest,
    context: PermissionRequestContext
  ): { requestId: string; promise: Promise<schema.RequestPermissionResponse> } {
    const requestId = nanoid()

    const promise = new Promise<schema.RequestPermissionResponse>((resolve, reject) => {
      this.pendingPermissions.set(requestId, {
        requestId,
        sessionId: params.sessionId,
        params,
        context,
        resolve,
        reject
      })
    })

    return { requestId, promise }
  }

  private buildPermissionPayload(
    params: schema.RequestPermissionRequest,
    context: PermissionRequestContext,
    requestId: string
  ): PermissionRequestPayload {
    const permissionType = this.mapPermissionType(params.toolCall.kind)
    const toolName = params.toolCall.title?.trim() || params.toolCall.toolCallId
    const options: PermissionRequestOption[] = params.options.map((option) => ({
      optionId: option.optionId,
      kind: option.kind,
      name: option.name
    }))

    return {
      providerId: this.provider.id,
      providerName: this.provider.name,
      requestId,
      sessionId: params.sessionId,
      conversationId: context.conversationId,
      agentId: context.agent.id,
      agentName: context.agent.name,
      tool_call_id: params.toolCall.toolCallId,
      tool_call_name: toolName,
      tool_call_params: this.summarizeToolCallParams(params.toolCall),
      description: `components.messageBlockPermissionRequest.description.${permissionType}`,
      permissionType,
      server_name: context.agent.name,
      server_description: context.agent.command,
      options,
      metadata: { rememberable: false }
    }
  }

  private summarizeToolCallParams(toolCall: schema.RequestPermissionRequest['toolCall']): string {
    if (toolCall.locations?.length) {
      const uniquePaths = Array.from(new Set(toolCall.locations.map((location) => location.path)))
      return uniquePaths.slice(0, 3).join(', ')
    }
    if (toolCall.rawInput && Object.keys(toolCall.rawInput).length > 0) {
      try {
        return JSON.stringify(toolCall.rawInput)
      } catch (error) {
        console.warn('[ACP] Failed to stringify rawInput for permission request:', error)
      }
    }
    return toolCall.toolCallId
  }

  private mapPermissionType(kind?: schema.ToolKind | null): 'read' | 'write' | 'all' {
    switch (kind) {
      case 'read':
      case 'fetch':
      case 'search':
        return 'read'
      case 'edit':
      case 'delete':
      case 'move':
      case 'execute':
        return 'write'
      default:
        return 'all'
    }
  }

  private pickPermissionOption(
    options: schema.PermissionOption[],
    decision: 'allow' | 'deny'
  ): schema.PermissionOption | null {
    const allowOrder: schema.PermissionOption['kind'][] = ['allow_once', 'allow_always']
    const denyOrder: schema.PermissionOption['kind'][] = ['reject_once', 'reject_always']
    const order = decision === 'allow' ? allowOrder : denyOrder
    for (const kind of order) {
      const match = options.find((option) => option.kind === kind)
      if (match) {
        return match
      }
    }
    return null
  }

  public async resolvePermissionRequest(requestId: string, granted: boolean): Promise<void> {
    const state = this.pendingPermissions.get(requestId)
    if (!state) {
      throw new Error(`Unknown ACP permission request: ${requestId}`)
    }

    this.pendingPermissions.delete(requestId)

    const option = this.pickPermissionOption(state.params.options, granted ? 'allow' : 'deny')
    if (option) {
      state.resolve({ outcome: { outcome: 'selected', optionId: option.optionId } })
    } else if (granted) {
      console.warn('[ACP] No matching permission option for grant, defaulting to cancel')
      state.resolve({ outcome: { outcome: 'cancelled' } })
    } else {
      state.resolve({ outcome: { outcome: 'cancelled' } })
    }
  }

  private clearPendingPermissionsForSession(sessionId: string): void {
    for (const [requestId, state] of this.pendingPermissions.entries()) {
      if (state.sessionId === sessionId) {
        this.pendingPermissions.delete(requestId)
        state.resolve({ outcome: { outcome: 'cancelled' } })
      }
    }
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
