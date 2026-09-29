import { buildAcpHistory } from './acpHistory'
import { toAcpRemoteSessionId } from '@/agent/shared/agentSessionIds'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { type LodySubagentEvent, LODY_EXTENSION_METHODS } from 'acp-extension-core'
import type { AcpExtensionState, AcpSubagentRun } from '@shared/types/acp-extensions'
import {
  createAcpExtensionState,
  disconnectAcpExtensionState,
  mergeAcpUsage,
  getAcpUsageSinceFork
} from './acpExtensionState'
import {
  readLodySessionMeta,
  acpGoalSchema,
  acpRateLimitsSchema,
  acpRemoteTasksSchema,
  type AcpExtensionNotification
} from './acpLodyExtensions'
import { AcpFsHandler } from './acpFsHandler'
import { accumulate } from '@/agent/deepchat/runtime/accumulator'
import { createState, type StreamState } from '@/agent/deepchat/runtime/types'
import type * as schema from '@agentclientprotocol/sdk'
import { RequestError } from '@agentclientprotocol/sdk'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import type {
  AcpConnection as ClientSideConnectionType,
  AcpSetSessionModelRequest,
  AcpSetSessionModelResponse
} from '@/agent/acp/runtime/acpConnection'
import type { AcpAgentConfig } from '@shared/types/acp'
import type { AcpConfigState } from '@shared/types/acp'
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

// Expand only after verifying replay completion and rewritten fork anchors on the wire.
const hasVerifiedHistoryBoundary = (agentInfo: AcpSessionRecord['agentInfo']) =>
  agentInfo?.name === 'dimcode' && agentInfo.version === '0.5.12'

export interface AcpSessionCapabilityEvents {
  getLocalTitle?(conversationId: string): string | undefined
  applyTitle?(conversationId: string, expected: string, title: string): boolean
  extensionsChanged?(input: {
    conversationId: AppSessionId
    agentId: string
    revision: number
  }): void
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
    params: AcpSetSessionModelRequest
  ) => Promise<AcpSetSessionModelResponse>
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
  params: AcpSetSessionModelRequest
): Promise<AcpSetSessionModelResponse> {
  if (!connection.unstable_setSessionModel) {
    throw new Error('[ACP] Session model selection is not supported by this SDK connection.')
  }
  return await connection.unstable_setSessionModel(params)
}

export class AcpSessionController {
  private readonly historyReads = new Map<
    string,
    { updates: schema.SessionNotification[]; bytes: number; overflow: boolean }
  >()
  private readonly pendingSteers = new Map<
    string,
    { conversationId: AppSessionId; settle: (status: 'applied' | 'failed' | 'unknown') => void }
  >()
  private readonly contentMapper: AcpContentMapper
  private readonly runStreams = new Map<string, { mapper: AcpContentMapper; stream: StreamState }>()
  private readonly pendingRunEvents = new Map<string, { at: number; events: LodySubagentEvent[] }>()
  private readonly pendingStateWrites = new Map<string, ReturnType<typeof setTimeout>>()

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
    const initialTitle = this.events?.getLocalTitle?.(conversationId)
    const pendingUpdates = new Map<string, schema.SessionNotification[]>()
    let publishedSessionId: AcpRemoteSessionId | null = null
    let openedSession: AcpSessionRecord | undefined
    const pendingExtensions: AcpExtensionNotification[] = []
    const sessionHooks = {
      onSessionUpdate: (notification: schema.SessionNotification) => {
        if (!publishedSessionId) {
          const updates = pendingUpdates.get(notification.sessionId) ?? []
          updates.push(notification)
          pendingUpdates.set(notification.sessionId, updates)
          return
        }
        if (
          notification.sessionId !== publishedSessionId ||
          this.sessionManager.getSession(conversationId) !== openedSession
        )
          return
        this.handleSessionUpdate(conversationId, agent.id, notification, hooks.onEvents)
      },
      onPermission: hooks.onPermission,
      onExtension: (notification: AcpExtensionNotification) => {
        if (!publishedSessionId) {
          pendingExtensions.push(notification)
          return
        }
        if (this.sessionManager.getSession(conversationId) === openedSession)
          this.handleExtension(conversationId, notification)
      },
      onProcessExit: (remoteId: AcpRemoteSessionId) => {
        if (openedSession)
          this.saveExtensionState(
            conversationId,
            openedSession,
            disconnectAcpExtensionState(this.extensionState(openedSession))
          )
        this.clearMappedSession(conversationId)
        this.clearRunStreams(conversationId)
        hooks.onProcessExit?.(remoteId)
      }
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
    openedSession = session
    if (session.metadata?.acpTitleBaseline === undefined && initialTitle !== undefined) {
      session.metadata = { ...session.metadata, acpTitleBaseline: initialTitle }
      void this.persistence
        .mergeMetadata(
          conversationId,
          agent.id,
          { acpTitleBaseline: initialTitle },
          session.sessionId
        )
        .catch(() => console.warn('[ACP] Failed to persist title baseline'))
    }
    this.saveExtensionState(
      conversationId,
      session,
      createAcpExtensionState(
        session.connectionId,
        session.sessionId,
        session.extensions ?? {},
        session.metadata?.acpExtensions as AcpExtensionState | undefined
      )
    )
    publishedSessionId = session.sessionId
    pendingExtensions.forEach((notification) => this.handleExtension(conversationId, notification))
    const replay = pendingUpdates.get(session.sessionId) ?? []
    replay.forEach((notification) =>
      this.handleSessionUpdate(conversationId, agent.id, notification, hooks.onEvents)
    )
    pendingUpdates.clear()
    this.emitReady(conversationId, session)
    // DimCode also uses the first extension request to enable usage notifications.
    if (session.extensions?.rateLimits?.query)
      void this.refreshRateLimits(conversationId).catch(() => {})
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

  clearMappedSession(sessionId: AppSessionId): void {
    this.finishSteers(sessionId)
    this.contentMapper.clearSession(sessionId)
  }

  private clearRunStreams(sessionId: AppSessionId): void {
    for (const key of this.pendingRunEvents.keys())
      if (key.startsWith(`${sessionId}:`)) this.pendingRunEvents.delete(key)
    for (const key of this.runStreams.keys())
      if (key.startsWith(`${sessionId}:`)) this.runStreams.delete(key)
  }

  getSession(conversationId: AppSessionId): AcpSessionRecord | null {
    return this.sessionManager.getSession(conversationId)
  }

  async clear(conversationId: AppSessionId): Promise<void> {
    clearTimeout(this.pendingStateWrites.get(conversationId))
    this.pendingStateWrites.delete(conversationId)
    this.clearMappedSession(conversationId)
    this.clearRunStreams(conversationId)
    const session = this.sessionManager.getSession(conversationId)
    if (session) {
      const state = disconnectAcpExtensionState(this.extensionState(session))
      session.metadata = { ...session.metadata, acpExtensions: state }
      await this.persistence
        .mergeMetadata(conversationId, session.agentId, { acpExtensions: state }, session.sessionId)
        .catch(() => console.warn('[ACP] Failed to persist disconnected state'))
      this.events?.extensionsChanged?.({
        conversationId,
        agentId: session.agentId,
        revision: state.revision
      })
    }
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

  async markTitleManual(conversationId: AppSessionId, agentId: string): Promise<void> {
    const session = this.sessionManager.getSession(conversationId)
    if (session) session.metadata = { ...session.metadata, acpTitleManual: true }
    await this.persistence.mergeMetadata(conversationId, agentId, { acpTitleManual: true })
  }

  async getExtensions(
    conversationId: AppSessionId,
    agentId: string
  ): Promise<AcpExtensionState | null> {
    const session = this.sessionManager.getSession(conversationId)
    if (session?.agentId === agentId) return this.extensionState(session)
    const persisted = await this.persistence.getSessionData(conversationId, agentId)
    const state = persisted?.metadata?.acpExtensions as AcpExtensionState | undefined
    return state?.version === 1 ? disconnectAcpExtensionState(state) : null
  }

  async completeFork(sourceId: AppSessionId, operationId: string): Promise<void> {
    const source = this.requireSession(sourceId)
    const operations = {
      ...(source.metadata?.acpForks as Record<string, { status: string; remoteSessionId?: string }>)
    }
    if (!Object.hasOwn(operations, operationId)) return
    delete operations[operationId]
    source.metadata = { ...source.metadata, acpForks: operations }
    await this.persistence.mergeMetadata(sourceId, source.agentId, { acpForks: operations })
  }

  async forkSession(
    sourceId: AppSessionId,
    targetId: AppSessionId,
    turnId: string,
    operationId: string
  ) {
    const source = this.requireSession(sourceId)
    if (
      !source.supportsSessionFork ||
      !source.extensions?.forkAtTurn ||
      !source.extensions.sessionHistory ||
      !hasVerifiedHistoryBoundary(source.agentInfo)
    )
      throw new Error('Verified ACP remote fork is unavailable')
    const operations = z
      .record(
        z.string(),
        z.object({
          status: z.enum(['pending', 'created', 'complete']),
          remoteSessionId: z.string().optional()
        })
      )
      .parse(source.metadata?.acpForks ?? {})
    for (const [id, operation] of Object.entries(operations))
      if (operation.status === 'complete') delete operations[id]
    const prior = Object.hasOwn(operations, operationId) ? operations[operationId] : undefined
    if (prior?.status === 'pending')
      throw new Error(
        'The previous remote fork has an unknown outcome; reconnect and inspect remote sessions before retrying'
      )
    if (!prior && Object.keys(operations).length >= 64)
      throw new Error('ACP fork operation limit reached')
    let remoteSessionId = prior?.remoteSessionId
    const persist = async (status?: 'pending' | 'created') => {
      if (status) operations[operationId] = { status, remoteSessionId }
      else delete operations[operationId]
      source.metadata = { ...source.metadata, acpForks: operations }
      await this.persistence.mergeMetadata(sourceId, source.agentId, { acpForks: operations })
    }
    if (!remoteSessionId) {
      const history = await this.readHistory(sourceId)
      if (!history.entries.some((entry) => entry.role === 'assistant' && entry.turnId === turnId))
        throw new Error('ACP fork anchor is not part of the current remote session')
      await persist('pending')
      const timeout = setTimeout(
        () => source.connection.close(new Error('ACP fork request timed out')),
        30_000
      )
      const response = await source.connection
        .unstable_forkSession({
          sessionId: source.sessionId,
          cwd: source.workdir,
          mcpServers: source.mcpServers ?? [],
          _meta: {
            lody: {
              ...this.persistence.getProjectMetadata(
                source.workdir,
                !!source.extensions.worktreeProject
              ),
              forkAtTurn: { version: 1, turnId }
            }
          }
        })
        .catch(async (error) => {
          if (error instanceof RequestError) await persist()
          throw error
        })
        .finally(() => clearTimeout(timeout))
      remoteSessionId = response.sessionId
      await persist('created')
    }
    const remoteId = toAcpRemoteSessionId(remoteSessionId)
    const updates: schema.SessionNotification[] = []
    let bytes = 0
    let overflow = false
    let usage: AcpExtensionState['usage']
    const detachUpdates = this.processManager.registerSessionListener(
      source.agentId,
      remoteId,
      (notification) => {
        bytes += JSON.stringify(notification).length
        if (updates.length >= 8192 || bytes > 8_388_608) overflow = true
        else updates.push(notification)
      },
      source.connectionId
    )
    const detachExtensions = this.processManager.registerExtensionListener(
      remoteId,
      source.connectionId,
      (notification) => {
        if (notification.method === LODY_EXTENSION_METHODS.sessionUsageUpdate)
          usage = mergeAcpUsage(usage, notification.params, source.connectionId)
      }
    )
    updates.length = 0
    bytes = 0
    const finishReplay = this.processManager.beginReplay(remoteId, source.connectionId)
    const timeout = setTimeout(
      () => source.connection.close(new Error('ACP fork history timed out')),
      30_000
    )
    try {
      await source.connection.request(LODY_EXTENSION_METHODS.sessionHistoryRead, {
        sessionId: remoteId
      })
      if (overflow) throw new Error('ACP fork history exceeds the import limit')
      const history = buildAcpHistory(updates, true)
      const state = createAcpExtensionState(source.connectionId, remoteId, source.extensions)
      state.connected = false
      state.history = history
      if (usage) {
        state.usage = { ...usage, inheritedBaseline: structuredClone(usage.modelUsage) }
        state.usage.sinceFork = getAcpUsageSinceFork(state.usage)
      } else state.inheritedUsageUnknown = true
      await this.persistence.saveSessionData(
        targetId,
        source.agentId,
        remoteId,
        source.workdir,
        'idle',
        { acpExtensions: state, acpForkSource: sourceId }
      )
      return { history, remoteSessionId: remoteId, agentId: source.agentId }
    } catch (error) {
      source.connection.close(error)
      throw error
    } finally {
      clearTimeout(timeout)
      detachUpdates()
      detachExtensions()
      finishReplay()
    }
  }

  async readHistory(conversationId: AppSessionId) {
    const session = this.requireSession(conversationId)
    if (!session.extensions?.sessionHistory || this.historyReads.has(conversationId))
      throw new Error('ACP history is unavailable')
    const staged = { updates: [] as schema.SessionNotification[], bytes: 0, overflow: false }
    const finishReplay = this.processManager.beginReplay(session.sessionId, session.connectionId)
    this.historyReads.set(conversationId, staged)
    const timeout = setTimeout(
      () => session.connection.close(new Error('ACP history replay timed out')),
      30_000
    )
    try {
      await session.connection.request(LODY_EXTENSION_METHODS.sessionHistoryRead, {
        sessionId: session.sessionId
      })
      if (
        this.sessionManager.getSession(conversationId) !== session ||
        session.connection.signal?.aborted
      )
        throw new Error('ACP session changed during history replay')
      if (staged.overflow) throw new Error('ACP history exceeds the preview limit')
      const verified = hasVerifiedHistoryBoundary(session.agentInfo)
      const history = buildAcpHistory(staged.updates, verified)
      this.saveExtensionState(conversationId, session, { ...this.extensionState(session), history })
      return history
    } catch (error) {
      session.connection.close(error)
      throw error
    } finally {
      clearTimeout(timeout)
      this.historyReads.delete(conversationId)
      finishReplay()
    }
  }

  async controlGoal(conversationId: AppSessionId, action: 'pause' | 'clear'): Promise<void> {
    const session = this.requireSession(conversationId)
    const capability = session.extensions?.goal
    if (!capability?.actions.includes(action) || !capability.controlActions?.includes(action))
      throw new Error('ACP goal action is unavailable')
    const result = z.object({ goal: acpGoalSchema.nullable() }).parse(
      await session.connection.request(LODY_EXTENSION_METHODS.sessionGoal, {
        sessionId: session.sessionId,
        action
      })
    )
    this.saveExtensionState(conversationId, session, {
      ...this.extensionState(session),
      goal: result.goal
    })
  }

  async steer(
    conversationId: AppSessionId,
    steerId: string,
    prompt: schema.ContentBlock[],
    settled: (status: 'applied' | 'failed' | 'unknown') => void
  ): Promise<void> {
    const session = this.requireSession(conversationId)
    const capability = session.extensions?.steering
    if (
      capability?.transport !== 'request' ||
      capability.upstreamTurn !== 'same' ||
      capability.configPolicy !== 'active'
    )
      throw new Error('ACP request steering is unavailable')
    const key = `${conversationId}:${steerId}`
    if (this.pendingSteers.size >= 64) throw new Error('Too many pending steer requests')
    if (this.pendingSteers.has(key)) throw new Error('Duplicate steer request')
    this.pendingSteers.set(key, { conversationId, settle: settled })
    const steers = Object.fromEntries(
      Object.entries(this.extensionState(session).steers)
        .filter(([, status]) => status === 'accepted')
        .concat(
          Object.entries(this.extensionState(session).steers)
            .filter(([, status]) => status !== 'accepted')
            .slice(-192)
        )
    )
    this.saveExtensionState(conversationId, session, {
      ...this.extensionState(session),
      steers: { ...steers, [steerId]: 'accepted' }
    })
    const cancellation = new AbortController()
    const timeout = setTimeout(() => cancellation.abort(), 30_000)
    try {
      const response = z
        .object({ outcome: z.enum(['injected', 'failed']) })
        .parse(
          await awaitWithAbort(
            session.connection.request(
              LODY_EXTENSION_METHODS.sessionSteer,
              { sessionId: session.sessionId, steerId, prompt },
              { cancellationSignal: cancellation.signal }
            ),
            cancellation.signal
          )
        )
      if (response.outcome === 'failed') this.settleSteer(conversationId, steerId, 'failed')
    } catch {
      this.settleSteer(conversationId, steerId, 'unknown')
    } finally {
      clearTimeout(timeout)
    }
  }

  finishSteers(conversationId: AppSessionId): void {
    for (const [key, entry] of this.pendingSteers)
      if (entry.conversationId === conversationId)
        this.settleSteer(conversationId, key.slice(conversationId.length + 1), 'unknown')
  }

  private settleSteer(
    conversationId: AppSessionId,
    steerId: string,
    status: 'applied' | 'failed' | 'unknown'
  ): void {
    const key = `${conversationId}:${steerId}`
    const entry = this.pendingSteers.get(key)
    if (!entry) return
    this.pendingSteers.delete(key)
    const session = this.sessionManager.getSession(conversationId)
    if (session)
      this.saveExtensionState(conversationId, session, {
        ...this.extensionState(session),
        steers: { ...this.extensionState(session).steers, [steerId]: status }
      })
    entry.settle(status)
  }

  async refreshRateLimits(
    conversationId: AppSessionId,
    filters: { accountId?: string; modelId?: string } = {}
  ) {
    const session = this.requireSession(conversationId)
    if (!session.extensions?.rateLimits?.query)
      throw new Error('ACP rate limit queries are unavailable')
    const result = acpRateLimitsSchema.parse(
      await session.connection.request(LODY_EXTENSION_METHODS.rateLimitsGet, {
        sessionId: session.sessionId,
        ...filters
      })
    )
    this.saveExtensionState(conversationId, session, {
      ...this.extensionState(session),
      rateLimits: result
    })
    return result
  }

  async listRemoteTasks(conversationId: AppSessionId) {
    const session = this.requireSession(conversationId)
    if (!session.extensions?.subagents?.list) throw new Error('ACP task listing is unavailable')
    const result = acpRemoteTasksSchema.parse(
      await session.connection.request(LODY_EXTENSION_METHODS.subagentsList, {
        sessionId: session.sessionId
      })
    )
    this.saveExtensionState(conversationId, session, {
      ...this.extensionState(session),
      remoteTasks: result.tasks,
      tasksStale: false,
      freshTaskIds: result.tasks.map((task) => task.taskId)
    })
    return result
  }

  async controlRemoteTask(
    conversationId: AppSessionId,
    taskId: string,
    action: 'output' | 'cancel',
    tail = 32_768
  ) {
    const session = this.requireSession(conversationId)
    const state = this.extensionState(session)
    const taskStatus =
      state.remoteTasks.find((task) => task.taskId === taskId)?.status ??
      state.tasks[taskId]?.status
    if (action === 'cancel' && !['running', 'pending', 'in_progress'].includes(taskStatus ?? ''))
      throw new Error('ACP task control is unavailable')
    const known =
      state.remoteTasks.some((task) => task.taskId === taskId) ||
      Object.values(state.tasks).some((task) => task.taskId === taskId && task.kind === 'subagent')
    const runs = Object.values(state.runs).filter((run) => run.taskId === taskId)
    if (
      !known ||
      !state.freshTaskIds?.includes(taskId) ||
      !session.extensions?.subagents?.[action] ||
      runs.some(
        (run) =>
          !run.snapshot ||
          (action === 'cancel'
            ? !run.snapshot.support.cancel || !['pending', 'running'].includes(run.snapshot.state)
            : run.snapshot.support.outputRead === 'none' ||
              (run.snapshot.support.outputRead === 'final_tail' &&
                ['pending', 'running'].includes(run.snapshot.state)))
      )
    ) {
      throw new Error('ACP task control is unavailable')
    }
    if (action === 'cancel') {
      await session.connection.request(LODY_EXTENSION_METHODS.subagentsCancel, {
        sessionId: session.sessionId,
        taskId
      })
      return { output: '' }
    }
    const result = z.object({ output: z.string().max(1_048_576) }).parse(
      await session.connection.request(LODY_EXTENSION_METHODS.subagentsOutput, {
        sessionId: session.sessionId,
        taskId,
        tail: Math.min(Math.max(tail, 1), 65_536)
      })
    )
    return {
      output: this.processManager.elicitation
        .redact(session.connectionId, result.output)
        .slice(-65_536)
    }
  }

  async readPlanFile(conversationId: AppSessionId, planId: string) {
    const session = this.requireSession(conversationId)
    const plan = this.extensionState(session).plans[planId]
    if (plan?.type !== 'file') throw new Error('ACP file plan is unavailable')
    const url = new URL(plan.uri)
    if (url.protocol !== 'file:') throw new Error('ACP plans must reference a local file')
    const response = await new AcpFsHandler({
      workspaceRoot: session.workdir,
      maxReadSize: 262_144
    }).readTextFile({ sessionId: session.sessionId, path: fileURLToPath(url) })
    return {
      content: this.processManager.elicitation.redact(session.connectionId, response.content)
    }
  }

  private extensionState(session: AcpSessionRecord): AcpExtensionState {
    const current = session.metadata?.acpExtensions as AcpExtensionState | undefined
    return current?.version === 1
      ? current
      : createAcpExtensionState(session.connectionId, session.sessionId, session.extensions ?? {})
  }

  private saveExtensionState(
    conversationId: AppSessionId,
    session: AcpSessionRecord,
    state: AcpExtensionState,
    defer = false
  ): void {
    const current = this.sessionManager.getSession(conversationId)
    if (current !== session && (current || state.connected)) return
    const next = { ...state, revision: state.revision + 1 }
    session.metadata = { ...session.metadata, acpExtensions: next }
    const write = () => {
      this.events?.extensionsChanged?.({
        conversationId,
        agentId: session.agentId,
        revision: this.extensionState(session).revision
      })
      this.pendingStateWrites.delete(conversationId)
      void this.persistence
        .mergeMetadata(
          conversationId,
          session.agentId,
          { acpExtensions: this.extensionState(session) },
          session.sessionId
        )
        .catch(() => console.warn('[ACP] Failed to persist extension state'))
    }
    if (defer) {
      if (!this.pendingStateWrites.has(conversationId))
        this.pendingStateWrites.set(conversationId, setTimeout(write, 200))
    } else {
      clearTimeout(this.pendingStateWrites.get(conversationId))
      write()
    }
  }

  private handleExtension(
    conversationId: AppSessionId,
    notification: AcpExtensionNotification
  ): void {
    const session = this.sessionManager.getSession(conversationId)
    if (!session || this.historyReads.has(conversationId)) return
    const state = { ...this.extensionState(session) }
    const { params } = notification
    if ('sessionId' in params && params.sessionId !== session.sessionId) return
    switch (notification.method) {
      case LODY_EXTENSION_METHODS.sessionUsageUpdate:
        state.usage = mergeAcpUsage(state.usage, notification.params, session.connectionId)
        break
      case LODY_EXTENSION_METHODS.rateLimitsUpdate:
        state.rateLimits = notification.params
        break
      case LODY_EXTENSION_METHODS.sessionSteerApplied:
        if (!Object.hasOwn(state.steers, notification.params.steerId)) return
        this.settleSteer(conversationId, notification.params.steerId, 'applied')
        return
      case LODY_EXTENSION_METHODS.subagentEvent: {
        const event = notification.params
        if (!Object.hasOwn(state.runs, event.runId) && Object.keys(state.runs).length >= 64) return
        const run: AcpSubagentRun = {
          ...(Object.hasOwn(state.runs, event.runId) ? state.runs[event.runId] : undefined),
          runId: event.runId,
          blocks: Object.hasOwn(state.runs, event.runId) ? state.runs[event.runId].blocks : []
        }
        const key = `${conversationId}:${event.runId}`
        for (const [pendingKey, pending] of this.pendingRunEvents)
          if (Date.now() - pending.at >= 10_000) this.pendingRunEvents.delete(pendingKey)
        if (event.type !== 'snapshot' && !run.snapshot) {
          const pending = this.pendingRunEvents.get(key) ?? { at: Date.now(), events: [] }
          if (
            this.pendingRunEvents.size < 64 &&
            pending.events.length < 16 &&
            Date.now() - pending.at < 10_000 &&
            JSON.stringify(pending.events).length + JSON.stringify(event).length < 65_536
          ) {
            pending.events.push(event)
            this.pendingRunEvents.set(key, pending)
          }
          return
        }
        if (event.type === 'snapshot') {
          run.snapshot = event.snapshot
          run.outputIncomplete ||= event.snapshot.outputIncomplete
        } else if (event.type === 'progress') {
          if (!run.snapshot?.support.progress) return
          run.progress = { ...run.progress, ...event.progress }
        } else {
          const kind = {
            agent_message_chunk: 'text',
            agent_thought_chunk: 'thought',
            tool_call: 'tool',
            tool_call_update: 'tool',
            plan: 'plan'
          } as const
          if (!run.snapshot?.support.stream.includes(kind[event.update.sessionUpdate])) return
          let streaming = this.runStreams.get(key)
          if (!streaming) {
            const stream = createState()
            stream.blocks = structuredClone(run.blocks)
            streaming = { mapper: new AcpContentMapper(), stream }
            this.runStreams.set(key, streaming)
          }
          if (
            JSON.stringify(streaming.stream.blocks).length + JSON.stringify(event.update).length >
              65_536 ||
            streaming.stream.blocks.length >= 128
          )
            run.outputIncomplete = true
          else {
            const mapped = streaming.mapper.map(
              { sessionId: session.sessionId, update: event.update },
              key
            )
            mapped.events
              .filter(
                (event) =>
                  event.type !== 'reasoning' ||
                  (notification.params.type === 'output' &&
                    notification.params.update.sessionUpdate === 'agent_thought_chunk')
              )
              .forEach((event) => accumulate(streaming!.stream, event))
            if (streaming.stream.latestAgentPlanSnapshot)
              run.plan = streaming.stream.latestAgentPlanSnapshot.plan
            run.blocks = structuredClone(streaming.stream.blocks)
          }
        }
        const candidates = Object.values(state.tasks).filter(
          (task) =>
            task.kind === 'subagent' &&
            task.parentToolCallId &&
            task.parentToolCallId === run.snapshot?.parentToolCallId
        )
        if (candidates.length === 1) run.taskId = candidates[0].taskId
        state.runs = { ...state.runs, [event.runId]: run }
        if (event.type === 'snapshot') {
          const pending = this.pendingRunEvents.get(key)
          this.pendingRunEvents.delete(key)
          if (pending) {
            this.saveExtensionState(conversationId, session, state)
            if (Date.now() - pending.at < 10_000)
              pending.events.forEach((params) =>
                this.handleExtension(conversationId, {
                  method: LODY_EXTENSION_METHODS.subagentEvent,
                  params
                })
              )
            return
          }
        }
        break
      }
    }
    this.saveExtensionState(
      conversationId,
      session,
      state,
      notification.method === LODY_EXTENSION_METHODS.subagentEvent &&
        notification.params.type === 'output'
    )
  }

  private handleSessionUpdate(
    conversationId: AppSessionId,
    agentId: string,
    notification: schema.SessionNotification,
    onEvents?: (events: readonly LLMCoreStreamEvent[]) => void
  ): void {
    const staged = this.historyReads.get(conversationId)
    if (staged) {
      staged.bytes += JSON.stringify(notification).length
      if (staged.updates.length >= 8192 || staged.bytes > 8_388_608) staged.overflow = true
      else staged.updates.push(notification)
      return
    }
    const mapped = this.contentMapper.map(notification, conversationId)
    if (mapped.events.length > 0) onEvents?.(mapped.events)

    const session = this.sessionManager.getSession(conversationId)
    if (!session) return
    const meta = readLodySessionMeta(notification.update._meta)
    const update = notification.update
    if (
      mapped.usage ||
      mapped.sessionInfo ||
      Object.keys(meta).length ||
      ['plan', 'plan_update', 'plan_removed'].includes(update.sessionUpdate)
    ) {
      const state = { ...this.extensionState(session) }
      if (mapped.usage)
        state.context = {
          used: mapped.usage.used,
          size: mapped.usage.size,
          cost: mapped.usage.cost
        }
      if (mapped.sessionInfo && mapped.sessionInfo.title !== undefined)
        state.title = mapped.sessionInfo.title
      if (meta.titleSource) state.titleSource = meta.titleSource
      if (
        session.extensions?.sessionTitle &&
        mapped.sessionInfo?.title?.trim() &&
        !session.metadata?.acpTitleManual
      ) {
        const expected = session.metadata?.acpTitleApplied ?? session.metadata?.acpTitleBaseline
        if (typeof expected === 'string' && this.events?.applyTitle) {
          const title = mapped.sessionInfo.title.trim().slice(0, 200)
          const patch = this.events.applyTitle(conversationId, expected, title)
            ? { acpTitleApplied: title }
            : { acpTitleManual: true }
          session.metadata = { ...session.metadata, ...patch }
          void this.persistence
            .mergeMetadata(conversationId, agentId, patch, session.sessionId)
            .catch(() => console.warn('[ACP] Failed to persist title ownership'))
        }
      }
      if (Object.hasOwn(meta, 'goal')) state.goal = meta.goal
      if (meta.activity) state.activity = meta.activity
      if (meta.notice) state.notice = meta.notice
      if (
        meta.task &&
        (Object.hasOwn(state.tasks, meta.task.taskId) || Object.keys(state.tasks).length < 256)
      ) {
        state.tasks = { ...state.tasks, [meta.task.taskId]: meta.task }
        state.freshTaskIds = [...new Set([...(state.freshTaskIds ?? []), meta.task.taskId])].slice(
          -256
        )
        state.runs = Object.fromEntries(
          Object.entries(state.runs).map(([id, run]) => {
            const matches = Object.values(state.tasks).filter(
              (task) =>
                task.kind === 'subagent' &&
                task.parentToolCallId &&
                task.parentToolCallId === run.snapshot?.parentToolCallId
            )
            return [id, { ...run, taskId: matches.length === 1 ? matches[0].taskId : undefined }]
          })
        )
      }
      if (update.sessionUpdate === 'plan')
        state.plans = {
          ...state.plans,
          legacy: { type: 'items', planId: 'legacy', entries: update.entries }
        }
      if (
        update.sessionUpdate === 'plan_update' &&
        update.plan.planId.length <= 256 &&
        JSON.stringify(update.plan).length < 262_144 &&
        (Object.hasOwn(state.plans, update.plan.planId) || Object.keys(state.plans).length < 32)
      )
        state.plans = { ...state.plans, [update.plan.planId]: update.plan }
      if (update.sessionUpdate === 'plan_removed') {
        state.plans = { ...state.plans }
        delete state.plans[update.planId]
      }
      this.saveExtensionState(conversationId, session, state)
    }
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
        ...(mapped.sessionInfo ? { acpSessionInfo: mapped.sessionInfo } : {}),
        ...(mapped.usage ? { acpUsage: mapped.usage } : {})
      }
      session.metadata = { ...session.metadata, ...metadata }
      void this.persistence
        .mergeMetadata(conversationId, agentId, metadata, session.sessionId)
        .catch((error) => {
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
