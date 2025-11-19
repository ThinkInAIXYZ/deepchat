import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import type {
  Client,
  ClientSideConnection as ClientSideConnectionType
} from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { Stream } from '@agentclientprotocol/sdk/dist/stream.js'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
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
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import { ModelType } from '@shared/model'
import { presenter } from '@/presenter'
import { DIALOG_WARN } from '@shared/dialog'
import { app } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

type EventQueue = {
  push: (event: LLMCoreStreamEvent | null) => void
  next: () => Promise<LLMCoreStreamEvent | null>
  done: () => void
}

export class AcpProvider extends BaseLLMProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    void this.initWhenEnabled()
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
    const acpEnabled = await this.configPresenter.getAcpEnabled()
    if (!acpEnabled) {
      yield { type: 'error', error_message: 'ACP is disabled' }
      return
    }
    const agent = await this.getAgentById(modelId)
    if (!agent) {
      yield { type: 'error', error_message: `ACP agent not found: ${modelId}` }
      return
    }

    const queue = this.createEventQueue()
    let connection: ClientSideConnectionType | null = null
    let sessionId: string | null = null
    let child: ChildProcessWithoutNullStreams | null = null

    const pushError = (error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      queue.push({ type: 'error', error_message: `ACP: ${message}` })
    }

    const client: Client = {
      requestPermission: async (params) => {
        queue.push({
          type: 'reasoning',
          reasoning_content: `ACP agent requests permission: ${params.toolCall.title ?? params.toolCall.toolCallId}`
        })

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
          typeof response === 'string' &&
          params.options.find((option) => option.optionId === response)

        if (!selected || response === 'cancel') {
          return { outcome: { outcome: 'cancelled' } }
        }

        return {
          outcome: {
            outcome: 'selected',
            optionId: selected.optionId
          }
        }
      },
      sessionUpdate: async (notification) => {
        this.handleSessionUpdate(notification, queue)
      }
    }

    const run = async () => {
      try {
        child = this.spawnAgentProcess(agent)
        child.on('error', (error) => pushError(error))
        const stream = this.createAgentStream(child)
        connection = new ClientSideConnection(() => client, stream)

        await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: 'DeepChat', version: app.getVersion() }
        })

        const newSession = await connection.newSession({
          cwd: process.cwd(),
          mcpServers: []
        })
        sessionId = newSession.sessionId

        const promptText = this.formatMessages(messages, modelConfig)
        const promptResponse = await connection.prompt({
          sessionId,
          prompt: [{ type: 'text', text: promptText }]
        })

        queue.push({
          type: 'stop',
          stop_reason: this.mapStopReason(promptResponse.stopReason)
        })
      } catch (error) {
        pushError(error)
      } finally {
        queue.done()
      }
    }

    void run()

    try {
      while (true) {
        const event = await queue.next()
        if (event === null) break
        yield event
      }
    } finally {
      try {
        const activeConnection = connection as ClientSideConnectionType | null
        if (activeConnection && sessionId) {
          await activeConnection.cancel({ sessionId })
        }
      } catch (error) {
        console.warn('ACP cancel failed:', error)
      }

      const childProcess = child as ChildProcessWithoutNullStreams | null
      if (childProcess && !childProcess.killed) {
        childProcess.kill()
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

  private handleSessionUpdate(notification: schema.SessionNotification, queue: EventQueue): void {
    const update = notification.update
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.pushContentEvent(update.content, queue, 'text')
        break
      case 'agent_thought_chunk':
        this.pushContentEvent(update.content, queue, 'reasoning')
        break
      case 'tool_call':
      case 'tool_call_update': {
        const title = 'title' in update ? update.title : null
        const status = 'status' in update ? update.status : null
        const descriptionParts = [
          update.sessionUpdate === 'tool_call_update' ? 'Tool call update' : 'Tool call',
          title,
          status
        ]
        queue.push({
          type: 'reasoning',
          reasoning_content: descriptionParts.filter(Boolean).join(' - ')
        })
        if ('content' in update && update.content) {
          const contentText = this.formatToolCallContent(update.content)
          if (contentText) {
            queue.push({ type: 'text', content: contentText })
          }
        }
        break
      }
      case 'plan':
        queue.push({
          type: 'reasoning',
          reasoning_content: `Plan updated: ${(update.entries || [])
            .map((entry) => `${entry.content} (${entry.status})`)
            .join('; ')}`
        })
        break
      case 'user_message_chunk':
        // Ignore echoes of user input
        break
      default:
        break
    }
  }

  private pushContentEvent(
    content:
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
      | { type: 'audio'; data: string; mimeType: string }
      | { type: 'resource_link'; uri: string }
      | { type: 'resource'; resource: unknown },
    queue: EventQueue,
    kind: 'text' | 'reasoning'
  ) {
    if (!content) return

    if (content.type === 'text') {
      if (kind === 'text') {
        queue.push({ type: 'text', content: content.text })
      } else {
        queue.push({ type: 'reasoning', reasoning_content: content.text })
      }
      return
    }

    if (content.type === 'image' && content.data && content.mimeType) {
      queue.push({
        type: 'image_data',
        image_data: { data: content.data, mimeType: content.mimeType }
      })
      return
    }

    const serialized = JSON.stringify(content)
    if (kind === 'text') {
      queue.push({ type: 'text', content: serialized })
    } else {
      queue.push({ type: 'reasoning', reasoning_content: serialized })
    }
  }

  private formatToolCallContent(contents: schema.ToolCallContent[]): string {
    return contents
      .map((item) => {
        if (item.type === 'content') {
          const block = item.content
          switch (block.type) {
            case 'text':
              return block.text
            case 'image':
              return '[image content]'
            case 'audio':
              return '[audio]'
            case 'resource':
              return '[resource]'
            case 'resource_link':
              return block.uri
            default:
              return JSON.stringify(block)
          }
        }
        if (item.type === 'terminal') {
          return 'output' in item && typeof item.output === 'string'
            ? item.output
            : `[terminal:${item.terminalId}]`
        }
        if (item.type === 'diff') {
          return item.path ? `diff: ${item.path}` : '[diff]'
        }
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join('\n')
  }

  private createAgentStream(child: ChildProcessWithoutNullStreams): Stream {
    const writable = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>
    const readable = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
    return ndJsonStream(writable, readable)
  }

  private spawnAgentProcess(agent: AcpAgentConfig): ChildProcessWithoutNullStreams {
    const mergedEnv = agent.env ? { ...process.env, ...agent.env } : { ...process.env }
    console.log('spawnAgentProcess', agent.command, agent.args, mergedEnv)
    return spawn(agent.command, agent.args ?? [], {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    })
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

  private formatMessages(messages: ChatMessage[], modelConfig: ModelConfig): string {
    const temperatureText = `temperature=${modelConfig.temperature ?? 0.6}, maxTokens=${modelConfig.maxTokens ?? 4096}`
    const formatted = messages
      .map((message) => {
        const role = message.role?.toUpperCase?.() ?? 'UNKNOWN'
        return `${role}: ${this.stringifyContent(message.content)}`
      })
      .join('\n')

    return `${temperatureText}\n${formatted}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stringifyContent(content: any): string {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item
          if (typeof item === 'object' && 'text' in item) return (item as { text: string }).text
          return JSON.stringify(item)
        })
        .join('\n')
    }
    if (typeof content === 'object') {
      return JSON.stringify(content)
    }
    return String(content)
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
