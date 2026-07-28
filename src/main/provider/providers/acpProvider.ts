import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { ClientSideConnection as ClientSideConnectionType } from '@agentclientprotocol/sdk'
import {
  BaseLLMProvider,
  SUMMARY_TITLES_PROMPT,
  type ProviderGenerateTextOptions
} from '../baseProvider'
import type { ProviderLocalePort } from '../ports'
import type { AgentSettingsPort } from '@/agent/settings'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMResponse } from '@shared/types/provider'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type {
  MODEL_META,
  ModelConfig,
  LLM_PROVIDER,
  ProviderStreamOptions
} from '@shared/types/provider'
import type {
  AcpAgentConfig,
  AcpConfigState,
  AcpDebugEventEntry,
  AcpDebugRequest,
  AcpDebugRunResult,
  AcpTurnFinishPayload,
  AcpTurnStartPayload
} from '@shared/types/acp'
import {
  createStreamEvent,
  type LLMCoreStreamEvent,
  type PermissionRequestPayload,
  type PermissionRequestOption
} from '@shared/types/core/llm-events'
import { ModelType } from '@shared/model'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import {
  AcpProcessManager,
  AcpSessionManager,
  AcpSessionPersistence,
  createAcpPromptTerminalEvents,
  AcpMessageFormatter,
  type AcpProcessHandle,
  type AcpSessionRecord
} from '@/agent/acp/runtime'
import { AcpRuntimeOwner, AcpPromptController } from '@/agent/acp/client'
import { nanoid } from 'nanoid'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { extractProviderFailureMetadata } from '../providerFailure'

type EventQueue = {
  push: (event: LLMCoreStreamEvent | null) => void
  next: () => Promise<LLMCoreStreamEvent | null>
  done: () => void
}

type RunPromptOptions = {
  onPromptSucceeded?: () => void
  signal?: AbortSignal
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
  timeoutId: ReturnType<typeof setTimeout>
}

type StandaloneRequest = {
  started: boolean
  signal?: AbortSignal
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  detachAbort?: () => void
}

type StandaloneRequestQueue = {
  active: boolean
  pending: StandaloneRequest[]
}

const ACP_PERMISSION_TIMEOUT_MS = 60_000

type AcpConnectionWithModelSelection = {
  unstable_setSessionModel?: (
    params: schema.SetSessionModelRequest
  ) => Promise<schema.SetSessionModelResponse>
}

type AcpConnectionWithDebugLifecycle = ClientSideConnectionType &
  AcpConnectionWithModelSelection & {
    authenticate?: (params: schema.AuthenticateRequest) => Promise<schema.AuthenticateResponse>
    listSessions?: (params: schema.ListSessionsRequest) => Promise<schema.ListSessionsResponse>
    unstable_resumeSession?: (
      params: schema.ResumeSessionRequest
    ) => Promise<schema.ResumeSessionResponse>
    unstable_closeSession?: (
      params: schema.CloseSessionRequest
    ) => Promise<schema.CloseSessionResponse>
    unstable_forkSession?: (
      params: schema.ForkSessionRequest
    ) => Promise<schema.ForkSessionResponse>
  }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const summarizePromptBlocks = (blocks: schema.ContentBlock[]) =>
  blocks.map((block) => {
    if (!isRecord(block)) {
      return { type: 'unknown', keys: [] }
    }
    const record = block as unknown as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text : undefined
    return {
      type: typeof record.type === 'string' ? record.type : 'unknown',
      textLength: text?.length,
      keys: Object.keys(record)
    }
  })

async function setSessionModelCompat(
  connection: AcpConnectionWithModelSelection,
  params: schema.SetSessionModelRequest
): Promise<schema.SetSessionModelResponse> {
  if (!connection.unstable_setSessionModel) {
    throw new Error('[ACP] Session model selection is not supported by this SDK connection.')
  }

  return connection.unstable_setSessionModel(params)
}

export class AcpProvider extends BaseLLMProvider {
  private readonly processManager: AcpProcessManager
  private readonly sessionManager: AcpSessionManager
  private readonly sessionPersistence: AcpSessionPersistence
  private readonly acpRuntimeOwner: AcpRuntimeOwner
  private readonly acpRuntime: ReturnType<AcpRuntimeOwner['getOrCreate']>
  private readonly promptController: AcpPromptController
  private readonly messageFormatter = new AcpMessageFormatter()
  private readonly pendingPermissions = new Map<string, PendingPermissionState>()
  private readonly agentSettings: Pick<AgentSettingsPort, 'getAcpEnabled' | 'getAcpAgents'>
  private standaloneRequestQueues?: Map<string, StandaloneRequestQueue>

  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort,
    agentSettings: Pick<AgentSettingsPort, 'getAcpEnabled' | 'getAcpAgents'>,
    runtimeOwner: AcpRuntimeOwner,
    private readonly publishEvent: DeepchatEventPublisher
  ) {
    super(provider, providerSettings, locale)
    this.agentSettings = agentSettings
    this.acpRuntimeOwner = runtimeOwner
    this.acpRuntime = runtimeOwner.getOrCreate()
    this.sessionPersistence = this.acpRuntime.sessionPersistence
    this.processManager = this.acpRuntime.processManager
    this.sessionManager = this.acpRuntime.sessionManager
    this.promptController = this.acpRuntime.promptController

    void this.initWhenEnabled()
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      const acpEnabled = await this.agentSettings.getAcpEnabled()
      if (!acpEnabled) {
        logger.info('[ACP] fetchProviderModels: ACP is disabled, returning empty models')
        this.providerSettings.setProviderModels(this.provider.id, [])
        return []
      }
      const agents = await this.agentSettings.getAcpAgents()
      logger.info(
        `[ACP] fetchProviderModels: found ${agents.length} agents, creating models for provider "${this.provider.id}"`
      )

      const models: MODEL_META[] = agents.map((agent) => {
        const model: MODEL_META = {
          id: agent.id,
          name: agent.name,
          group: 'ACP',
          providerId: this.provider.id, // Ensure providerId is explicitly set
          isCustom: true,
          description: agent.description || agent.command,
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

      logger.info(
        `[ACP] fetchProviderModels: returning ${models.length} models, all with providerId="${this.provider.id}"`
      )
      this.providerSettings.setProviderModels(this.provider.id, models)
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

  public override updateConfig(provider: LLM_PROVIDER): void {
    super.updateConfig(provider)
  }

  /**
   * Override init to send MODEL_LIST_CHANGED event after initialization
   * This ensures renderer is notified when ACP provider is initialized on startup
   */
  protected async init(): Promise<void> {
    const acpEnabled = await this.agentSettings.getAcpEnabled()
    if (!acpEnabled || !this.provider.enable) return

    try {
      this.isInitialized = true
      await this.fetchModels()
      await this.autoEnableModelsIfNeeded()
      // Send MODEL_LIST_CHANGED event to notify renderer to refresh model list
      logger.info(`[ACP] init: sending MODEL_LIST_CHANGED event for provider "${this.provider.id}"`)
      this.providerSettings.notifyModelsChanged(this.provider.id)
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
    const acpEnabled = await this.agentSettings.getAcpEnabled()
    if (acpEnabled && this.provider.enable) {
      logger.info('[ACP] handleEnableStateChange: ACP enabled, triggering model fetch')
      await this.fetchModels()
      // Send MODEL_LIST_CHANGED event to notify renderer to refresh model list
      logger.info(
        `[ACP] handleEnableStateChange: sending MODEL_LIST_CHANGED event for provider "${this.provider.id}"`
      )
      this.providerSettings.notifyModelsChanged(this.provider.id)
    }
  }

  public async refreshAgents(agentIds?: string[]): Promise<void> {
    const ids = agentIds?.length
      ? Array.from(new Set(agentIds))
      : (await this.agentSettings.getAcpAgents()).map((agent) => agent.id)

    await this.acpRuntimeOwner.refreshAgents(ids)
  }

  public async clearSession(conversationId: string): Promise<void> {
    await this.sessionManager.clearSession(conversationId)
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    const enabled = await this.agentSettings.getAcpEnabled()
    if (!enabled) {
      return {
        isOk: false,
        errorMsg: 'ACP is disabled'
      }
    }
    const agents = await this.agentSettings.getAcpAgents()
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
    maxTokens: number = 4096,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const modelConfig = this.providerSettings.getModelConfig(modelId, this.provider.id)
    const { content, reasoning } = await this.collectFromStream(
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      signal
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
    maxTokens: number = 4096,
    options?: ProviderGenerateTextOptions
  ): Promise<LLMResponse> {
    return this.completions(
      [{ role: 'user', content: prompt }],
      modelId,
      temperature,
      maxTokens,
      options?.signal
    )
  }

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    _temperature: number,
    _maxTokens: number,
    _tools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const signal = options?.signal
    signal?.throwIfAborted()
    const queue = this.createEventQueue()
    let session: AcpSessionRecord | null = null

    try {
      const acpEnabled = await this.agentSettings.getAcpEnabled()
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
          session = await this.acpRuntime.sessionController.open(
            toAppSessionId(conversationKey),
            agent,
            {
              onEvents: (events) => events.forEach((event) => queue.push(event)),
              onPermission: (request) =>
                this.handlePermissionRequest(
                  queue,
                  request,
                  {
                    agent,
                    conversationId: conversationKey
                  },
                  signal
                ),
              signal
            },
            workdir
          )

          const formattedPrompt = this.messageFormatter.format(messages, {
            promptCapabilities: session.promptCapabilities,
            includeSystemPrompt: !session.systemPromptSent
          })
          const activeSession = session
          void this.runPrompt(activeSession, formattedPrompt.blocks, queue, modelConfig, {
            onPromptSucceeded: formattedPrompt.includedSystemPrompt
              ? () => {
                  activeSession.systemPromptSent = true
                }
              : undefined,
            signal
          })
        }
      }
    } catch (error) {
      signal?.throwIfAborted()
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      queue.push(createStreamEvent.error(`ACP: ${message}`, extractProviderFailureMetadata(error)))
      queue.done()
    }

    try {
      while (true) {
        const event = await queue.next()
        if (event === null) break
        yield event
      }
      signal?.throwIfAborted()
    } finally {
      if (session) {
        if (this.promptController.getActiveTurn(session.sessionId)) {
          try {
            await session.connection.cancel({ sessionId: session.sessionId })
          } catch (error) {
            console.warn('[ACP] cancel failed:', error)
          }
        }
        this.acpRuntime.sessionController.clearMappedSession(session.sessionId)
        this.clearPendingPermissionsForSession(session.sessionId)
      }
    }
  }

  public async updateAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    await this.acpRuntime.sessionController.updateWorkdir(
      toAppSessionId(conversationId),
      agentId,
      workdir
    )
  }

  public async warmupProcess(agentId: string, workdir?: string): Promise<void> {
    const agent = await this.getAgentById(agentId)
    if (!agent) return

    const requestedWorkdir = workdir?.trim()
    if (requestedWorkdir && !this.sessionPersistence.isWorkdirUsable(requestedWorkdir)) {
      console.info(
        `[ACP] Skipping warmup for agent ${agentId}: selected workdir "${requestedWorkdir}" is unavailable.`
      )
      return
    }

    try {
      await this.processManager.warmupProcess(agent, workdir)
    } catch (error) {
      console.warn(`[ACP] Failed to warmup ACP process for agent ${agentId}:`, error)
    }
  }

  public getProcessConfigOptions(agentId: string, workdir?: string): AcpConfigState | null {
    return this.processManager.getProcessConfigState(resolveAcpAgentAlias(agentId), workdir) ?? null
  }

  public async runDebugAction(request: AcpDebugRequest): Promise<AcpDebugRunResult> {
    const resolvedAgentId = resolveAcpAgentAlias(request.agentId)
    const agent = (await this.agentSettings.getAcpAgents()).find(
      (item) => item.id === resolvedAgentId
    )
    if (!agent) {
      throw new Error(`[ACP] Agent not found: ${request.agentId}`)
    }
    let handle: AcpProcessHandle
    try {
      handle = await this.processManager.getConnection(agent, request.workdir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('shutting down')) {
        return {
          status: 'error',
          sessionId: undefined,
          error: 'Process manager is shutting down',
          events: []
        }
      }
      throw error
    }
    const connection = handle.connection as AcpConnectionWithDebugLifecycle
    const events: AcpDebugEventEntry[] =
      typeof this.processManager.getDebugEvents === 'function'
        ? [...this.processManager.getDebugEvents(agent.id)]
        : []

    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object' && !Array.isArray(value)

    const pushEvent = (entry: Omit<AcpDebugEventEntry, 'id' | 'timestamp' | 'agentId'>): void => {
      const record: AcpDebugEventEntry = {
        ...entry,
        id: nanoid(),
        timestamp: Date.now(),
        agentId: agent.id
      }
      events.push(record)
      if (request.webContentsId) {
        this.publishEvent('providers.acp.debug.event', {
          webContentsId: request.webContentsId,
          agentId: agent.id,
          event: record,
          version: Date.now()
        })
      }
    }

    let activeSessionId =
      request.sessionId ??
      (isPlainObject(request.payload) && typeof request.payload.sessionId === 'string'
        ? (request.payload.sessionId as string)
        : undefined)

    let disposeNotification: (() => void) | undefined
    let disposePermission: (() => void) | undefined

    const attachSession = (sessionId: string) => {
      if (disposeNotification) {
        disposeNotification()
        disposeNotification = undefined
      }
      if (disposePermission) {
        disposePermission()
        disposePermission = undefined
      }

      disposeNotification = this.processManager.registerSessionListener(
        agent.id,
        sessionId,
        (notification) => {
          pushEvent({
            kind: 'notification',
            action: 'session/update',
            sessionId,
            payload: notification
          })
        }
      )
      disposePermission = this.processManager.registerPermissionResolver(
        agent.id,
        sessionId,
        async (params) => {
          pushEvent({
            kind: 'permission',
            action: 'requestPermission',
            sessionId,
            payload: params
          })
          return { outcome: { outcome: 'cancelled' } }
        }
      )
    }

    const resolveHandleWorkdir = (): string => {
      const handleWorkdir = handle.workdir?.trim()
      if (
        handleWorkdir &&
        (!this.sessionPersistence ||
          typeof this.sessionPersistence.isWorkdirUsable !== 'function' ||
          this.sessionPersistence.isWorkdirUsable(handleWorkdir))
      ) {
        return handleWorkdir
      }
      const requestedWorkdir = request.workdir?.trim()
      if (this.sessionPersistence && typeof this.sessionPersistence.resolveWorkdir === 'function') {
        return this.sessionPersistence.resolveWorkdir(requestedWorkdir)
      }
      return requestedWorkdir || process.cwd()
    }

    const normalizeWorkdir = (workdir?: string | null): string => {
      const fallback = resolveHandleWorkdir()
      const trimmed = workdir?.trim()
      if (!trimmed) {
        return fallback
      }
      if (
        this.sessionPersistence &&
        typeof this.sessionPersistence.isWorkdirUsable === 'function' &&
        !this.sessionPersistence.isWorkdirUsable(trimmed)
      ) {
        return fallback
      }
      if (this.sessionPersistence && typeof this.sessionPersistence.resolveWorkdir === 'function') {
        return this.sessionPersistence.resolveWorkdir(trimmed)
      }
      return trimmed
    }

    const resolveWorkdir = (): string => {
      return resolveHandleWorkdir()
    }

    const resolvePayloadWorkdir = (workdir: unknown): string | undefined => {
      if (typeof workdir !== 'string' || !workdir.trim()) {
        return undefined
      }
      return normalizeWorkdir(workdir)
    }

    const resolveMcpServers = async (): Promise<schema.McpServer[]> => {
      if (typeof this.sessionManager?.resolveMcpServersForAgent !== 'function') {
        return []
      }
      return this.sessionManager.resolveMcpServersForAgent(agent.id, handle.mcpCapabilities)
    }

    try {
      switch (request.action) {
        case 'initialize': {
          pushEvent({
            kind: 'lifecycle',
            action: 'initialize',
            sessionId: activeSessionId,
            message: 'Connection is already initialized by the ACP runtime.',
            payload: this.acpRuntime.toConnectionRef(handle)
          })
          break
        }
        case 'authenticate': {
          if (!connection.authenticate) {
            throw new Error('authenticate is not supported by this SDK connection')
          }
          const methodId =
            isPlainObject(request.payload) && typeof request.payload.methodId === 'string'
              ? request.payload.methodId
              : undefined
          if (!methodId) {
            throw new Error('methodId is required for authenticate')
          }
          const body: schema.AuthenticateRequest = { methodId }
          if (isPlainObject(request.payload?._meta)) {
            body._meta = request.payload._meta
          }
          pushEvent({ kind: 'request', action: 'authenticate', payload: body })
          const response = await connection.authenticate(body)
          pushEvent({
            kind: 'response',
            action: 'authenticate',
            sessionId: activeSessionId,
            payload: response ?? {}
          })
          break
        }
        case 'newSession': {
          const basePayload: schema.NewSessionRequest = {
            cwd: resolveWorkdir(),
            mcpServers: await resolveMcpServers()
          }
          const body = { ...basePayload }
          if (isPlainObject(request.payload)) {
            const payloadWorkdir = resolvePayloadWorkdir(request.payload.cwd)
            if (payloadWorkdir) {
              body.cwd = payloadWorkdir
            }
            if (Array.isArray(request.payload.mcpServers)) {
              body.mcpServers = request.payload.mcpServers as schema.McpServer[]
            }
            if (isPlainObject(request.payload._meta)) {
              body._meta = request.payload._meta
            }
          }
          pushEvent({ kind: 'request', action: 'newSession', payload: body })
          const response = await connection.newSession(body)
          activeSessionId = response.sessionId
          this.processManager.registerSessionWorkdir(activeSessionId, body.cwd)
          attachSession(activeSessionId)
          pushEvent({
            kind: 'response',
            action: 'newSession',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'loadSession': {
          const payloadOverrides = isPlainObject(request.payload) ? request.payload : undefined
          const sessionFromPayload =
            payloadOverrides && typeof payloadOverrides.sessionId === 'string'
              ? payloadOverrides.sessionId
              : undefined
          const sessionToLoad = sessionFromPayload ?? activeSessionId
          if (!sessionToLoad || typeof sessionToLoad !== 'string') {
            throw new Error('Session ID is required for loadSession')
          }
          const body: schema.LoadSessionRequest = {
            cwd: resolveWorkdir(),
            mcpServers: await resolveMcpServers(),
            sessionId: sessionToLoad
          }
          if (payloadOverrides) {
            const payloadWorkdir = resolvePayloadWorkdir(payloadOverrides.cwd)
            if (payloadWorkdir) {
              body.cwd = payloadWorkdir
            }
            if (Array.isArray(payloadOverrides.mcpServers)) {
              body.mcpServers = payloadOverrides.mcpServers as schema.McpServer[]
            }
            if (isPlainObject(payloadOverrides._meta)) {
              body._meta = payloadOverrides._meta
            }
          }
          pushEvent({
            kind: 'request',
            action: 'loadSession',
            sessionId: sessionToLoad,
            payload: body
          })
          this.processManager.registerSessionWorkdir(sessionToLoad, body.cwd)
          attachSession(sessionToLoad)
          const response = await connection.loadSession(body)
          activeSessionId = sessionToLoad
          pushEvent({
            kind: 'response',
            action: 'loadSession',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'sessionList': {
          if (!connection.listSessions) {
            throw new Error('session/list is not supported by this SDK connection')
          }
          if (!handle.supportsSessionList) {
            throw new Error('Agent did not advertise sessionCapabilities.list')
          }
          const payloadOverrides = isPlainObject(request.payload) ? request.payload : undefined
          const body: schema.ListSessionsRequest = {
            cwd: resolveWorkdir()
          }
          if (payloadOverrides) {
            const payloadWorkdir = resolvePayloadWorkdir(payloadOverrides.cwd)
            if (payloadWorkdir) {
              body.cwd = payloadWorkdir
            }
            if (typeof payloadOverrides.cursor === 'string') {
              body.cursor = payloadOverrides.cursor
            }
            if (isPlainObject(payloadOverrides._meta)) {
              body._meta = payloadOverrides._meta
            }
          }
          const shouldSyncRemoteSessions = Boolean(payloadOverrides?.sync)
          const allSessions: schema.SessionInfo[] = []
          let cursor: string | null | undefined = body.cursor
          do {
            const pageBody = { ...body, cursor }
            pushEvent({ kind: 'request', action: 'session/list', payload: pageBody })
            const response = await connection.listSessions(pageBody)
            allSessions.push(...response.sessions)
            cursor = response.nextCursor
            pushEvent({
              kind: 'response',
              action: 'session/list',
              payload: response
            })
          } while (cursor)
          pushEvent({
            kind: 'lifecycle',
            action: 'session/list.complete',
            payload: { count: allSessions.length }
          })
          if (shouldSyncRemoteSessions) {
            const syncResult = await this.sessionPersistence.syncRemoteSessions({
              agentId: agent.id,
              agentName: agent.name,
              providerId: this.provider.id,
              workdir: body.cwd ?? resolveWorkdir(),
              sessions: allSessions
            })
            pushEvent({
              kind: 'lifecycle',
              action: 'session/list.sync',
              payload: syncResult
            })
          }
          break
        }
        case 'sessionResume': {
          if (!connection.unstable_resumeSession) {
            throw new Error('session/resume is not supported by this SDK connection')
          }
          if (!handle.supportsSessionResume) {
            throw new Error('Agent did not advertise sessionCapabilities.resume')
          }
          const payloadOverrides = isPlainObject(request.payload) ? request.payload : undefined
          const sessionToResume =
            payloadOverrides && typeof payloadOverrides.sessionId === 'string'
              ? payloadOverrides.sessionId
              : activeSessionId
          if (!sessionToResume) {
            throw new Error('sessionId is required for sessionResume')
          }
          const body: schema.ResumeSessionRequest = {
            cwd: resolveWorkdir(),
            mcpServers: await resolveMcpServers(),
            sessionId: sessionToResume
          }
          if (payloadOverrides) {
            const payloadWorkdir = resolvePayloadWorkdir(payloadOverrides.cwd)
            if (payloadWorkdir) {
              body.cwd = payloadWorkdir
            }
            if (Array.isArray(payloadOverrides.mcpServers)) {
              body.mcpServers = payloadOverrides.mcpServers as schema.McpServer[]
            }
            if (isPlainObject(payloadOverrides._meta)) {
              body._meta = payloadOverrides._meta
            }
          }
          pushEvent({
            kind: 'request',
            action: 'session/resume',
            sessionId: sessionToResume,
            payload: body
          })
          this.processManager.registerSessionWorkdir(sessionToResume, body.cwd)
          attachSession(sessionToResume)
          const response = await connection.unstable_resumeSession(body)
          activeSessionId = sessionToResume
          pushEvent({
            kind: 'response',
            action: 'session/resume',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'sessionClose': {
          if (!connection.unstable_closeSession) {
            throw new Error('session/close is not supported by this SDK connection')
          }
          if (!handle.supportsSessionClose) {
            throw new Error('Agent did not advertise sessionCapabilities.close')
          }
          const payloadOverrides = isPlainObject(request.payload) ? request.payload : undefined
          const sessionToClose =
            payloadOverrides && typeof payloadOverrides.sessionId === 'string'
              ? payloadOverrides.sessionId
              : activeSessionId
          if (!sessionToClose) {
            throw new Error('sessionId is required for sessionClose')
          }
          const body: schema.CloseSessionRequest = { sessionId: sessionToClose }
          if (payloadOverrides && isPlainObject(payloadOverrides._meta)) {
            body._meta = payloadOverrides._meta
          }
          pushEvent({
            kind: 'request',
            action: 'session/close',
            sessionId: sessionToClose,
            payload: body
          })
          const response = await connection.unstable_closeSession(body)
          this.processManager.clearSession(sessionToClose)
          activeSessionId = undefined
          pushEvent({
            kind: 'response',
            action: 'session/close',
            sessionId: sessionToClose,
            payload: response
          })
          break
        }
        case 'sessionFork': {
          if (!connection.unstable_forkSession) {
            throw new Error('session/fork is not supported by this SDK connection')
          }
          if (!handle.supportsSessionFork) {
            throw new Error('Agent did not advertise sessionCapabilities.fork')
          }
          const payloadOverrides = isPlainObject(request.payload) ? request.payload : undefined
          const sessionToFork =
            payloadOverrides && typeof payloadOverrides.sessionId === 'string'
              ? payloadOverrides.sessionId
              : activeSessionId
          if (!sessionToFork) {
            throw new Error('sessionId is required for sessionFork')
          }
          const body: schema.ForkSessionRequest = {
            cwd: resolveWorkdir(),
            mcpServers: await resolveMcpServers(),
            sessionId: sessionToFork
          }
          if (payloadOverrides) {
            const payloadWorkdir = resolvePayloadWorkdir(payloadOverrides.cwd)
            if (payloadWorkdir) {
              body.cwd = payloadWorkdir
            }
            if (Array.isArray(payloadOverrides.mcpServers)) {
              body.mcpServers = payloadOverrides.mcpServers as schema.McpServer[]
            }
          }
          if (payloadOverrides && isPlainObject(payloadOverrides._meta)) {
            body._meta = payloadOverrides._meta
          }
          pushEvent({
            kind: 'request',
            action: 'session/fork',
            sessionId: sessionToFork,
            payload: body
          })
          const response = await connection.unstable_forkSession(body)
          activeSessionId = response.sessionId
          this.processManager.registerSessionWorkdir(activeSessionId, body.cwd)
          attachSession(activeSessionId)
          pushEvent({
            kind: 'response',
            action: 'session/fork',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'prompt': {
          if (!activeSessionId) {
            throw new Error('Session ID is required for prompt')
          }
          const body = isPlainObject(request.payload)
            ? { ...request.payload, sessionId: activeSessionId }
            : { sessionId: activeSessionId, prompt: [] }
          pushEvent({
            kind: 'request',
            action: 'prompt',
            sessionId: activeSessionId,
            payload: body
          })
          attachSession(activeSessionId)
          const response = await connection.prompt(body as schema.PromptRequest)
          pushEvent({
            kind: 'response',
            action: 'prompt',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'cancel': {
          if (!activeSessionId) {
            throw new Error('Session ID is required for cancel')
          }
          const body = isPlainObject(request.payload)
            ? { ...request.payload, sessionId: activeSessionId }
            : { sessionId: activeSessionId }
          pushEvent({
            kind: 'request',
            action: 'cancel',
            sessionId: activeSessionId,
            payload: body
          })
          attachSession(activeSessionId)
          await connection.cancel(body as schema.CancelNotification)
          pushEvent({
            kind: 'response',
            action: 'cancel',
            sessionId: activeSessionId,
            payload: { ok: true }
          })
          break
        }
        case 'setSessionMode': {
          if (!activeSessionId) {
            throw new Error('Session ID is required for setSessionMode')
          }
          const body = isPlainObject(request.payload)
            ? { ...request.payload, sessionId: activeSessionId }
            : { sessionId: activeSessionId, modeId: 'default' }
          pushEvent({
            kind: 'request',
            action: 'setSessionMode',
            sessionId: activeSessionId,
            payload: body
          })
          attachSession(activeSessionId)
          const response = await connection.setSessionMode(body as schema.SetSessionModeRequest)
          pushEvent({
            kind: 'response',
            action: 'setSessionMode',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'setSessionModel': {
          if (!activeSessionId) {
            throw new Error('Session ID is required for setSessionModel')
          }
          const body = isPlainObject(request.payload)
            ? { ...request.payload, sessionId: activeSessionId }
            : { sessionId: activeSessionId }
          pushEvent({
            kind: 'request',
            action: 'setSessionModel',
            sessionId: activeSessionId,
            payload: body
          })
          attachSession(activeSessionId)
          const response = await setSessionModelCompat(
            connection,
            body as schema.SetSessionModelRequest
          )
          pushEvent({
            kind: 'response',
            action: 'setSessionModel',
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'extMethod': {
          const method = request.methodName?.trim()
          if (!method) {
            throw new Error('Custom method name is required for extMethod')
          }
          const body = isPlainObject(request.payload) ? request.payload : {}
          pushEvent({ kind: 'request', action: `ext:${method}`, payload: body })
          const response = await connection.extMethod(method, body)
          pushEvent({
            kind: 'response',
            action: `ext:${method}`,
            sessionId: activeSessionId,
            payload: response
          })
          break
        }
        case 'extNotification': {
          const method = request.methodName?.trim()
          if (!method) {
            throw new Error('Custom method name is required for extNotification')
          }
          const body = isPlainObject(request.payload) ? request.payload : {}
          pushEvent({ kind: 'request', action: `ext:${method}`, payload: body })
          await connection.extNotification(method, body)
          pushEvent({
            kind: 'response',
            action: `ext:${method}`,
            sessionId: activeSessionId,
            payload: { ok: true }
          })
          break
        }
        default:
          throw new Error(`Unsupported ACP debug action: ${request.action}`)
      }

      return {
        status: 'ok',
        sessionId: activeSessionId,
        events
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      pushEvent({
        kind: 'error',
        action: request.action,
        sessionId: activeSessionId,
        message,
        payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
      })
      return {
        status: 'error',
        sessionId: activeSessionId,
        error: message,
        events
      }
    } finally {
      disposeNotification?.()
      disposePermission?.()
    }
  }

  private async persistTurnStart(input: AcpTurnStartPayload): Promise<void> {
    try {
      await this.sessionPersistence.startTurn(input)
    } catch (error) {
      console.warn('[ACP] Failed to persist turn start:', error)
    }
  }

  private async persistTurnFinish(input: AcpTurnFinishPayload): Promise<void> {
    try {
      await this.sessionPersistence.finishTurn(input)
    } catch (error) {
      console.warn('[ACP] Failed to persist turn finish:', error)
    }
  }

  private async runPrompt(
    session: AcpSessionRecord,
    prompt: schema.ContentBlock[],
    queue: EventQueue,
    modelConfig: ModelConfig,
    options: RunPromptOptions = {}
  ): Promise<void> {
    const timeoutMs = this.resolveModelRequestTimeout(modelConfig)
    let requestSignal: AbortSignal | undefined
    let disposeRequestSignal = () => {}
    const conversationId = modelConfig.conversationId ?? session.conversationId
    let turnStarted = false
    let turnId: string | null = null
    let promptRequest: Promise<schema.PromptResponse> | undefined

    try {
      options.signal?.throwIfAborted()
      const turn = this.promptController.begin({
        sessionId: session.sessionId,
        conversationId
      })
      turnId = turn.id
      turnStarted = true
      await this.persistTurnStart({
        id: turn.id,
        acpSessionId: session.sessionId,
        conversationId,
        userMessageId: turn.userMessageId,
        startedAt: turn.startedAt
      })
      const requestBody = {
        sessionId: session.sessionId,
        prompt
      }
      const promptSummary = {
        sessionId: session.sessionId,
        conversationId,
        agentId: session.agentId,
        turnId: turn.id,
        blockCount: prompt.length,
        blocks: summarizePromptBlocks(prompt),
        timeoutMs
      }
      console.info(`[ACP] Sending prompt to ACP session ${session.sessionId}:`, promptSummary)
      this.processManager?.appendDebugEvent?.(session.agentId, {
        kind: 'request',
        action: 'session/prompt',
        sessionId: session.sessionId,
        payload: promptSummary
      })
      await this.emitRequestTrace(modelConfig, {
        endpoint: 'acp://session/prompt',
        headers: {},
        body: requestBody
      })

      const requestCancellation = this.createModelRequestSignal(modelConfig, options.signal)
      requestSignal = requestCancellation.signal
      disposeRequestSignal = requestCancellation.dispose
      requestSignal?.throwIfAborted()

      promptRequest = session.connection.prompt({
        sessionId: requestBody.sessionId,
        prompt: requestBody.prompt
      })
      const response = await awaitWithAbort(promptRequest, requestSignal)
      options.onPromptSucceeded?.()
      const responseSummary = {
        sessionId: session.sessionId,
        conversationId,
        agentId: session.agentId,
        turnId: turn.id,
        stopReason: response.stopReason,
        keys: Object.keys(response as Record<string, unknown>)
      }
      console.info(`[ACP] Prompt completed for ACP session ${session.sessionId}:`, responseSummary)
      this.processManager?.appendDebugEvent?.(session.agentId, {
        kind: 'response',
        action: 'session/prompt',
        sessionId: session.sessionId,
        payload: responseSummary
      })
      const completedTurn = this.promptController.complete(session.sessionId, response.stopReason)
      if (completedTurn) {
        await this.persistTurnFinish({
          id: completedTurn.id,
          status: 'completed',
          stopReason: response.stopReason,
          completedAt: completedTurn.completedAt ?? Date.now()
        })
      }
      createAcpPromptTerminalEvents(response.stopReason).forEach((event) => queue.push(event))
    } catch (error) {
      const callerCancelled =
        options.signal?.aborted === true &&
        error === options.signal.reason &&
        (!requestSignal || requestSignal.reason === options.signal.reason)
      const requestCancelled = requestSignal?.aborted === true && error === requestSignal.reason

      if (requestCancelled || callerCancelled) {
        disposeRequestSignal()
        disposeRequestSignal = () => {}
        this.clearPendingPermissionsForSession(session.sessionId)

        if (promptRequest) {
          const cancelRequest = Promise.resolve().then(() =>
            session.connection.cancel({ sessionId: session.sessionId })
          )
          const [cancelResult, promptResult] = await Promise.allSettled([
            cancelRequest,
            promptRequest
          ])
          if (cancelResult.status === 'rejected') {
            console.warn('[ACP] cancel after request abort failed:', cancelResult.reason)
          }
          if (promptResult.status === 'rejected') {
            console.info('[ACP] Prompt settled after cancellation:', promptResult.reason)
          }
        }
      }

      if (turnStarted) {
        const settledTurn = callerCancelled
          ? this.promptController.cancel(session.sessionId)
          : this.promptController.fail(session.sessionId)
        if (settledTurn) {
          await this.persistTurnFinish({
            id: settledTurn.id,
            status: callerCancelled ? 'cancelled' : 'error',
            stopReason: callerCancelled ? 'cancelled' : 'error',
            completedAt: settledTurn.completedAt ?? Date.now()
          })
        } else if (turnId) {
          await this.persistTurnFinish({
            id: turnId,
            status: callerCancelled ? 'cancelled' : 'error',
            stopReason: callerCancelled ? 'cancelled' : 'error',
            completedAt: Date.now()
          })
        }
      }

      if (callerCancelled) return

      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      console.error(`[ACP] Prompt failed for ACP session ${session.sessionId}:`, error)
      this.processManager?.appendDebugEvent?.(session.agentId, {
        kind: 'error',
        action: 'session/prompt',
        sessionId: session.sessionId,
        message,
        payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
      })
      queue.push(createStreamEvent.error(`ACP: ${message}`, extractProviderFailureMetadata(error)))
    } finally {
      disposeRequestSignal()
      queue.done()
    }
  }

  private async handlePermissionRequest(
    queue: EventQueue,
    params: schema.RequestPermissionRequest,
    context: PermissionRequestContext,
    signal?: AbortSignal
  ): Promise<schema.RequestPermissionResponse> {
    if (signal?.aborted) {
      return { outcome: { outcome: 'cancelled' } }
    }

    const { requestId, promise } = this.registerPendingPermission(params, context)
    const onAbort = () => {
      this.removePendingPermission(requestId)?.resolve({ outcome: { outcome: 'cancelled' } })
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }

    if (!this.pendingPermissions.has(requestId)) {
      signal?.removeEventListener('abort', onAbort)
      return await promise
    }

    const toolLabel = params.toolCall.title ?? params.toolCall.toolCallId
    queue.push(
      createStreamEvent.reasoning(
        `ACP agent "${context.agent.name}" requests permission: ${toolLabel}`
      )
    )
    queue.push(
      createStreamEvent.permission(this.buildPermissionPayload(params, context, requestId))
    )

    try {
      return await promise
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private registerPendingPermission(
    params: schema.RequestPermissionRequest,
    context: PermissionRequestContext
  ): { requestId: string; promise: Promise<schema.RequestPermissionResponse> } {
    const requestId = nanoid()

    const promise = new Promise<schema.RequestPermissionResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const state = this.removePendingPermission(requestId)
        if (!state) {
          return
        }
        console.warn(`[ACP] Permission request timed out: ${requestId}`)
        state.resolve({ outcome: { outcome: 'cancelled' } })
      }, ACP_PERMISSION_TIMEOUT_MS)

      this.pendingPermissions.set(requestId, {
        requestId,
        sessionId: params.sessionId,
        params,
        context,
        resolve,
        reject,
        timeoutId
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
    const command = this.extractCommand(params.toolCall)
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
      ...(command ? { command } : {}),
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

  private extractCommand(
    toolCall: schema.RequestPermissionRequest['toolCall']
  ): string | undefined {
    const rawInput = toolCall.rawInput
    if (!rawInput || typeof rawInput !== 'object') {
      return undefined
    }

    const command = (rawInput as Record<string, unknown>).command
    if (typeof command !== 'string' || !command.trim()) {
      return undefined
    }

    return command.trim()
  }

  private mapPermissionType(kind?: schema.ToolKind | null): 'read' | 'write' | 'all' | 'command' {
    switch (kind) {
      case 'read':
      case 'fetch':
      case 'search':
        return 'read'
      case 'edit':
      case 'delete':
      case 'move':
        return 'write'
      case 'execute':
        return 'command'
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
    const state = this.removePendingPermission(requestId)
    if (!state) {
      throw new Error(`Unknown ACP permission request: ${requestId}`)
    }

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

  private removePendingPermission(requestId: string): PendingPermissionState | undefined {
    const state = this.pendingPermissions.get(requestId)
    if (!state) {
      return undefined
    }
    this.pendingPermissions.delete(requestId)
    clearTimeout(state.timeoutId)
    return state
  }

  private clearPendingPermissionsForSession(sessionId: string): void {
    for (const [requestId, state] of this.pendingPermissions.entries()) {
      if (state.sessionId === sessionId) {
        this.removePendingPermission(requestId)?.resolve({ outcome: { outcome: 'cancelled' } })
      }
    }
  }

  private async collectFromStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    signal?: AbortSignal
  ): Promise<{ content: string; reasoning: string }> {
    const mergedConfig: ModelConfig = {
      ...modelConfig,
      temperature: temperature ?? modelConfig.temperature,
      maxTokens: maxTokens ?? modelConfig.maxTokens
    }
    const conversationKey = mergedConfig.conversationId ?? modelId

    return await this.runStandaloneRequest(conversationKey, signal, async () => {
      let content = ''
      let reasoning = ''
      for await (const chunk of this.coreStream(
        messages,
        modelId,
        mergedConfig,
        temperature,
        maxTokens,
        [],
        { signal }
      )) {
        logger.info('[ACP] collectFromStream: chunk:', chunk)
        if (chunk.type === 'text' && chunk.content) {
          content += chunk.content
        } else if (chunk.type === 'reasoning' && chunk.reasoning_content) {
          reasoning += chunk.reasoning_content
        }
      }
      signal?.throwIfAborted()
      return { content, reasoning }
    })
  }

  private runStandaloneRequest<T>(
    conversationKey: string,
    signal: AbortSignal | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    signal?.throwIfAborted()
    const queues = (this.standaloneRequestQueues ??= new Map())
    const queue = queues.get(conversationKey) ?? { active: false, pending: [] }
    queues.set(conversationKey, queue)

    return new Promise<T>((resolve, reject) => {
      const request: StandaloneRequest = {
        started: false,
        signal,
        run,
        resolve: (value) => resolve(value as T),
        reject
      }

      if (signal) {
        const onAbort = () => {
          if (request.started) return
          const pendingIndex = queue.pending.indexOf(request)
          if (pendingIndex < 0) return
          queue.pending.splice(pendingIndex, 1)
          request.detachAbort?.()
          request.reject(signal.reason)
          this.deleteStandaloneQueueIfIdle(conversationKey, queue)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        request.detachAbort = () => signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          request.detachAbort()
          reject(signal.reason)
          this.deleteStandaloneQueueIfIdle(conversationKey, queue)
          return
        }
      }

      queue.pending.push(request)
      this.startNextStandaloneRequest(conversationKey, queue)
    })
  }

  private startNextStandaloneRequest(conversationKey: string, queue: StandaloneRequestQueue): void {
    if (queue.active) return

    while (queue.pending.length > 0) {
      const request = queue.pending.shift()!
      request.detachAbort?.()
      if (request.signal?.aborted) {
        request.reject(request.signal.reason)
        continue
      }

      request.started = true
      queue.active = true
      void Promise.resolve()
        .then(request.run)
        .then(request.resolve, request.reject)
        .finally(() => {
          queue.active = false
          this.startNextStandaloneRequest(conversationKey, queue)
        })
      return
    }

    this.deleteStandaloneQueueIfIdle(conversationKey, queue)
  }

  private deleteStandaloneQueueIfIdle(
    conversationKey: string,
    queue: StandaloneRequestQueue
  ): void {
    if (queue.active || queue.pending.length > 0) return
    if (this.standaloneRequestQueues?.get(conversationKey) === queue) {
      this.standaloneRequestQueues.delete(conversationKey)
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
    const agents = await this.agentSettings.getAcpAgents()
    const resolvedId = resolveAcpAgentAlias(agentId)
    return agents.find((agent) => agent.id === resolvedId) ?? null
  }

  private async initWhenEnabled(): Promise<void> {
    const enabled = await this.agentSettings.getAcpEnabled()
    if (!enabled) return
    // Call this.init() instead of super.init() to use the overridden method
    await this.init()
  }

  async getSessionConfigOptions(conversationId: string): Promise<AcpConfigState | null> {
    return this.acpRuntime.sessionController.getConfigOptions(toAppSessionId(conversationId))
  }

  async setSessionConfigOption(
    conversationId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    return await this.acpRuntime.sessionController.setConfigOption(
      toAppSessionId(conversationId),
      configId,
      value
    )
  }

  async getSessionCommands(conversationId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    return this.acpRuntime.sessionController.getCommands(toAppSessionId(conversationId))
  }

  async cleanup(): Promise<void> {
    logger.info('[ACP] Cleanup: detaching compatibility provider state')
    for (const [requestId] of this.pendingPermissions.entries()) {
      this.removePendingPermission(requestId)?.resolve({ outcome: { outcome: 'cancelled' } })
    }
  }
}
