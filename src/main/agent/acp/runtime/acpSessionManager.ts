import { toAcpRemoteSessionId, type AcpRemoteSessionId } from '@/agent/shared/agentSessionIds'
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
  onProcessExit?: (sessionId: AcpRemoteSessionId) => void
}

interface PendingSessionInitialization {
  controller: AbortController
  epoch: number
  promise: Promise<AcpSessionRecord>
}

interface SessionUpdateGate {
  hooks: SessionHooks
  commit(): void
  discard(): void
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
  sessionId: AcpRemoteSessionId
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
  private readonly sessionsById = new Map<AcpRemoteSessionId, AcpSessionRecord>()
  private readonly pendingSessions = new Map<string, PendingSessionInitialization>()
  private readonly processHandlesBySession = new WeakMap<AcpSessionRecord, AcpProcessHandle>()
  private readonly exitedInitializingConversations = new Set<string>()
  private nextInitializationEpoch = 0

  constructor(options: AcpSessionManagerOptions) {
    this.providerId = options.providerId
    this.processManager = options.processManager
    this.sessionPersistence = options.sessionPersistence
    this.configPresenter = options.configPresenter
  }

  async getOrCreateSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks,
    workdir?: string | null,
    signal?: AbortSignal
  ): Promise<AcpSessionRecord> {
    if (signal?.aborted) {
      const inflight = this.pendingSessions.get(conversationId)
      if (inflight) {
        this.cancelPendingSession(conversationId, this.getInitializationAbortReason(signal))
        return await inflight.promise
      }
      this.throwIfInitializationAborted(signal)
    }
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
      existing.detachHandlers = this.attachSessionHooks(
        conversationId,
        agent.id,
        existing.sessionId,
        hooks
      )
      existing.workdir = resolvedWorkdir
      return existing
    }
    if (existing) {
      await this.clearSession(conversationId)
      this.throwIfInitializationAborted(signal)
    }

    const inflight = this.pendingSessions.get(conversationId)
    if (inflight) {
      // Initialization cancellation is conversation-scoped: aborting any waiter rejects all waiters.
      return await this.waitForPendingInitialization(conversationId, inflight, signal)
    }

    const pending: PendingSessionInitialization = {
      controller: new AbortController(),
      epoch: ++this.nextInitializationEpoch,
      promise: Promise.resolve(undefined as never)
    }
    this.pendingSessions.set(conversationId, pending)
    const creation = Promise.resolve().then(() =>
      this.createSession(
        conversationId,
        agent,
        hooks,
        resolvedWorkdir,
        pending.controller.signal
      )
    )
    pending.promise = this.settlePendingInitialization(conversationId, pending, creation)
    return await this.waitForPendingInitialization(conversationId, pending, signal)
  }

  cancelPendingSession(conversationId: string, reason?: Error): boolean {
    const pending = this.pendingSessions.get(conversationId)
    if (!pending || pending.controller.signal.aborted) return false
    pending.controller.abort(reason ?? this.createInitializationAbortError(conversationId))
    return true
  }

  getSession(conversationId: string): AcpSessionRecord | null {
    return this.sessionsByConversation.get(conversationId) ?? null
  }

  getSessionById(sessionId: string): AcpSessionRecord | null {
    return this.sessionsById.get(toAcpRemoteSessionId(sessionId)) ?? null
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
    const pending = this.pendingSessions.get(conversationId)
    if (pending) {
      this.cancelPendingSession(conversationId)
      await Promise.allSettled([pending.promise])
    }
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
      await this.processManager.unbindProcess(
        session.agentId,
        conversationId,
        this.processHandlesBySession.get(session)
      )
    } catch (error) {
      console.warn(
        `[ACP] Failed to unbind process for conversation ${conversationId} (agent ${session.agentId}):`,
        error
      )
    }

    await this.sessionPersistence.clearSession(conversationId, session.agentId)
  }

  async clearAllSessions(): Promise<void> {
    const pending = Array.from(this.pendingSessions.entries())
    pending.forEach(([conversationId]) => this.cancelPendingSession(conversationId))
    await Promise.allSettled(pending.map(([, entry]) => entry.promise))
    const clears = Array.from(this.sessionsByConversation.keys()).map((conversationId) =>
      this.clearSession(conversationId)
    )
    await Promise.allSettled(clears)
    this.sessionsByConversation.clear()
    this.sessionsById.clear()
    this.pendingSessions.clear()
    this.exitedInitializingConversations.clear()
  }

  async discardLateSession(
    conversationId: string,
    session: AcpSessionRecord
  ): Promise<void> {
    if (this.sessionsByConversation.get(conversationId) === session) {
      this.sessionsByConversation.delete(conversationId)
      this.sessionsById.delete(session.sessionId)
    }
    this.disposeSessionHandlers(session)
    const current = this.sessionsByConversation.get(conversationId)
    const pending = this.pendingSessions.get(conversationId)
    if (current?.sessionId !== session.sessionId) {
      this.processManager.clearSession(session.sessionId)
    }
    if (!current && !pending) {
      await this.processManager.unbindProcess(
        session.agentId,
        conversationId,
        this.processHandlesBySession.get(session)
      )
    }
  }

  private async settlePendingInitialization(
    conversationId: string,
    pending: PendingSessionInitialization,
    creation: Promise<AcpSessionRecord>
  ): Promise<AcpSessionRecord> {
    const signal = pending.controller.signal
    const guardedCreation = creation.then(async (session) => {
      if (
        signal.aborted ||
        this.pendingSessions.get(conversationId)?.epoch !== pending.epoch
      ) {
        await this.discardLateSession(conversationId, session)
        throw this.getInitializationAbortReason(signal, conversationId)
      }
      return session
    })
    void guardedCreation.catch(() => {})

    let rejectAborted!: (reason: Error) => void
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject
    })
    const onAbort = () => rejectAborted(this.getInitializationAbortReason(signal, conversationId))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    try {
      const session = await Promise.race([guardedCreation, aborted])
      this.throwIfInitializationAborted(signal, conversationId)
      if (this.pendingSessions.get(conversationId)?.epoch !== pending.epoch) {
        await this.discardLateSession(conversationId, session)
        throw this.createInitializationAbortError(conversationId)
      }
      if (this.exitedInitializingConversations.delete(conversationId)) {
        await this.discardLateSession(conversationId, session)
        throw new Error(
          `[ACP] Process exited while session ${session.sessionId} was initializing`
        )
      }
      this.sessionsByConversation.set(conversationId, session)
      this.sessionsById.set(session.sessionId, session)
      return session
    } finally {
      signal.removeEventListener('abort', onAbort)
      if (this.pendingSessions.get(conversationId)?.epoch === pending.epoch) {
        this.pendingSessions.delete(conversationId)
      }
      this.exitedInitializingConversations.delete(conversationId)
    }
  }

  private async waitForPendingInitialization(
    conversationId: string,
    pending: PendingSessionInitialization,
    signal?: AbortSignal
  ): Promise<AcpSessionRecord> {
    if (!signal) return await pending.promise
    const onAbort = () =>
      this.cancelPendingSession(conversationId, this.getInitializationAbortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    try {
      return await pending.promise
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async awaitInitialization<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return await promise
    this.throwIfInitializationAborted(signal)
    let rejectAborted!: (reason: Error) => void
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject
    })
    const onAbort = () => rejectAborted(this.getInitializationAbortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    void promise.catch(() => {})
    try {
      return await Promise.race([promise, aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private throwIfInitializationAborted(signal?: AbortSignal, conversationId?: string): void {
    if (signal?.aborted) {
      throw this.getInitializationAbortReason(signal, conversationId)
    }
  }

  private getInitializationAbortReason(signal: AbortSignal, conversationId?: string): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : this.createInitializationAbortError(conversationId)
  }

  private createInitializationAbortError(conversationId?: string): Error {
    const error = new Error(
      conversationId
        ? `[ACP] Session initialization cancelled for conversation ${conversationId}`
        : '[ACP] Session initialization cancelled'
    )
    error.name = 'AbortError'
    return error
  }

  private async createSession(
    conversationId: string,
    agent: AcpAgentConfig,
    hooks: SessionHooks,
    workdir: string,
    signal: AbortSignal
  ): Promise<AcpSessionRecord> {
    let handle: AcpProcessHandle | undefined
    let session:
      | Awaited<ReturnType<AcpSessionManager['initializeSession']>>
      | undefined
    try {
      handle = await this.awaitInitialization(
        this.processManager.getConnection(agent, workdir),
        signal
      )
      this.throwIfInitializationAborted(signal)
      this.processManager.bindProcess(agent.id, conversationId, workdir)

      session = await this.initializeSession(
        handle,
        conversationId,
        agent,
        workdir,
        hooks,
        signal
      )
      this.throwIfInitializationAborted(signal)

      let configState =
        session.configState ?? handle.configState ?? createEmptyAcpConfigState('legacy')
      const legacyModeState = getLegacyModeState(configState)
      const availableModes =
        session.availableModes ?? legacyModeState?.availableModes ?? handle.availableModes
      let currentModeId =
        handle.currentModeId ?? session.currentModeId ?? legacyModeState?.currentModeId
      handle.configState = configState
      handle.availableModes = availableModes
      handle.currentModeId = currentModeId

      if (
        availableModes?.length &&
        currentModeId &&
        currentModeId !== session.currentModeId &&
        availableModes.some((mode) => mode.id === currentModeId)
      ) {
        try {
          await this.awaitInitialization(
            handle.connection.setSessionMode({
              sessionId: session.sessionId,
              modeId: currentModeId
            }),
            signal
          )
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
          this.throwIfInitializationAborted(signal)
          console.warn(
            `[ACP] Failed to apply preferred mode "${currentModeId}" for conversation ${conversationId}:`,
            error
          )
          currentModeId = session.currentModeId ?? currentModeId
        }
      }

      this.throwIfInitializationAborted(signal)
      this.processManager.registerSessionWorkdir(session.sessionId, workdir, conversationId)
      void this.sessionPersistence
        .saveSessionData(conversationId, agent.id, session.sessionId, workdir, 'active', {
          agentName: agent.name
        })
        .catch((error) => {
          console.warn('[ACP] Failed to persist session metadata:', error)
        })

      const record: AcpSessionRecord = {
        ...session,
        providerId: this.providerId,
        agentId: agent.id,
        conversationId,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: { agentName: agent.name },
        connection: handle.connection,
        workdir,
        configState,
        availableModes,
        currentModeId,
        promptCapabilities: handle.promptCapabilities
      }
      this.processHandlesBySession.set(record, handle)
      return record
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (session) {
        this.disposeSessionHandlers(session)
        this.processManager.clearSession(session.sessionId)
      }
      if (handle) {
        try {
          await this.processManager.unbindProcess(agent.id, conversationId, handle)
        } catch (cleanupError) {
          console.warn(
            '[ACP] Failed to unbind process after session initialization error:',
            cleanupError
          )
        }
      }
      if (!signal.aborted && message.includes('shutting down')) {
        throw new Error('[ACP] Cannot create session: process manager is shutting down')
      }
      throw error
    }
  }

  private attachSessionHooks(
    conversationId: string,
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
    const detachProcessExit = this.processManager.registerProcessExitHandler(
      agentId,
      sessionId,
      () => {
        const remoteSessionId = toAcpRemoteSessionId(sessionId)
        this.handleProcessExit(conversationId, agentId, remoteSessionId)
        hooks.onProcessExit?.(remoteSessionId)
      }
    )
    return [detachUpdate, detachPermission, detachProcessExit]
  }

  private createSessionUpdateGate(hooks: SessionHooks): SessionUpdateGate {
    const pending: schema.SessionNotification[] = []
    let state: 'pending' | 'committed' | 'discarded' = 'pending'
    return {
      hooks: {
        ...hooks,
        onSessionUpdate: (notification) => {
          if (state === 'pending') {
            pending.push(notification)
          } else if (state === 'committed') {
            hooks.onSessionUpdate(notification)
          }
        }
      },
      commit: () => {
        if (state !== 'pending') return
        state = 'committed'
        pending.splice(0).forEach((notification) => hooks.onSessionUpdate(notification))
      },
      discard: () => {
        if (state !== 'pending') return
        state = 'discarded'
        pending.length = 0
      }
    }
  }

  private handleProcessExit(
    conversationId: string,
    agentId: string,
    sessionId: AcpRemoteSessionId
  ): void {
    const current = this.sessionsByConversation.get(conversationId)
    if (current?.agentId === agentId && current.sessionId === sessionId) {
      this.sessionsByConversation.delete(conversationId)
      this.sessionsById.delete(sessionId)
      this.processManager.clearSession(sessionId)
      this.disposeSessionHandlers(current)
      return
    }
    if (this.pendingSessions.has(conversationId)) {
      this.processManager.clearSession(sessionId)
      this.exitedInitializingConversations.add(conversationId)
    }
  }

  private disposeSessionHandlers(session: Pick<AcpSessionRecord, 'detachHandlers'>): void {
    const handlers = session.detachHandlers
    session.detachHandlers = []
    handlers.forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[ACP] Failed to dispose session handler after process exit:', error)
      }
    })
  }
  private async initializeSession(
    handle: AcpProcessHandle,
    conversationId: string,
    agent: AcpAgentConfig,
    workdir: string,
    hooks: SessionHooks,
    signal?: AbortSignal
  ): Promise<{
    sessionId: AcpRemoteSessionId
    configState: AcpConfigState
    promptCapabilities?: schema.PromptCapabilities
    availableModes?: Array<{ id: string; name: string; description: string }>
    currentModeId?: string
    detachHandlers: Array<() => void>
  }> {
    let detachHandlers: Array<() => void> | undefined
    let updateGate: SessionUpdateGate | undefined
    let activeSessionId: AcpRemoteSessionId | null = null
    try {
      const mcpServers = await this.awaitInitialization(
        this.resolveMcpServersForAgent(agent.id, handle.mcpCapabilities),
        signal
      )

      const persistedSession = await this.awaitInitialization(
        this.sessionPersistence.getSessionData(conversationId, agent.id),
        signal
      )
      const persistedSessionId = persistedSession?.sessionId?.trim()
        ? toAcpRemoteSessionId(persistedSession.sessionId.trim())
        : null

      let sessionId: AcpRemoteSessionId | null = null
      let configState = handle.configState ?? createEmptyAcpConfigState('legacy')
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
          updateGate = this.createSessionUpdateGate(hooks)
          detachHandlers = this.attachSessionHooks(
            conversationId,
            agent.id,
            persistedSessionId,
            updateGate.hooks
          )
          const resumeResponse = await this.awaitInitialization(
            connection.unstable_resumeSession!({
              cwd: workdir,
              mcpServers,
              sessionId: persistedSessionId
            }),
            signal
          )
          sessionId = persistedSessionId
          activeSessionId = sessionId
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
          updateGate?.discard()
          updateGate = undefined
          detachHandlers?.forEach((dispose) => {
            try {
              dispose()
            } catch (disposeError) {
              console.warn('[ACP] Failed to detach resumed session handler:', disposeError)
            }
          })
          detachHandlers = undefined
          this.processManager.clearSession(persistedSessionId)
          this.throwIfInitializationAborted(signal)
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
          updateGate = this.createSessionUpdateGate(hooks)
          detachHandlers = this.attachSessionHooks(
            conversationId,
            agent.id,
            persistedSessionId,
            updateGate.hooks
          )
          const loadResponse = await this.awaitInitialization(
            handle.connection.loadSession({
              cwd: workdir,
              mcpServers,
              sessionId: persistedSessionId
            }),
            signal
          )
          sessionId = persistedSessionId
          activeSessionId = sessionId
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
          updateGate?.discard()
          updateGate = undefined
          detachHandlers?.forEach((dispose) => {
            try {
              dispose()
            } catch (disposeError) {
              console.warn('[ACP] Failed to detach persisted session handler:', disposeError)
            }
          })
          detachHandlers = undefined
          this.processManager.clearSession(persistedSessionId)
          this.throwIfInitializationAborted(signal)
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
        const response = await this.awaitInitialization(
          handle.connection.newSession({
            cwd: workdir,
            mcpServers
          }),
          signal
        )
        sessionId = toAcpRemoteSessionId(response.sessionId)
        activeSessionId = sessionId
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

      if (!sessionId || !sessionResponse) {
        throw new Error('[ACP] Session initialization did not return a response payload')
      }

      if (!detachHandlers) {
        updateGate = this.createSessionUpdateGate(hooks)
        detachHandlers = this.attachSessionHooks(
          conversationId,
          agent.id,
          sessionId,
          updateGate.hooks
        )
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

      this.throwIfInitializationAborted(signal)
      updateGate?.commit()
      return {
        sessionId,
        configState,
        availableModes,
        currentModeId,
        detachHandlers,
        promptCapabilities: handle.promptCapabilities
      }
    } catch (error) {
      updateGate?.discard()
      detachHandlers?.forEach((dispose) => {
        try {
          dispose()
        } catch (disposeError) {
          console.warn('[ACP] Failed to detach initializing session handler:', disposeError)
        }
      })
      if (activeSessionId) this.processManager.clearSession(activeSessionId)
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
