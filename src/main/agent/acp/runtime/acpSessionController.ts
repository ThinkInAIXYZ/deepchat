import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { ClientSideConnection as ClientSideConnectionType } from '@agentclientprotocol/sdk'
import type { AcpAgentConfig, AcpConfigState } from '@shared/presenter'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { AppSessionId, AcpRemoteSessionId } from '@/agent/shared/agentSessionIds'
import {
  getAcpConfigOption,
  getAcpConfigOptionByCategory,
  getLegacyModeState,
  hasAcpConfigStateData,
  LEGACY_MODEL_CONFIG_ID,
  LEGACY_MODE_CONFIG_ID,
  normalizeAcpConfigState,
  updateAcpConfigStateValue
} from './acpConfigState'
import { AcpContentMapper } from './acpContentMapper'
import type { AcpProcessManager } from './acpProcessManager'
import type { AcpSessionManager, AcpSessionRecord } from './acpSessionManager'
import type { AcpSessionPersistence } from './acpSessionPersistence'

export interface AcpSessionCapabilityEvents {
  modesReady(input: {
    conversationId: AppSessionId
    agentId: string
    workdir: string
    current: string
    available: Array<{ id: string; name: string; description: string }>
  }): void
  configOptionsReady(input: {
    conversationId: AppSessionId
    agentId: string
    workdir: string
    configState: AcpConfigState
  }): void
  commandsReady(input: {
    conversationId: AppSessionId
    agentId: string
    commands: AcpSessionCommand[]
  }): void
}

export interface AcpSessionCommand {
  name: string
  description: string
  input?: { hint: string } | null
}

export interface AcpSessionHooks {
  onEvents?(events: readonly LLMCoreStreamEvent[]): void
  onPermission(request: schema.RequestPermissionRequest): Promise<schema.RequestPermissionResponse>
  onProcessExit?(sessionId: AcpRemoteSessionId): void
  signal?: AbortSignal
}

export interface AcpSessionPrepareHooks {
  onProcessExit?(sessionId: AcpRemoteSessionId): void
  signal?: AbortSignal
}

type AcpConnectionWithModelSelection = ClientSideConnectionType & {
  unstable_setSessionModel?: (
    params: schema.SetSessionModelRequest
  ) => Promise<schema.SetSessionModelResponse>
}

const preserveLegacyConfigOptions = (
  currentState: AcpConfigState | null | undefined,
  incomingState: AcpConfigState
): AcpConfigState => {
  const incomingIds = new Set(incomingState.options.map((option) => option.id))
  const incomingCategories = new Set(
    incomingState.options
      .map((option) => option.category)
      .filter((category): category is string => Boolean(category))
  )
  const legacyOptions =
    currentState?.options.filter(
      (option) =>
        (option.id === LEGACY_MODEL_CONFIG_ID || option.id === LEGACY_MODE_CONFIG_ID) &&
        !incomingIds.has(option.id) &&
        (!option.category || !incomingCategories.has(option.category))
    ) ?? []

  return {
    source: incomingState.source,
    options: [...legacyOptions, ...incomingState.options]
  }
}

async function setSessionModelCompat(
  connection: AcpConnectionWithModelSelection,
  params: schema.SetSessionModelRequest
): Promise<schema.SetSessionModelResponse> {
  if (!connection.unstable_setSessionModel) {
    throw new Error('[ACP] Session model selection is not supported by this SDK connection.')
  }
  return await connection.unstable_setSessionModel(params)
}

export class AcpSessionController {
  private readonly contentMapper: AcpContentMapper

  constructor(
    private readonly sessionManager: AcpSessionManager,
    private readonly processManager: AcpProcessManager,
    private readonly persistence: AcpSessionPersistence,
    private readonly events?: AcpSessionCapabilityEvents
  ) {
    this.contentMapper = new AcpContentMapper((terminalId) =>
      this.processManager.getTerminalSnapshot(terminalId)
    )
  }

  async open(
    conversationId: AppSessionId,
    agent: AcpAgentConfig,
    hooks: AcpSessionHooks,
    workdir?: string | null
  ): Promise<AcpSessionRecord> {
    this.throwIfAborted(hooks.signal)
    const pendingUpdates = new Map<string, schema.SessionNotification[]>()
    let publishedSessionId: AcpRemoteSessionId | null = null
    const sessionHooks = {
      onSessionUpdate: (notification: schema.SessionNotification) => {
        if (!publishedSessionId) {
          const updates = pendingUpdates.get(notification.sessionId) ?? []
          updates.push(notification)
          pendingUpdates.set(notification.sessionId, updates)
          return
        }
        if (notification.sessionId !== publishedSessionId) return
        this.handleSessionUpdate(conversationId, agent.id, notification, hooks.onEvents)
      },
      onPermission: hooks.onPermission,
      onProcessExit: hooks.onProcessExit
    }
    const opening = hooks.signal
      ? this.sessionManager.getOrCreateSession(
          conversationId,
          agent,
          sessionHooks,
          workdir,
          hooks.signal
        )
      : this.sessionManager.getOrCreateSession(conversationId, agent, sessionHooks, workdir)
    const session = await this.awaitSessionOpen(conversationId, opening, hooks.signal)
    if (hooks.signal?.aborted) {
      await this.discardLateOpen(conversationId, session)
      this.throwIfAborted(hooks.signal)
    }
    publishedSessionId = session.sessionId
    const replay = pendingUpdates.get(session.sessionId) ?? []
    replay.forEach((notification) =>
      this.handleSessionUpdate(conversationId, agent.id, notification, hooks.onEvents)
    )
    pendingUpdates.clear()
    this.emitReady(conversationId, session)
    return session
  }

  async prepare(
    conversationId: AppSessionId,
    agent: AcpAgentConfig,
    workdir?: string | null,
    hooks?: AcpSessionPrepareHooks
  ): Promise<AcpSessionRecord> {
    this.throwIfAborted(hooks?.signal)
    const requestedWorkdir = workdir?.trim()
    const persistedWorkdir =
      requestedWorkdir && this.persistence.isWorkdirUsable(requestedWorkdir)
        ? requestedWorkdir
        : null
    const normalizedWorkdir = this.persistence.resolveWorkdir(persistedWorkdir)
    if (requestedWorkdir && !persistedWorkdir) {
      console.warn(
        `[ACP] Prepare requested unavailable workdir "${requestedWorkdir}" for conversation ${conversationId}; using "${normalizedWorkdir}".`
      )
    }
    const existing = await this.persistence.getSessionData(conversationId, agent.id)
    this.throwIfAborted(hooks?.signal)
    const previousResolved = this.persistence.resolveWorkdir(existing?.workdir ?? null)
    if (previousResolved !== normalizedWorkdir) {
      await this.sessionManager.clearSession(conversationId)
      this.throwIfAborted(hooks?.signal)
      await this.persistence.clearSession(conversationId, agent.id)
    }
    this.throwIfAborted(hooks?.signal)
    await this.persistence.updateWorkdir(conversationId, agent.id, persistedWorkdir)
    this.throwIfAborted(hooks?.signal)
    return await this.open(
      conversationId,
      agent,
      {
        onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        onProcessExit: hooks?.onProcessExit,
        signal: hooks?.signal
      },
      normalizedWorkdir
    )
  }

  async updateWorkdir(
    conversationId: AppSessionId,
    agentId: string,
    workdir: string | null
  ): Promise<string> {
    const requestedWorkdir = workdir?.trim() ? workdir.trim() : null
    const persistedWorkdir =
      requestedWorkdir && this.persistence.isWorkdirUsable(requestedWorkdir)
        ? requestedWorkdir
        : null
    if (requestedWorkdir && !persistedWorkdir) {
      console.warn(
        `[ACP] Ignoring unavailable ACP workdir "${requestedWorkdir}" for conversation ${conversationId} (agent ${agentId}); using default workdir.`
      )
    }

    const existing = await this.persistence.getSessionData(conversationId, agentId)
    const previousResolved = this.persistence.resolveWorkdir(existing?.workdir ?? null)
    const nextResolved = this.persistence.resolveWorkdir(persistedWorkdir)
    if (previousResolved !== nextResolved) {
      await this.sessionManager.clearSession(conversationId)
      await this.persistence.clearSession(conversationId, agentId)
    }
    await this.persistence.updateWorkdir(conversationId, agentId, persistedWorkdir)
    return nextResolved
  }

  clearMappedSession(sessionId: AcpRemoteSessionId): void {
    this.contentMapper.clearSession(sessionId)
  }

  getSession(conversationId: AppSessionId): AcpSessionRecord | null {
    return this.sessionManager.getSession(conversationId)
  }

  async clear(conversationId: AppSessionId): Promise<void> {
    await this.sessionManager.clearSession(conversationId)
  }

  getModes(conversationId: AppSessionId): {
    current: string
    available: Array<{ id: string; name: string; description: string }>
  } | null {
    const session = this.sessionManager.getSession(conversationId)
    if (!session) return null
    const legacyModeState = getLegacyModeState(session.configState)
    return legacyModeState
      ? {
          current: legacyModeState.currentModeId ?? session.currentModeId ?? 'default',
          available: legacyModeState.availableModes
        }
      : {
          current: session.currentModeId ?? 'default',
          available: session.availableModes ?? []
        }
  }

  getConfigOptions(conversationId: AppSessionId): AcpConfigState | null {
    return this.sessionManager.getSession(conversationId)?.configState ?? null
  }

  getCommands(conversationId: AppSessionId): AcpSessionCommand[] {
    return this.sessionManager.getSession(conversationId)?.availableCommands ?? []
  }

  async setMode(conversationId: AppSessionId, modeId: string): Promise<void> {
    const session = this.requireSession(conversationId)
    const configModeOption = getAcpConfigOptionByCategory(session.configState, 'mode')
    if (configModeOption?.type === 'select' && configModeOption.id !== LEGACY_MODE_CONFIG_ID) {
      await this.setConfigOption(conversationId, configModeOption.id, modeId)
      return
    }

    await session.connection.setSessionMode({ sessionId: session.sessionId, modeId })
    session.currentModeId = modeId
    session.configState =
      updateAcpConfigStateValue(session.configState, LEGACY_MODE_CONFIG_ID, modeId) ??
      session.configState
    this.processManager.updateBoundProcessMode(conversationId, modeId)
    this.emitConfig(conversationId, session)
    this.emitModes(conversationId, session)
  }

  async setConfigOption(
    conversationId: AppSessionId,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    const session = this.requireSession(conversationId)
    const option = getAcpConfigOption(session.configState, configId)
    if (!option) {
      throw new Error(
        `[ACP] Config option "${configId}" is unavailable for conversation ${conversationId}`
      )
    }

    let nextConfigState: AcpConfigState | null
    if (configId === LEGACY_MODE_CONFIG_ID) {
      if (typeof value !== 'string') {
        throw new Error('[ACP] Legacy mode config option expects a string value')
      }
      await session.connection.setSessionMode({ sessionId: session.sessionId, modeId: value })
      session.currentModeId = value
      nextConfigState =
        updateAcpConfigStateValue(session.configState, configId, value) ??
        session.configState ??
        null
    } else if (configId === LEGACY_MODEL_CONFIG_ID) {
      if (typeof value !== 'string') {
        throw new Error('[ACP] Legacy model config option expects a string value')
      }
      await setSessionModelCompat(session.connection, {
        sessionId: session.sessionId,
        modelId: value
      })
      nextConfigState =
        updateAcpConfigStateValue(session.configState, configId, value) ??
        session.configState ??
        null
    } else {
      const response =
        typeof value === 'boolean'
          ? await session.connection.setSessionConfigOption({
              sessionId: session.sessionId,
              configId,
              type: 'boolean',
              value
            })
          : await session.connection.setSessionConfigOption({
              sessionId: session.sessionId,
              configId,
              value
            })
      const normalized = normalizeAcpConfigState({ configOptions: response.configOptions })
      nextConfigState = hasAcpConfigStateData(normalized)
        ? preserveLegacyConfigOptions(session.configState, normalized)
        : (updateAcpConfigStateValue(session.configState, configId, value) ??
          session.configState ??
          null)
    }

    if (!nextConfigState) return null
    session.configState = nextConfigState
    const legacyModeState = getLegacyModeState(nextConfigState)
    if (legacyModeState) {
      session.availableModes = legacyModeState.availableModes
      session.currentModeId = legacyModeState.currentModeId ?? session.currentModeId
      this.emitModes(conversationId, session)
    }
    this.processManager.updateBoundProcessConfigState(conversationId, nextConfigState)
    this.emitConfig(conversationId, session)
    return nextConfigState
  }

  private handleSessionUpdate(
    conversationId: AppSessionId,
    agentId: string,
    notification: schema.SessionNotification,
    onEvents?: (events: readonly LLMCoreStreamEvent[]) => void
  ): void {
    const mapped = this.contentMapper.map(notification)
    if (mapped.events.length > 0) onEvents?.(mapped.events)

    const session = this.sessionManager.getSession(conversationId)
    if (!session) return
    let modesChanged = false
    let configChanged = false
    let commandsChanged = false
    if (mapped.currentModeId) {
      session.currentModeId = mapped.currentModeId
      modesChanged = true
    }
    if (mapped.availableCommands !== undefined) {
      session.availableCommands = mapped.availableCommands
      commandsChanged = true
    }
    if (mapped.configState) {
      session.configState = mapped.configState
      configChanged = true
      const legacyModeState = getLegacyModeState(mapped.configState)
      if (legacyModeState) {
        session.availableModes = legacyModeState.availableModes
        session.currentModeId = legacyModeState.currentModeId ?? session.currentModeId
        modesChanged = true
      }
      this.processManager.updateBoundProcessConfigState(conversationId, mapped.configState)
    }
    if (mapped.sessionInfo || mapped.usage) {
      const metadata = {
        ...session.metadata,
        ...(mapped.sessionInfo ? { acpSessionInfo: mapped.sessionInfo } : {}),
        ...(mapped.usage ? { acpUsage: mapped.usage } : {})
      }
      session.metadata = metadata
      void this.persistence.mergeMetadata(conversationId, agentId, metadata).catch((error) => {
        console.warn('[ACP] Failed to persist ACP session update metadata:', error)
      })
    }
    if (modesChanged) this.emitModes(conversationId, session)
    if (configChanged) this.emitConfig(conversationId, session)
    if (commandsChanged) this.emitCommands(conversationId, session)
  }

  private emitReady(conversationId: AppSessionId, session: AcpSessionRecord): void {
    this.emitModes(conversationId, session)
    this.emitConfig(conversationId, session)
    this.emitCommands(conversationId, session)
  }

  private emitModes(conversationId: AppSessionId, session: AcpSessionRecord): void {
    this.events?.modesReady({
      conversationId,
      agentId: session.agentId,
      workdir: session.workdir,
      current: session.currentModeId ?? 'default',
      available: session.availableModes ?? []
    })
  }

  private emitConfig(conversationId: AppSessionId, session: AcpSessionRecord): void {
    this.events?.configOptionsReady({
      conversationId,
      agentId: session.agentId,
      workdir: session.workdir,
      configState: session.configState ?? normalizeAcpConfigState({})
    })
  }

  private emitCommands(conversationId: AppSessionId, session: AcpSessionRecord): void {
    this.events?.commandsReady({
      conversationId,
      agentId: session.agentId,
      commands: session.availableCommands ?? []
    })
  }

  private requireSession(conversationId: AppSessionId): AcpSessionRecord {
    const session = this.sessionManager.getSession(conversationId)
    if (!session) throw new Error(`[ACP] No session found for conversation ${conversationId}`)
    return session
  }

  private async awaitSessionOpen(
    conversationId: AppSessionId,
    opening: Promise<AcpSessionRecord>,
    signal?: AbortSignal
  ): Promise<AcpSessionRecord> {
    if (!signal) return await opening
    const guardedOpening = opening.then(async (session) => {
      if (signal.aborted) {
        await this.discardLateOpen(conversationId, session)
        throw this.getAbortError(signal)
      }
      return session
    })
    void guardedOpening.catch(() => {})

    let rejectAborted!: (reason: Error) => void
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject
    })
    const onAbort = () => {
      const error = this.getAbortError(signal)
      this.sessionManager.cancelPendingSession(conversationId, error)
      rejectAborted(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    try {
      return await Promise.race([guardedOpening, aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async discardLateOpen(
    conversationId: AppSessionId,
    session: AcpSessionRecord
  ): Promise<void> {
    await this.sessionManager.discardLateSession(conversationId, session)
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return
    throw this.getAbortError(signal)
  }

  private getAbortError(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) return signal.reason
    const error = new Error('ACP session preparation cancelled')
    error.name = 'AbortError'
    return error
  }
}
