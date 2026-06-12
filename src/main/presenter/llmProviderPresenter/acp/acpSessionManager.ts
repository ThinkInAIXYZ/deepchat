import { app } from 'electron'
import type { AcpAgentConfig, AcpConfigState, IConfigPresenter } from '@shared/presenter'
import type { AgentSessionState } from './types'
import type {
  AcpProcessManager,
  AcpProcessHandle,
  PermissionResolver,
  SessionNotificationHandler
} from './acpProcessManager'
import type { ClientSideConnection as ClientSideConnectionType } from '@agentclientprotocol/sdk'
import { AcpSessionPersistence } from './acpSessionPersistence'
import { convertMcpConfigToAcpFormat } from './mcpConfigConverter'
import { filterMcpServersByTransportSupport } from './mcpTransportFilter'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import {
  createEmptyAcpConfigState,
  getAcpConfigOptionByCategory,
  getLegacyModeState,
  hasAcpConfigStateData,
  normalizeAcpConfigState,
  updateAcpConfigStateValue
} from './acpConfigState'

interface AcpSessionManagerOptions {
  providerId: string
  processManager: AcpProcessManager
  sessionPersistence: AcpSessionPersistence
  configPresenter: IConfigPresenter
}

interface SessionHooks {
  onSessionUpdate: SessionNotificationHandler
  onPermission: PermissionResolver
}

type AcpConnectionWithUnstableSessionLifecycle = ClientSideConnectionType & {
  unstable_resumeSession?: (
    params: schema.ResumeSessionRequest
  ) => Promise<schema.ResumeSessionResponse>
  unstable_closeSession?: (
    params: schema.CloseSessionRequest
  ) => Promise<schema.CloseSessionResponse>
  unstable_forkSession?: (params: schema.ForkSessionRequest) => Promise<schema.ForkSessionResponse>
}

const summarizeMcpServers = (mcpServers: schema.McpServer[]) =>
  mcpServers.map((server) => {
    const record = server as Record<string, unknown>
    return {
      name: typeof record.name === 'string' ? record.name : 'unknown',
      type: typeof record.type === 'string' ? record.type : 'stdio'
    }
  })

const summarizeSessionResponse = (
  response: schema.LoadSessionResponse | schema.NewSessionResponse | schema.ResumeSessionResponse
) => ({
  sessionId: 'sessionId' in response ? response.sessionId : undefined,
  keys: Object.keys(response as Record<string, unknown>),
  configOptionCount: response.configOptions?.length ?? 0,
  modelCount: response.models?.availableModels?.length ?? 0,
  currentModelId: response.models?.currentModelId,
  modeCount: response.modes?.availableModes?.length ?? 0,
  currentModeId: response.modes?.currentModeId
})

export interface AcpSessionRecord extends AgentSessionState {
  connection: ClientSideConnectionType
  detachHandlers: Array<() => void>
  workdir: string
  configState?: AcpConfigState
  promptCapabilities?: schema.PromptCapabilities
  systemPromptSent?: boolean
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  availableCommands?: Array<{
    name: string
    description: string
    input?: { hint: string } | null
  }>
}

export class AcpSessionManager {
  private readonly providerId: string
  private readonly processManager: AcpProcessManager
  private readonly sessionPersistence: AcpSessionPersistence
  private readonly configPresenter: IConfigPresenter
  private readonly sessionsByConversation = new Map<string, AcpSessionRecord>()
  private readonly sessionsById = new Map<string, AcpSessionRecord>()
  private readonly pendingSessions = new Map<string, Promise<AcpSessionRecord>>()

  constructor(options: AcpSessionManagerOptions) {
    this.providerId = options.providerId
    this.processManager = options.processManager
    this.sessionPersistence = options.sessionPersistence
    this.configPresenter = options.configPresenter

    app.on('before-quit', () => {
      void this.clearAllSessions()
    })
  }

  async getOrCreateSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks,
    workdir?: string | null
  ): Promise<AcpSessionRecord> {
    const resolvedWorkdir = this.sessionPersistence.resolveWorkdir(workdir)
    const existing = this.sessionsByConversation.get(conversationId)
    if (existing && existing.agentId === agent.id && existing.workdir === resolvedWorkdir) {
      // Reuse existing session, but update hooks for new conversation turn
      // Clean up old handlers
      existing.detachHandlers.forEach((dispose) => {
        try {
          dispose()
        } catch (error) {
          console.warn('[ACP] Failed to dispose old session handler:', error)
        }
      })
      // Register new handlers
      existing.detachHandlers = this.attachSessionHooks(agent.id, existing.sessionId, hooks)
      existing.workdir = resolvedWorkdir
      return existing
    }
    if (existing) {
      await this.clearSession(conversationId)
    }

    const inflight = this.pendingSessions.get(conversationId)
    if (inflight) {
      return inflight
    }

    const createPromise = this.createSession(conversationId, agent, hooks, resolvedWorkdir)
    this.pendingSessions.set(conversationId, createPromise)
    try {
      const session = await createPromise
      this.sessionsByConversation.set(conversationId, session)
      this.sessionsById.set(session.sessionId, session)
      return session
    } finally {
      this.pendingSessions.delete(conversationId)
    }
  }

  getSession(conversationId: string): AcpSessionRecord | null {
    return this.sessionsByConversation.get(conversationId) ?? null
  }

  getSessionById(sessionId: string): AcpSessionRecord | null {
    return this.sessionsById.get(sessionId) ?? null
  }

  listSessions(): AcpSessionRecord[] {
    return Array.from(this.sessionsByConversation.values())
  }

  async clearSessionsByAgent(agentId: string): Promise<void> {
    const targets = Array.from(this.sessionsByConversation.entries()).filter(
      ([, session]) => session.agentId === agentId
    )
    await Promise.allSettled(targets.map(([conversationId]) => this.clearSession(conversationId)))
  }

  async clearSession(conversationId: string): Promise<void> {
    const session = this.sessionsByConversation.get(conversationId)
    if (!session) return

    this.sessionsByConversation.delete(conversationId)
    this.sessionsById.delete(session.sessionId)
    session.detachHandlers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[ACP] Failed to dispose session handler:', error)
      }
    })

    this.processManager.clearSession(session.sessionId)

    try {
      await this.processManager.unbindProcess(session.agentId, conversationId)
    } catch (error) {
      console.warn(
        `[ACP] Failed to unbind process for conversation ${conversationId} (agent ${session.agentId}):`,
        error
      )
    }

    await this.sessionPersistence.clearSession(conversationId, session.agentId)
  }

  async clearAllSessions(): Promise<void> {
    const clears = Array.from(this.sessionsByConversation.keys()).map((conversationId) =>
      this.clearSession(conversationId)
    )
    await Promise.allSettled(clears)
    this.sessionsByConversation.clear()
    this.sessionsById.clear()
    this.pendingSessions.clear()
  }

  private async createSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks,
    workdir: string
  ): Promise<AcpSessionRecord> {
    // Pass workdir to process manager so the process runs in the correct directory
    let handle: AcpProcessHandle
    try {
      handle = await this.processManager.getConnection(agent, workdir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('shutting down')) {
        throw new Error('[ACP] Cannot create session: process manager is shutting down')
      }
      throw error
    }
    this.processManager.bindProcess(agent.id, conversationId, workdir)

    const session = await this.initializeSession(
      handle,
      conversationId,
      agent,
      workdir,
      hooks
    ).catch(async (error) => {
      const initError = error
      try {
        await this.processManager.unbindProcess(agent.id, conversationId)
      } catch (cleanupError) {
        console.warn(
          '[ACP] Failed to unbind process after session initialization error:',
          cleanupError
        )
      }
      throw initError
    })
    const detachListeners =
      session.detachHandlers ?? this.attachSessionHooks(agent.id, session.sessionId, hooks)

    // Register session workdir for fs/terminal operations
    this.processManager.registerSessionWorkdir(session.sessionId, workdir, conversationId)

    void this.sessionPersistence
      .saveSessionData(conversationId, agent.id, session.sessionId, workdir, 'active', {
        agentName: agent.name
      })
      .catch((error) => {
        console.warn('[ACP] Failed to persist session metadata:', error)
      })

    let configState =
      session.configState ?? handle.configState ?? createEmptyAcpConfigState('legacy')
    const legacyModeState = getLegacyModeState(configState)
    const availableModes =
      session.availableModes ?? legacyModeState?.availableModes ?? handle.availableModes
    // Prefer handle.currentModeId (which may contain preferredMode from warmup) over session default
    let currentModeId =
      handle.currentModeId ?? session.currentModeId ?? legacyModeState?.currentModeId
    handle.configState = configState
    handle.availableModes = availableModes
    handle.currentModeId = currentModeId

    // Apply preferred mode to session if it differs from session default and is valid
    if (
      availableModes?.length &&
      currentModeId &&
      currentModeId !== session.currentModeId &&
      availableModes.some((mode) => mode.id === currentModeId)
    ) {
      try {
        await handle.connection.setSessionMode({
          sessionId: session.sessionId,
          modeId: currentModeId
        })
        const modeOption = getAcpConfigOptionByCategory(configState, 'mode')
        if (modeOption?.type === 'select') {
          configState =
            updateAcpConfigStateValue(configState, modeOption.id, currentModeId) ?? configState
          handle.configState = configState
        }
        console.info(
          `[ACP] Applied preferred mode "${currentModeId}" to session ${session.sessionId} for conversation ${conversationId}`
        )
      } catch (error) {
        console.warn(
          `[ACP] Failed to apply preferred mode "${currentModeId}" for conversation ${conversationId}:`,
          error
        )
        // Fallback to session default mode if preferred mode application fails
        currentModeId = session.currentModeId ?? currentModeId
      }
    }

    return {
      ...session,
      providerId: this.providerId,
      agentId: agent.id,
      conversationId,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: { agentName: agent.name },
      connection: handle.connection,
      detachHandlers: detachListeners,
      workdir,
      configState,
      availableModes,
      currentModeId,
      promptCapabilities: handle.promptCapabilities
    }
  }

  private attachSessionHooks(
    agentId: string,
    sessionId: string,
    hooks: SessionHooks
  ): Array<() => void> {
    const detachUpdate = this.processManager.registerSessionListener(
      agentId,
      sessionId,
      hooks.onSessionUpdate
    )
    const detachPermission = this.processManager.registerPermissionResolver(
      agentId,
      sessionId,
      hooks.onPermission
    )
    return [detachUpdate, detachPermission]
  }

  private async initializeSession(
    handle: AcpProcessHandle,
    conversationId: string,
    agent: AcpAgentConfig,
    workdir: string,
    hooks: SessionHooks
  ): Promise<{
    sessionId: string
    configState: AcpConfigState
    promptCapabilities?: schema.PromptCapabilities
    availableModes?: Array<{ id: string; name: string; description: string }>
    currentModeId?: string
    detachHandlers?: Array<() => void>
  }> {
    try {
      const mcpServers = await this.resolveMcpServersForAgent(agent.id, handle.mcpCapabilities)

      const persistedSession = await this.sessionPersistence.getSessionData(
        conversationId,
        agent.id
      )
      const persistedSessionId = persistedSession?.sessionId?.trim() || null

      let sessionId = ''
      let configState = handle.configState ?? createEmptyAcpConfigState('legacy')
      let detachHandlers: Array<() => void> | undefined
      let responseModeState:
        | {
            availableModes?: Array<{ id: string; name: string; description?: string | null }>
            currentModeId?: string
          }
        | undefined
      let sessionResponse:
        | schema.LoadSessionResponse
        | schema.NewSessionResponse
        | schema.ResumeSessionResponse
        | undefined

      const connection = handle.connection as AcpConnectionWithUnstableSessionLifecycle
      const canResumeSession = Boolean(
        handle.supportsSessionResume && connection.unstable_resumeSession
      )
      const canLoadSession = Boolean(handle.supportsLoadSession)
      console.info(`[ACP] Initializing ACP session for agent ${agent.id}:`, {
        conversationId,
        workdir,
        canResumeSession,
        canLoadSession,
        persistedSessionId,
        mcpServerCount: mcpServers.length
      })
      if (canResumeSession && persistedSessionId) {
        try {
          const resumeRequestSummary = {
            cwd: workdir,
            sessionId: persistedSessionId,
            mcpServerCount: mcpServers.length,
            mcpServers: summarizeMcpServers(mcpServers)
          }
          console.info(
            `[ACP] Resuming persisted ACP session ${persistedSessionId} for conversation ${conversationId}`,
            resumeRequestSummary
          )
          this.processManager.appendDebugEvent?.(agent.id, {
            kind: 'request',
            action: 'session/resume',
            sessionId: persistedSessionId,
            payload: resumeRequestSummary
          })
          this.processManager.registerSessionWorkdir(persistedSessionId, workdir, conversationId)
          detachHandlers = this.attachSessionHooks(agent.id, persistedSessionId, hooks)
          const resumeResponse = await connection.unstable_resumeSession!({
            cwd: workdir,
            mcpServers,
            sessionId: persistedSessionId
          })
          sessionId = persistedSessionId
          sessionResponse = resumeResponse
          responseModeState = resumeResponse.modes ?? undefined
          const resumedConfigState = normalizeAcpConfigState({
            configOptions: resumeResponse.configOptions,
            models: resumeResponse.models,
            modes: resumeResponse.modes
          })
          if (hasAcpConfigStateData(resumedConfigState)) {
            configState = resumedConfigState
          }
          console.info(
            `[ACP] Resumed persisted session ${sessionId} for conversation ${conversationId} (agent ${agent.id})`
          )
          this.processManager.appendDebugEvent?.(agent.id, {
            kind: 'response',
            action: 'session/resume',
            sessionId,
            payload: summarizeSessionResponse(resumeResponse)
          })
        } catch (error) {
          detachHandlers?.forEach((dispose) => {
            try {
              dispose()
            } catch (disposeError) {
              console.warn('[ACP] Failed to detach resumed session handler:', disposeError)
            }
          })
          detachHandlers = undefined
          this.processManager.clearSession(persistedSessionId)
          console.warn(
            `[ACP] Failed to resume persisted session ${persistedSessionId} for conversation ${conversationId}; trying load/new fallback.`,
            error
          )
          this.processManager.appendDebugEvent?.(agent.id, {
            kind: 'error',
            action: 'session/resume',
            sessionId: persistedSessionId,
            message: error instanceof Error ? error.message : String(error),
            payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
          })
        }
      }

      if (!sessionId && canLoadSession && persistedSessionId) {
        try {
          const loadRequestSummary = {
            cwd: workdir,
            sessionId: persistedSessionId,
            mcpServerCount: mcpServers.length,
            mcpServers: summarizeMcpServers(mcpServers)
          }
          console.info(
            `[ACP] Loading persisted ACP session ${persistedSessionId} for conversation ${conversationId}`,
            loadRequestSummary
          )
          this.processManager.appendDebugEvent?.(agent.id, {
            kind: 'request',
            action: 'session/load',
            sessionId: persistedSessionId,
            payload: loadRequestSummary
          })
          this.processManager.registerSessionWorkdir(persistedSessionId, workdir, conversationId)
          detachHandlers = this.attachSessionHooks(agent.id, persistedSessionId, hooks)
          const loadResponse = await handle.connection.loadSession({
            cwd: workdir,
            mcpServers,
            sessionId: persistedSessionId
          })
          sessionId = persistedSessionId
          sessionResponse = loadResponse
          responseModeState = loadResponse.modes ?? undefined
          const loadedConfigState = normalizeAcpConfigState({
            configOptions: loadResponse.configOptions,
            models: loadResponse.models,
            modes: loadResponse.modes
          })
          if (hasAcpConfigStateData(loadedConfigState)) {
            configState = loadedConfigState
          }
          console.info(
            `[ACP] Loaded persisted session ${sessionId} for conversation ${conversationId} (agent ${agent.id})`
          )
          this.processManager.appendDebugEvent?.(agent.id, {
            kind: 'response',
            action: 'session/load',
            sessionId,
            payload: summarizeSessionResponse(loadResponse)
          })
        } catch (error) {
          detachHandlers?.forEach((dispose) => {
            try {
              dispose()
            } catch (disposeError) {
              console.warn('[ACP] Failed to detach persisted session handler:', disposeError)
            }
          })
          detachHandlers = undefined
          this.processManager.clearSession(persistedSessionId)
          console.warn(
            `[ACP] Failed to load persisted session ${persistedSessionId} for conversation ${conversationId}; falling back to newSession.`,
            error
          )
          this.processManager.appendDebugEvent?.(agent.id, {
            kind: 'error',
            action: 'session/load',
            sessionId: persistedSessionId,
            message: error instanceof Error ? error.message : String(error),
            payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
          })
        }
      }

      if (!sessionId) {
        const newSessionRequestSummary = {
          cwd: workdir,
          mcpServerCount: mcpServers.length,
          mcpServers: summarizeMcpServers(mcpServers)
        }
        console.info(
          `[ACP] Creating new ACP session for conversation ${conversationId} (agent ${agent.id})`,
          newSessionRequestSummary
        )
        this.processManager.appendDebugEvent?.(agent.id, {
          kind: 'request',
          action: 'session/new',
          payload: newSessionRequestSummary
        })
        const response = await handle.connection.newSession({
          cwd: workdir,
          mcpServers
        })
        sessionId = response.sessionId
        sessionResponse = response
        responseModeState = response.modes ?? undefined
        const nextConfigState = normalizeAcpConfigState({
          configOptions: response.configOptions,
          models: response.models,
          modes: response.modes
        })
        if (hasAcpConfigStateData(nextConfigState)) {
          configState = nextConfigState
        }
        console.info(
          `[ACP] Created new ACP session ${sessionId} for conversation ${conversationId} (agent ${agent.id})`
        )
        this.processManager.appendDebugEvent?.(agent.id, {
          kind: 'response',
          action: 'session/new',
          sessionId,
          payload: summarizeSessionResponse(response)
        })
      }

      if (!sessionResponse) {
        throw new Error('[ACP] Session initialization did not return a response payload')
      }

      const legacyModeState = getLegacyModeState(configState)

      // Extract modes from response if available
      const availableModes =
        legacyModeState?.availableModes ??
        responseModeState?.availableModes?.map((mode) => ({
          id: mode.id,
          name: mode.name ?? mode.id,
          description: mode.description ?? ''
        })) ??
        handle.availableModes

      const preferredModeId = handle.currentModeId
      const responseModeId = legacyModeState?.currentModeId ?? responseModeState?.currentModeId
      let currentModeId = preferredModeId
      if (
        !currentModeId ||
        (availableModes && !availableModes.some((m) => m.id === currentModeId))
      ) {
        currentModeId = responseModeId ?? currentModeId ?? availableModes?.[0]?.id
      }

      const modeOption = getAcpConfigOptionByCategory(configState, 'mode')
      if (modeOption?.type === 'select' && currentModeId) {
        configState =
          updateAcpConfigStateValue(configState, modeOption.id, currentModeId) ?? configState
      }

      handle.configState = configState
      handle.availableModes = availableModes
      handle.currentModeId = currentModeId

      // Log available modes for the agent
      if (availableModes && availableModes.length > 0) {
        console.info(
          `[ACP] Agent "${agent.name}" (${agent.id}) supports modes: [${availableModes.map((m) => m.id).join(', ')}], ` +
            `current mode: "${currentModeId ?? 'default'}"`
        )
      } else {
        console.info(
          `[ACP] Agent "${agent.name}" (${agent.id}) does not declare any modes (will use default behavior)`
        )
      }

      return {
        sessionId,
        configState,
        availableModes,
        currentModeId,
        detachHandlers,
        promptCapabilities: handle.promptCapabilities
      }
    } catch (error) {
      console.error(`[ACP] Failed to initialize session for agent ${agent.id}:`, error)
      this.processManager.appendDebugEvent?.(agent.id, {
        kind: 'error',
        action: 'session/initialize',
        message: error instanceof Error ? error.message : String(error),
        payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
      })
      throw error
    }
  }

  async resolveMcpServersForAgent(
    agentId: string,
    mcpCapabilities?: schema.McpCapabilities
  ): Promise<schema.McpServer[]> {
    try {
      const selections = await this.configPresenter.getAgentMcpSelections(agentId)
      if (selections.length === 0) {
        console.info(`[ACP] No MCP selections for agent ${agentId}; passing none.`)
        return []
      }

      const serverConfigs = await this.configPresenter.getMcpServers()
      const converted = selections
        .map((name) => {
          const cfg = serverConfigs[name]
          if (!cfg) return null
          return convertMcpConfigToAcpFormat(name, cfg)
        })
        .filter((item): item is schema.McpServer => Boolean(item))

      const filtered = filterMcpServersByTransportSupport(converted, mcpCapabilities)
      if (converted.length !== filtered.length) {
        console.info(`[ACP] Filtered MCP servers by transport support for agent ${agentId}:`, {
          selected: selections,
          converted: converted.map((server) =>
            'type' in server ? `${server.name}:${server.type}` : `${server.name}:stdio`
          ),
          passed: filtered.map((server) =>
            'type' in server ? `${server.name}:${server.type}` : `${server.name}:stdio`
          )
        })
      } else {
        console.info(`[ACP] Passing MCP servers to agent ${agentId}:`, {
          selected: selections,
          passed: filtered.map((server) =>
            'type' in server ? `${server.name}:${server.type}` : `${server.name}:stdio`
          )
        })
      }
      return filtered
    } catch (error) {
      console.warn(`[ACP] Failed to resolve MCP servers for agent ${agentId}; passing none.`, error)
      return []
    }
  }
}
