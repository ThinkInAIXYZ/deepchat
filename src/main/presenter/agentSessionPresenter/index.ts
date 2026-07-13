import logger from '@shared/logger'
import type { AgentManager } from '@/agent/manager/agentManager'
import type { DirectAcpSessionHandle } from '@/agent/manager/sessionHandles'
import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  AgentTransferBlockReason,
  AgentTransferImpact,
  AgentTransferImpactSample,
  ChatMessagePageResult,
  SessionListItem,
  SessionLightweightListResult,
  SessionPageCursor,
  CreateSessionInput,
  CreateDetachedSessionInput,
  SessionRecord,
  SessionWithState,
  ChatMessageRecord,
  MessagePageCursor,
  MessageTraceRecord,
  MessageStartResult,
  MessageFile,
  SendMessageInput,
  UserMessageContent,
  AssistantMessageBlock,
  PermissionMode,
  SessionCompactionState,
  SessionGenerationSettings,
  DeepChatSubagentMeta,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type {
  AcpConfigState,
  IConfigPresenter,
  ILlmProviderPresenter,
  ISkillPresenter
} from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import { AppSessionService } from '@/agent/shared/appSessionService'
import type { AgentSharedDataPorts } from '@/agent/shared/agentSharedData'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { resolveAssistantModelSelection } from '@/agent/shared/assistantModelSelection'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type {
  AcpAsLlmProviderSessionControlPort,
  SessionPermissionPort,
  SessionUiPort
} from '../runtimePorts'

type AgentTransferTargetContext = {
  agentId: string
  agentType: 'deepchat'
  providerId: string
  modelId: string
  projectDir: string | null
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools: string[]
  subagentEnabled: boolean
}

const SUBAGENT_SESSION_INIT_MAX_ATTEMPTS = 2
function normalizePermissionMode(mode: PermissionMode | null | undefined): PermissionMode {
  return mode === 'default' || mode === 'auto_approve' ? mode : 'full_access'
}

const RETIRED_DEFAULT_AGENT_TOOLS = new Set(['find', 'ls'])
const LEGACY_AGENT_TOOL_NAME_MAP: Record<string, string> = {
  yo_browser_cdp_send: 'cdp_send',
  yo_browser_window_open: 'load_url',
  yo_browser_window_list: 'get_browser_status'
}

export class AgentSessionPresenter {
  private agentManager: AgentManager
  private sessionManager: AppSessionService
  private sqlitePresenter: SQLitePresenter
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private sharedData: AgentSharedDataPorts
  private skillPresenter?: Pick<ISkillPresenter, 'setActiveSkills' | 'clearNewAgentSessionSkills'>
  private acpAsLlmProviderSessionControl?: AcpAsLlmProviderSessionControlPort
  private sessionPermissionPort?: SessionPermissionPort
  private sessionUiPort?: SessionUiPort
  private readonly sessionStatusSnapshots = new Map<string, SessionWithState['status']>()

  constructor(
    agentManager: AgentManager,
    appSessionService: AppSessionService,
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    sharedData: AgentSharedDataPorts,
    skillPresenter?: Pick<ISkillPresenter, 'setActiveSkills' | 'clearNewAgentSessionSkills'>,
    runtimePorts?: {
      acpAsLlmProviderSessionControl?: AcpAsLlmProviderSessionControlPort
      sessionPermissionPort?: SessionPermissionPort
      sessionUiPort?: SessionUiPort
    }
  ) {
    this.agentManager = agentManager
    this.sqlitePresenter = sqlitePresenter
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.sharedData = sharedData
    this.skillPresenter = skillPresenter
    this.sessionManager = appSessionService
    this.acpAsLlmProviderSessionControl = runtimePorts?.acpAsLlmProviderSessionControl
    this.sessionPermissionPort = runtimePorts?.sessionPermissionPort
    this.sessionUiPort = runtimePorts?.sessionUiPort
  }

  // ---- IPC-facing methods ----

  async createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState> {
    const requestedAgentId = input.agentId || 'deepchat'
    const resolvedAgent = this.agentManager.resolveBackend(requestedAgentId)
    const agentId = resolvedAgent.descriptor.id
    logger.info(
      `[AgentSessionPresenter] createSession agent=${agentId} webContentsId=${webContentsId}`
    )
    const normalizedInput = this.normalizeCreateSessionInput(input)
    const agentType = resolvedAgent.kind
    const deepChatAgentConfig =
      agentType === 'deepchat' ? await this.resolveDeepChatAgentConfigCompat(agentId) : null
    const projectDir = this.resolveCreateSessionProjectDir(
      input.projectDir,
      deepChatAgentConfig?.defaultProjectPath
    )
    const disabledAgentTools =
      agentType === 'deepchat'
        ? this.normalizeDisabledAgentTools(
            input.disabledAgentTools ?? deepChatAgentConfig?.disabledAgentTools
          )
        : []
    const subagentEnabled = this.resolveSessionSubagentEnabled(
      agentType,
      input.subagentEnabled,
      deepChatAgentConfig?.subagentEnabled
    )

    // Resolve provider/model
    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId =
      agentType === 'acp'
        ? 'acp'
        : (input.providerId ??
          deepChatAgentConfig?.defaultModelPreset?.providerId ??
          defaultModel?.providerId ??
          '')
    const modelId =
      agentType === 'acp'
        ? agentId
        : (input.modelId ??
          deepChatAgentConfig?.defaultModelPreset?.modelId ??
          defaultModel?.modelId ??
          '')
    const permissionMode =
      input.permissionMode !== undefined
        ? normalizePermissionMode(input.permissionMode)
        : normalizePermissionMode(deepChatAgentConfig?.permissionMode)
    const generationSettings = this.mergeDeepChatDefaultGenerationSettings(
      deepChatAgentConfig,
      input.generationSettings
    )
    logger.info(`[AgentSessionPresenter] resolved provider=${providerId} model=${modelId}`)

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }
    this.assertAcpSessionHasWorkdir(providerId, projectDir)

    // Create session record
    const title = normalizedInput.text.slice(0, 50) || 'New Chat'
    const sessionId = this.sessionManager.create(agentId, title, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled
    })
    logger.info(`[AgentSessionPresenter] session created id=${sessionId} title="${title}"`)

    // Initialize agent-side session
    const initConfig: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir: string | null
      permissionMode: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    } = {
      agentId,
      providerId,
      modelId,
      projectDir,
      permissionMode
    }
    if (generationSettings) {
      initConfig.generationSettings = generationSettings
    }
    try {
      await this.initializeSessionRuntime(sessionId, initConfig)
    } catch (error) {
      await this.cleanupFailedSessionInitialization(sessionId, providerId)
      throw error
    }
    logger.info(`[AgentSessionPresenter] agent.initSession done`)

    // Bind to window and emit activated
    this.sessionManager.bindWindow(webContentsId, toAppSessionId(sessionId))
    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'created',
      activeSessionId: sessionId,
      webContentsId
    })

    // Return enriched session first
    const { handle } = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId))
    const state = await handle.snapshot()
    const sessionResult: SessionWithState = {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled,
      subagentMeta: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }

    // Start the first message (non-blocking) after returning session ID.
    const hasInitialTurn =
      normalizedInput.text.trim().length > 0 || (normalizedInput.files?.length ?? 0) > 0
    if (hasInitialTurn) {
      logger.info(`[AgentSessionPresenter] firing initial send (non-blocking)`)
      handle
        .send({
          content: this.withInitialMessageActiveSkills(normalizedInput, input.activeSkills),
          context: { projectDir },
          queue: { source: 'send', projectDir }
        })
        .catch((err) => {
          console.error('[AgentSessionPresenter] initial send failed:', err)
        })
      void this.generateSessionTitle(sessionId, title, providerId, modelId)
    }

    return sessionResult
  }

  async createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState> {
    const requestedAgentId = input.agentId?.trim() || 'deepchat'
    const resolvedAgent = this.agentManager.resolveBackend(requestedAgentId)
    const agentId = resolvedAgent.descriptor.id
    const title = input.title?.trim() || 'New Chat'
    const agentType = resolvedAgent.kind
    const deepChatAgentConfig =
      agentType === 'deepchat' ? await this.resolveDeepChatAgentConfigCompat(agentId) : null
    const projectDir =
      input.projectDir?.trim() ||
      deepChatAgentConfig?.defaultProjectPath?.trim() ||
      this.getDefaultProjectPathCompat() ||
      null
    const disabledAgentTools =
      agentType === 'deepchat'
        ? this.normalizeDisabledAgentTools(
            input.disabledAgentTools ?? deepChatAgentConfig?.disabledAgentTools
          )
        : []
    const subagentEnabled = this.resolveSessionSubagentEnabled(
      agentType,
      input.subagentEnabled,
      deepChatAgentConfig?.subagentEnabled
    )
    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId =
      agentType === 'acp'
        ? 'acp'
        : (input.providerId ??
          deepChatAgentConfig?.defaultModelPreset?.providerId ??
          defaultModel?.providerId ??
          '')
    const modelId =
      agentType === 'acp'
        ? agentId
        : (input.modelId ??
          deepChatAgentConfig?.defaultModelPreset?.modelId ??
          defaultModel?.modelId ??
          '')
    const permissionMode =
      input.permissionMode !== undefined
        ? normalizePermissionMode(input.permissionMode)
        : normalizePermissionMode(deepChatAgentConfig?.permissionMode)
    const generationSettings = this.mergeDeepChatDefaultGenerationSettings(
      deepChatAgentConfig,
      input.generationSettings
    )

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }
    this.assertAcpSessionHasWorkdir(providerId, projectDir)

    const sessionId = this.sessionManager.create(agentId, title, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled,
      metadata: input.metadata ?? null
    })

    try {
      await this.initializeSessionRuntime(sessionId, {
        agentId,
        providerId,
        modelId,
        projectDir,
        permissionMode,
        generationSettings
      })
    } catch (error) {
      await this.cleanupFailedSessionInitialization(sessionId, providerId)
      throw error
    }

    if (input.activeSkills && input.activeSkills.length > 0 && this.skillPresenter) {
      await this.skillPresenter.setActiveSkills(sessionId, input.activeSkills)
    }

    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'created'
    })

    const state = await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.snapshot()
    return {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled,
      subagentMeta: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }
  }

  async createSubagentSession(input: {
    parentSessionId: string
    agentId: string
    slotId: string
    displayName: string
    targetAgentId?: string | null
    projectDir?: string | null
    providerId: string
    modelId: string
    permissionMode: PermissionMode
    generationSettings?: Partial<SessionGenerationSettings>
    disabledAgentTools?: string[]
    activeSkills?: string[]
  }): Promise<SessionWithState> {
    const parentSessionId = input.parentSessionId?.trim()
    if (!parentSessionId) {
      throw new Error('Subagent session requires a parentSessionId.')
    }

    const slotId = input.slotId?.trim()
    if (!slotId) {
      throw new Error('Subagent session requires a slotId.')
    }

    const displayName = input.displayName?.trim() || 'Subagent'
    const agentId = input.agentId?.trim()
    if (!agentId) {
      throw new Error('Subagent session requires an agentId.')
    }

    const runtimeConfig = await this.resolveSubagentSessionRuntimeConfig(input)
    const projectDir = input.projectDir?.trim() || null
    const subagentMeta: DeepChatSubagentMeta = {
      slotId,
      displayName,
      targetAgentId: runtimeConfig.targetAgentId || null
    }
    this.assertAcpSessionHasWorkdir(runtimeConfig.providerId, projectDir)

    let lastError: unknown = null

    for (let attempt = 1; attempt <= SUBAGENT_SESSION_INIT_MAX_ATTEMPTS; attempt += 1) {
      const sessionId = this.sessionManager.create(runtimeConfig.agentId, displayName, projectDir, {
        isDraft: false,
        disabledAgentTools: runtimeConfig.disabledAgentTools,
        subagentEnabled: false,
        sessionKind: 'subagent',
        parentSessionId,
        subagentMeta
      })

      try {
        await this.initializeSessionRuntime(sessionId, {
          agentId: runtimeConfig.agentId,
          providerId: runtimeConfig.providerId,
          modelId: runtimeConfig.modelId,
          projectDir,
          permissionMode: input.permissionMode,
          generationSettings: runtimeConfig.generationSettings
        })

        if (runtimeConfig.activeSkills.length > 0 && this.skillPresenter) {
          await this.skillPresenter.setActiveSkills(sessionId, runtimeConfig.activeSkills)
        }

        const record = this.sessionManager.get(sessionId)
        if (!record) {
          throw new Error(`Subagent session not found after creation: ${sessionId}`)
        }

        const session = (await this.buildSessionWithState(record)) as SessionWithState
        this.emitSessionListUpdated({
          sessionIds: [session.id],
          reason: 'created'
        })
        return session
      } catch (error) {
        lastError = error
        await this.cleanupFailedSessionInitialization(sessionId, runtimeConfig.providerId)

        if (attempt >= SUBAGENT_SESSION_INIT_MAX_ATTEMPTS) {
          throw error
        }

        console.warn(
          `[AgentSessionPresenter] Retrying subagent session initialization (${attempt}/${SUBAGENT_SESSION_INIT_MAX_ATTEMPTS - 1} retry used) for agent=${runtimeConfig.agentId} slot=${slotId}:`,
          error
        )
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to create subagent session for slot ${slotId}.`)
  }

  async ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState> {
    const agentId = input.agentId?.trim()
    if (!agentId) {
      throw new Error('ACP draft session requires an agentId.')
    }

    const projectDir = input.projectDir?.trim()
    if (!projectDir) {
      throw new Error('ACP draft session requires a non-empty projectDir.')
    }

    const resolvedAgent = this.agentManager.resolveBackend(agentId)
    if (resolvedAgent.kind !== 'acp') {
      throw new Error(`Agent ${agentId} is not an ACP agent.`)
    }
    const canonicalAgentId = resolvedAgent.descriptor.id
    const permissionMode = normalizePermissionMode(input.permissionMode)

    let record = await this.findReusableDraftSession(canonicalAgentId, projectDir)
    let createdDraftSession = false
    if (!record) {
      const sessionId = this.sessionManager.create(canonicalAgentId, 'New Chat', projectDir, {
        isDraft: true,
        subagentEnabled: false
      })
      try {
        await this.ensureSessionRuntimeInitialized(sessionId, {
          agentId: canonicalAgentId,
          providerId: 'acp',
          modelId: canonicalAgentId,
          projectDir,
          permissionMode
        })
      } catch (error) {
        await this.cleanupFailedSessionInitialization(sessionId, 'acp')
        throw error
      }
      record = this.sessionManager.get(sessionId)
      if (!record) {
        throw new Error(`Failed to read created ACP draft session: ${sessionId}`)
      }
      createdDraftSession = true
    } else {
      await this.ensureSessionRuntimeInitialized(record.id, {
        agentId: canonicalAgentId,
        providerId: 'acp',
        modelId: canonicalAgentId,
        projectDir,
        permissionMode
      })
    }

    const handle = this.requireDirectAcpHandle(record.id)
    await handle.acp.prepare()
    this.emitSessionListUpdated({
      sessionIds: [record.id],
      reason: createdDraftSession ? 'created' : 'updated'
    })

    const state = await this.agentManager
      .resolveSessionHandle(toAppSessionId(record.id))
      .handle.snapshot()
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? 'acp',
      modelId: state?.modelId ?? canonicalAgentId
    }
  }

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult> {
    let session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const wasDraft = session.isDraft
    const normalizedInput = this.normalizeSendMessageInput(content)

    if (session.isDraft) {
      const title = normalizedInput.text.trim().slice(0, 50) || 'New Chat'
      this.sessionManager.update(sessionId, { isDraft: false, title })
      this.emitSessionListUpdated({
        sessionIds: [sessionId],
        reason: 'updated'
      })
      session = this.sessionManager.get(sessionId)
      if (!session) throw new Error(`Session not found: ${sessionId}`)
    }

    const { handle } = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId))
    const state = await handle.snapshot()
    const hadMessages = await this.sharedData.transcript.hasMessages(sessionId)
    let providerId = state?.providerId ?? ''
    if (!providerId && handle.kind === 'acp') providerId = 'acp'
    this.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await this.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      session.agentId,
      session.projectDir ?? null
    )
    const result = await handle.send({
      content: normalizedInput,
      context: {
        projectDir: session.projectDir ?? null,
        maxProviderRounds: options?.maxProviderRounds
      },
      queue: {
        source: 'send',
        projectDir: session.projectDir ?? null
      }
    })
    if (!hadMessages && !wasDraft) {
      void this.generateSessionTitle(sessionId, session.title, providerId, state?.modelId ?? '')
    }
    return result
  }

  async steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    let session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const normalizedInput = this.normalizeSendMessageInput(content)

    if (session.isDraft) {
      const title = normalizedInput.text.trim().slice(0, 50) || 'New Chat'
      this.sessionManager.update(sessionId, { isDraft: false, title })
      this.emitSessionListUpdated({
        sessionIds: [sessionId],
        reason: 'updated'
      })
      session = this.sessionManager.get(sessionId)
      if (!session) throw new Error(`Session not found: ${sessionId}`)
    }

    const { handle } = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId))
    const state = await handle.snapshot()
    let providerId = state?.providerId ?? ''
    if (!providerId && handle.kind === 'acp') providerId = 'acp'
    this.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await this.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      session.agentId,
      session.projectDir ?? null
    )

    await handle.pending.steerActiveTurn(normalizedInput)
  }

  async listPendingInputs(sessionId: string) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      return []
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.pending.list()
  }

  async queuePendingInput(sessionId: string, content: string | SendMessageInput) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    let currentSession = session
    const normalizedInput = this.normalizeSendMessageInput(content)
    if (currentSession.isDraft) {
      const title = normalizedInput.text.trim().slice(0, 50) || 'New Chat'
      this.sessionManager.update(sessionId, { isDraft: false, title })
      this.emitSessionListUpdated({
        sessionIds: [sessionId],
        reason: 'updated'
      })
      currentSession = this.sessionManager.get(sessionId) ?? currentSession
    }

    const { handle } = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId))
    let providerId = (await handle.snapshot())?.providerId ?? ''
    if (!providerId && handle.kind === 'acp') providerId = 'acp'
    this.assertAcpSessionHasWorkdir(providerId, currentSession.projectDir ?? null)
    await this.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      currentSession.agentId,
      currentSession.projectDir ?? null
    )
    return await handle.pending.queue(normalizedInput, {
      source: 'queue',
      projectDir: currentSession.projectDir ?? null
    })
  }

  async updateQueuedInput(sessionId: string, itemId: string, content: string | SendMessageInput) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.pending.update(itemId, this.normalizeSendMessageInput(content))
  }

  async moveQueuedInput(sessionId: string, itemId: string, toIndex: number) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.pending.move(itemId, toIndex)
  }

  async convertPendingInputToSteer(sessionId: string, itemId: string) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.pending.convertToSteer(itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.pending.steer(itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.pending.delete(itemId)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    const prepared = await this.sharedData.transcriptMutation.prepareRetryMessage(
      sessionId,
      messageId
    )
    await handle.send({
      content: prepared.content,
      context: { projectDir: prepared.projectDir, emitRefreshBeforeStream: true }
    })
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    await this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle.cancel()
    await this.sharedData.transcriptMutation.deleteMessage(sessionId, messageId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.sharedData.transcriptMutation.editUserMessage(sessionId, messageId, text)
  }

  async forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState> {
    const sourceSession = this.sessionManager.get(sourceSessionId)
    if (!sourceSession) {
      throw new Error(`Session not found: ${sourceSessionId}`)
    }

    const sourceHandle = this.agentManager.resolveSessionHandle(
      toAppSessionId(sourceSessionId)
    ).handle
    const sourceState = await sourceHandle.snapshot()
    if (!sourceState) {
      throw new Error(`Session state not found: ${sourceSessionId}`)
    }

    const generationSettings = await sourceHandle.settings.getGenerationSettings()

    const title = this.buildForkTitle(sourceSession.title, newTitle)
    const targetSessionId = this.sessionManager.create(
      sourceSession.agentId,
      title,
      sourceSession.projectDir ?? null,
      { isDraft: false }
    )

    try {
      await this.initializeSessionRuntime(targetSessionId, {
        agentId: sourceSession.agentId,
        providerId: sourceState.providerId,
        modelId: sourceState.modelId,
        projectDir: sourceSession.projectDir ?? null,
        permissionMode: sourceState.permissionMode,
        generationSettings: generationSettings ?? undefined
      })
      await this.sharedData.transcriptMutation.forkSessionFromMessage(
        sourceSessionId,
        targetSessionId,
        targetMessageId
      )
    } catch (error) {
      try {
        await this.agentManager.resolveSessionHandle(toAppSessionId(targetSessionId)).handle.close()
      } catch (cleanupError) {
        console.warn(
          `[AgentSessionPresenter] Failed to cleanup forked session runtime ${targetSessionId}:`,
          cleanupError
        )
      }
      this.sessionManager.delete(targetSessionId)
      throw error
    }

    this.emitSessionListUpdated({
      sessionIds: [targetSessionId],
      reason: 'created'
    })

    const record = this.sessionManager.get(targetSessionId)
    if (!record) {
      throw new Error(`Forked session not found: ${targetSessionId}`)
    }

    const targetState = await this.agentManager
      .resolveSessionHandle(toAppSessionId(targetSessionId))
      .handle.snapshot()
    return {
      ...record,
      status: targetState?.status ?? 'idle',
      providerId: targetState?.providerId ?? sourceState.providerId,
      modelId: targetState?.modelId ?? sourceState.modelId
    }
  }

  async getSessionList(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): Promise<SessionWithState[]> {
    const records = this.sessionManager.list(filters)
    const enriched: SessionWithState[] = []

    for (const record of records) {
      const session = await this.tryBuildSessionWithState(record, 'list')
      if (session) {
        enriched.push(session)
      }
    }

    return enriched
  }

  async getLightweightSessionList(options?: {
    limit?: number
    cursor?: SessionPageCursor | null
    includeSubagents?: boolean
    agentId?: string
    prioritizeSessionId?: string
  }): Promise<SessionLightweightListResult> {
    const page = this.sessionManager.listPage({
      limit: options?.limit,
      cursor: options?.cursor,
      agentId: options?.agentId,
      includeSubagents: options?.includeSubagents
    })
    const items = page.records.map((record) => this.mapSessionRecordToListItem(record))

    const prioritizeSessionId = options?.prioritizeSessionId?.trim()
    if (prioritizeSessionId) {
      const prioritizedRecord = this.sessionManager.get(prioritizeSessionId)
      if (prioritizedRecord && this.matchesLightweightFilter(prioritizedRecord, options)) {
        items.unshift(this.mapSessionRecordToListItem(prioritizedRecord))
      }
    }

    const deduped = this.dedupeAndSortSessionListItems(items)
    return {
      items: deduped,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    }
  }

  async getLightweightSessionsByIds(sessionIds: string[]): Promise<SessionListItem[]> {
    const dedupedIds = Array.from(
      new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))
    )
    return this.dedupeAndSortSessionListItems(
      this.sessionManager
        .getMany(dedupedIds)
        .map((record) => this.mapSessionRecordToListItem(record))
    )
  }

  async getSession(sessionId: string): Promise<SessionWithState | null> {
    const record = this.sessionManager.get(sessionId)
    if (!record) return null
    return await this.tryBuildSessionWithState(record)
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return await this.sharedData.transcript.getMessages(sessionId)
  }

  async listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return await this.sharedData.transcript.listMessagesPage(sessionId, options)
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind !== 'deepchat') {
      return {
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    }

    return await handle.deepchat.getCompactionState()
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind !== 'deepchat') {
      throw new Error(`Agent ${session.agentId} does not support manual compaction.`)
    }

    const state = await handle.snapshot()
    if (state?.providerId === 'acp') {
      throw new Error('Manual compaction is only available for DeepChat agent sessions.')
    }

    return await handle.deepchat.compact()
  }

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return await this.sharedData.tape.getTapeInfo(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return await this.sharedData.tape.searchTape(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return await this.sharedData.tape.getTapeContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return await this.sharedData.tape.listTapeAnchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {}
  ): Promise<AgentTapeAnchorResult> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return await this.sharedData.tape.handoffTape(sessionId, name, state)
  }

  async listMessageViewManifests(messageId: string): Promise<DeepChatTapeViewManifestRecord[]> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return []

    const message = this.sqlitePresenter.deepchatMessagesTable.get(normalizedMessageId)
    if (!message) return []

    const session = this.sessionManager.get(message.session_id)
    if (!session) return []

    try {
      return await this.sharedData.tape.listMessageViewManifests(
        message.session_id,
        normalizedMessageId
      )
    } catch (error) {
      logger.warn('[AgentSessionPresenter] Failed to list message view manifests', {
        messageId: normalizedMessageId,
        error
      })
      return []
    }
  }

  async exportMessageTapeReplaySlice(
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return null

    const message = this.sqlitePresenter.deepchatMessagesTable.get(normalizedMessageId)
    if (!message) return null

    const session = this.sessionManager.get(message.session_id)
    if (!session) return null

    try {
      return await this.sharedData.tape.exportMessageTapeReplaySlice(
        message.session_id,
        normalizedMessageId,
        options
      )
    } catch (error) {
      logger.warn('[AgentSessionPresenter] Failed to export tape replay slice', {
        messageId: normalizedMessageId,
        error
      })
      return null
    }
  }

  async mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    const parentSession = this.sessionManager.get(parentSessionId)
    if (!parentSession) {
      throw new Error(`Session not found: ${parentSessionId}`)
    }

    const childSession = this.sessionManager.get(childSessionId)
    if (!childSession) {
      throw new Error(`Session not found: ${childSessionId}`)
    }
    if (childSession.parentSessionId !== parentSessionId) {
      throw new Error(`Session ${childSessionId} is not a child of ${parentSessionId}.`)
    }

    const resolved = this.agentManager.resolveSubagentFacet(toAppSessionId(parentSessionId))
    switch (resolved.kind) {
      case 'deepchat':
        await resolved.facet.mergeTape(
          toAppSessionId(parentSessionId),
          toAppSessionId(childSessionId),
          meta
        )
        break
      case 'acp':
        await resolved.facet.mergeTape(
          toAppSessionId(parentSessionId),
          toAppSessionId(childSessionId),
          meta
        )
        break
    }
  }

  async discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    const parentSession = this.sessionManager.get(parentSessionId)
    if (!parentSession) {
      throw new Error(`Session not found: ${parentSessionId}`)
    }

    const childSession = this.sessionManager.get(childSessionId)
    if (!childSession) {
      throw new Error(`Session not found: ${childSessionId}`)
    }
    if (childSession.parentSessionId !== parentSessionId) {
      throw new Error(`Session ${childSessionId} is not a child of ${parentSessionId}.`)
    }

    const resolved = this.agentManager.resolveSubagentFacet(toAppSessionId(parentSessionId))
    switch (resolved.kind) {
      case 'deepchat':
        await resolved.facet.discardTape(
          toAppSessionId(parentSessionId),
          toAppSessionId(childSessionId),
          meta
        )
        break
      case 'acp':
        await resolved.facet.discardTape(
          toAppSessionId(parentSessionId),
          toAppSessionId(childSessionId),
          meta
        )
        break
    }
  }

  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) {
      return []
    }
    const parsed: SearchResult[] = []
    const rows =
      this.sqlitePresenter.deepchatMessageSearchResultsTable.listByMessageId(normalizedMessageId)
    for (const row of rows) {
      try {
        const result = JSON.parse(row.content) as SearchResult
        parsed.push({
          ...result,
          rank: typeof result.rank === 'number' ? result.rank : (row.rank ?? undefined),
          searchId: result.searchId ?? row.search_id ?? undefined
        })
      } catch (error) {
        console.warn('[AgentSessionPresenter] Failed to parse search result row:', error)
      }
    }

    if (searchId) {
      const filtered = parsed.filter((item) => item.searchId === searchId)
      if (filtered.length > 0) {
        return filtered
      }
      const legacy = parsed.filter((item) => !item.searchId)
      if (legacy.length > 0) {
        return legacy
      }
    }

    return parsed
  }

  async listMessageTraces(messageId: string): Promise<MessageTraceRecord[]> {
    if (!messageId?.trim()) return []
    return this.sqlitePresenter.deepchatMessageTracesTable
      .listByMessageId(messageId)
      .map((row) => ({
        id: row.id,
        messageId: row.message_id,
        sessionId: row.session_id,
        providerId: row.provider_id,
        modelId: row.model_id,
        requestSeq: row.request_seq,
        endpoint: row.endpoint,
        headersJson: row.headers_json,
        bodyJson: row.body_json,
        truncated: row.truncated === 1,
        createdAt: row.created_at
      }))
  }

  async getMessageTraceCount(messageId: string): Promise<number> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return 0
    return this.sqlitePresenter.deepchatMessageTracesTable.countByMessageId(normalizedMessageId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return await this.sharedData.transcript.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return await this.sharedData.transcript.getMessage(messageId)
  }

  async activateSession(webContentsId: number, sessionId: string): Promise<void> {
    this.sessionManager.bindWindow(webContentsId, toAppSessionId(sessionId))
    publishDeepchatEvent('sessions.updated', {
      sessionIds: [sessionId],
      reason: 'activated',
      activeSessionId: sessionId,
      webContentsId
    })
  }

  async deactivateSession(webContentsId: number): Promise<void> {
    this.sessionManager.unbindWindow(webContentsId)
    publishDeepchatEvent('sessions.updated', {
      sessionIds: [],
      reason: 'deactivated',
      activeSessionId: null,
      webContentsId
    })
  }

  async getActiveSession(webContentsId: number): Promise<SessionWithState | null> {
    const sessionId = this.sessionManager.getActiveSessionId(webContentsId)
    if (!sessionId) return null
    const session = await this.getSession(sessionId)
    if (!session) {
      this.sessionManager.unbindWindow(webContentsId)
    }
    return session
  }

  getActiveSessionId(webContentsId: number): string | null {
    return this.sessionManager.getActiveSessionId(webContentsId)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const normalized = title.trim()
    if (!normalized) {
      throw new Error('Session title cannot be empty.')
    }

    this.sessionManager.update(sessionId, { title: normalized })
    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    this.sessionManager.update(sessionId, { isPinned: pinned })
    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    await this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle.cancel()
    await this.sharedData.transcriptMutation.clearMessages(sessionId)
    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const deletedSessionIds = await this.deleteSessionInternal(sessionId)
    this.emitSessionListUpdated({
      sessionIds: deletedSessionIds,
      reason: 'deleted'
    })
  }

  async getAgentTransferImpact(agentId: string): Promise<AgentTransferImpact> {
    const normalizedAgentId = agentId.trim()
    if (!normalizedAgentId) {
      throw new Error('Agent id is required.')
    }

    const sessions = this.sessionManager.list({
      agentId: normalizedAgentId,
      includeSubagents: true
    })
    const samples: AgentTransferImpactSample[] = []
    let emptyDrafts = 0
    let movableSessions = 0
    let blockedSessions = 0

    for (const session of sessions) {
      const assessment = await this.assessTransferSession(session)
      if (assessment.isEmptyDraft) {
        emptyDrafts += 1
      }
      if (assessment.blockReason) {
        blockedSessions += 1
      } else if (!assessment.isEmptyDraft) {
        movableSessions += 1
      }

      if (samples.length < 6 && (!assessment.isEmptyDraft || assessment.blockReason)) {
        samples.push({
          id: session.id,
          title: session.title,
          sessionKind: session.sessionKind,
          isDraft: Boolean(session.isDraft),
          projectDir: session.projectDir,
          status: assessment.status,
          blockReason: assessment.blockReason
        })
      }
    }

    return {
      agentId: normalizedAgentId,
      totalSessions: sessions.length,
      regularSessions: sessions.filter((session) => session.sessionKind === 'regular').length,
      subagentSessions: sessions.filter((session) => session.sessionKind === 'subagent').length,
      emptyDrafts,
      movableSessions,
      blockedSessions,
      samples
    }
  }

  async moveAgentSessions(
    fromAgentId: string,
    toAgentId: string
  ): Promise<{ movedSessionIds: string[]; deletedSessionIds: string[] }> {
    const sourceAgentId = fromAgentId.trim()
    const targetAgentId = toAgentId.trim()
    if (!sourceAgentId || !targetAgentId) {
      throw new Error('Source and target agent ids are required.')
    }
    if (sourceAgentId === targetAgentId) {
      throw new Error('Source and target agents cannot be the same.')
    }
    await this.resolveTransferTargetContext(targetAgentId, null)

    const sessions = this.sessionManager.list({
      agentId: sourceAgentId,
      includeSubagents: true
    })
    const transferSessionIds: string[] = []
    const emptyDraftSessionIds: string[] = []
    const movedSessionIds: string[] = []
    const deletedSessionIds: string[] = []
    const deletedSessionIdSet = new Set<string>()

    for (const session of sessions) {
      const assessment = await this.assessTransferSession(session)
      if (assessment.blockReason) {
        throw new Error(`Session ${session.id} cannot be moved: ${assessment.blockReason}`)
      }
      if (assessment.isEmptyDraft) {
        emptyDraftSessionIds.push(session.id)
        continue
      }

      await this.resolveTransferTargetContext(targetAgentId, session.projectDir)
      transferSessionIds.push(session.id)
    }

    try {
      for (const sessionId of transferSessionIds) {
        if (deletedSessionIdSet.has(sessionId)) {
          continue
        }
        if (!this.sessionManager.get(sessionId)) {
          throw new Error(`Session ${sessionId} is no longer available.`)
        }
        await this.moveSessionToAgentInternal(sessionId, targetAgentId, true)
        movedSessionIds.push(sessionId)
      }

      for (const sessionId of emptyDraftSessionIds) {
        if (deletedSessionIdSet.has(sessionId)) {
          continue
        }
        if (!this.sessionManager.get(sessionId)) {
          throw new Error(`Session ${sessionId} is no longer available.`)
        }
        const deleted = await this.deleteSessionInternal(sessionId)
        deleted.forEach((deletedSessionId) => deletedSessionIdSet.add(deletedSessionId))
        deletedSessionIds.push(...deleted)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const partialCounts = [
        movedSessionIds.length > 0 ? `${movedSessionIds.length} moved` : '',
        deletedSessionIds.length > 0 ? `${deletedSessionIds.length} deleted` : ''
      ].filter(Boolean)

      if (partialCounts.length > 0) {
        if (movedSessionIds.length > 0) {
          this.emitSessionListUpdated({
            sessionIds: movedSessionIds,
            reason: 'updated'
          })
        }
        if (deletedSessionIds.length > 0) {
          this.emitSessionListUpdated({
            sessionIds: deletedSessionIds,
            reason: 'deleted'
          })
        }
        throw new Error(`${message} Partial transfer completed: ${partialCounts.join(', ')}.`)
      }
      throw error
    }

    if (movedSessionIds.length > 0) {
      this.emitSessionListUpdated({
        sessionIds: movedSessionIds,
        reason: 'updated'
      })
    }
    if (deletedSessionIds.length > 0) {
      this.emitSessionListUpdated({
        sessionIds: deletedSessionIds,
        reason: 'deleted'
      })
    }

    return { movedSessionIds, deletedSessionIds }
  }

  async deleteAgentSessions(agentId: string): Promise<string[]> {
    const normalizedAgentId = agentId.trim()
    if (!normalizedAgentId) {
      throw new Error('Agent id is required.')
    }

    const sessions = this.sessionManager.list({
      agentId: normalizedAgentId,
      includeSubagents: true
    })
    const deletedSessionIds: string[] = []
    const deletedSessionIdSet = new Set<string>()

    for (const session of sessions) {
      const assessment = await this.assessTransferSession(session)
      if (assessment.blockReason) {
        throw new Error(`Session ${session.id} cannot be deleted: ${assessment.blockReason}`)
      }
    }

    for (const session of sessions) {
      if (deletedSessionIdSet.has(session.id) || !this.sessionManager.get(session.id)) {
        continue
      }
      const deleted = await this.deleteSessionInternal(session.id)
      deleted.forEach((sessionId) => deletedSessionIdSet.add(sessionId))
      deletedSessionIds.push(...deleted)
    }

    if (deletedSessionIds.length > 0) {
      this.emitSessionListUpdated({
        sessionIds: deletedSessionIds,
        reason: 'deleted'
      })
    }

    return deletedSessionIds
  }

  async moveSessionToAgent(sessionId: string, toAgentId: string): Promise<SessionWithState> {
    const updated = await this.moveSessionToAgentInternal(sessionId, toAgentId)
    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
    return updated
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) return
    await this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle.cancel()
  }

  clearSessionPermissions(sessionId: string): void {
    this.sessionPermissionPort?.clearSessionPermissions(sessionId)
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.toolInteractions.respond(messageId, toolCallId, response)
  }

  async getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    const session = this.sessionManager.get(sessionId)
    if (!session) return []
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind === 'acp') {
      return await handle.acp.getCommands()
    }
    if ((await handle.snapshot())?.providerId !== 'acp') {
      return []
    }
    return await this.requireAcpAsLlmProviderSessionControl().getAcpSessionCommands(sessionId)
  }

  async getAcpSessionConfigOptions(sessionId: string): Promise<AcpConfigState | null> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      return null
    }
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind === 'acp') {
      return await handle.acp.getConfigOptions()
    }
    if ((await handle.snapshot())?.providerId !== 'acp') {
      return null
    }
    return await this.requireAcpAsLlmProviderSessionControl().getAcpSessionConfigOptions(sessionId)
  }

  async setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind === 'acp') {
      return await handle.acp.setConfigOption(configId, value)
    }
    if ((await handle.snapshot())?.providerId !== 'acp') {
      throw new Error('ACP session config options are only available for ACP sessions.')
    }
    return await this.requireAcpAsLlmProviderSessionControl().setAcpSessionConfigOption(
      sessionId,
      configId,
      value
    )
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.settings.getPermissionMode()
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.settings.setPermissionMode(mode)
  }

  async setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<SessionWithState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.sessionKind !== 'regular') {
      throw new Error('Only regular sessions can change subagent state.')
    }

    const { descriptor } = this.agentManager.resolveSessionBackend(toAppSessionId(sessionId))
    if (descriptor.kind !== 'deepchat') {
      throw new Error('Only DeepChat sessions can change subagent state.')
    }

    this.sessionManager.update(sessionId, { subagentEnabled: enabled })
    const updated = this.sessionManager.get(sessionId)
    if (!updated) {
      throw new Error(`Session not found after update: ${sessionId}`)
    }

    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
    const sessionWithState = await this.tryBuildSessionWithState(updated)
    if (!sessionWithState) {
      throw new Error(`Failed to build session state for sessionId: ${sessionId}`)
    }

    return sessionWithState
  }

  async setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<SessionWithState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const nextProviderId = providerId?.trim()
    const nextModelId = modelId?.trim()
    if (!nextProviderId || !nextModelId) {
      throw new Error('setSessionModel requires providerId and modelId.')
    }

    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind !== 'deepchat') {
      throw new Error('ACP session model is locked.')
    }
    await handle.deepchat.setModel(nextProviderId, nextModelId)
    const state = await handle.snapshot()
    const updated: SessionWithState = {
      ...session,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? nextProviderId,
      modelId: state?.modelId ?? nextModelId
    }
    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
    return updated
  }

  async setSessionProjectDir(
    sessionId: string,
    projectDir: string | null
  ): Promise<SessionWithState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    const state = await handle.snapshot()
    const providerId = state?.providerId?.trim() || (handle.kind === 'acp' ? 'acp' : '')
    const normalizedProjectDir = projectDir?.trim() || null
    this.assertAcpSessionHasWorkdir(providerId, normalizedProjectDir)

    this.sessionManager.update(sessionId, { projectDir: normalizedProjectDir })

    // Sync environment for new project dir
    if (normalizedProjectDir) {
      this.sqlitePresenter.newEnvironmentsTable.syncPath(normalizedProjectDir)
    }

    await handle.settings.setProjectDir(normalizedProjectDir)
    await this.syncAcpSessionWorkdir(providerId, sessionId, session.agentId, normalizedProjectDir)

    const updated = this.sessionManager.get(sessionId)
    if (!updated) {
      throw new Error(`Session not found after update: ${sessionId}`)
    }

    this.emitSessionListUpdated({
      sessionIds: [sessionId],
      reason: 'updated'
    })
    const sessionWithState = await this.tryBuildSessionWithState(updated)
    if (!sessionWithState) {
      throw new Error(`Failed to build session state after project update: ${sessionId}`)
    }
    return sessionWithState
  }

  async getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.settings.getGenerationSettings()
  }

  async getSessionDisabledAgentTools(sessionId: string): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return this.sessionManager.getDisabledAgentTools(sessionId)
  }

  async updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const normalized = this.normalizeDisabledAgentTools(disabledAgentTools)
    this.sessionManager.updateDisabledAgentTools(sessionId, normalized)

    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind === 'deepchat') handle.deepchat.invalidateSystemPromptCache()

    return normalized
  }

  async updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.settings.updateGenerationSettings(settings)
  }

  private async generateSessionTitle(
    sessionId: string,
    initialTitle: string,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Promise<void> {
    try {
      const titleMessages = await this.waitForSessionTitleMessages(sessionId)
      if (!titleMessages) return

      const currentSession = this.sessionManager.get(sessionId)
      if (!currentSession) return
      if (currentSession.title !== initialTitle) return

      const assistantSelection = await resolveAssistantModelSelection(
        {
          agentManager: this.agentManager,
          configPresenter: this.configPresenter
        },
        currentSession.agentId,
        fallbackProviderId,
        fallbackModelId
      )
      const preferredProviderId = assistantSelection.providerId
      const preferredModelId = assistantSelection.modelId

      let generatedTitle: string
      try {
        generatedTitle = await this.llmProviderPresenter.summaryTitles(
          titleMessages,
          preferredProviderId,
          preferredModelId
        )
      } catch (error) {
        const shouldFallback =
          preferredProviderId !== fallbackProviderId || preferredModelId !== fallbackModelId
        if (!shouldFallback) throw error
        generatedTitle = await this.llmProviderPresenter.summaryTitles(
          titleMessages,
          fallbackProviderId,
          fallbackModelId
        )
      }

      const normalized = this.normalizeGeneratedTitle(generatedTitle)
      if (!normalized || normalized === initialTitle) return

      const latest = this.sessionManager.get(sessionId)
      if (!latest) return
      if (latest.title !== initialTitle) return

      this.sessionManager.update(sessionId, { title: normalized })
      this.emitSessionListUpdated({
        sessionIds: [sessionId],
        reason: 'updated'
      })
    } catch (error) {
      console.warn(
        `[AgentSessionPresenter] title generation skipped for session=${sessionId}:`,
        error
      )
    }
  }

  private emitSessionListUpdated(
    options: {
      sessionIds?: string[]
      reason?: 'created' | 'updated' | 'deleted' | 'list-refreshed'
      activeSessionId?: string | null
      webContentsId?: number
    } = {}
  ): void {
    const sessionIds = Array.from(
      new Set(options.sessionIds?.map((sessionId) => sessionId.trim()).filter(Boolean) ?? [])
    )
    const reason = options.reason ?? (sessionIds.length > 0 ? 'updated' : 'list-refreshed')

    publishDeepchatEvent('sessions.updated', {
      sessionIds,
      reason,
      activeSessionId: options.activeSessionId,
      webContentsId: options.webContentsId
    })
    this.sessionUiPort?.refreshSessionUi()
  }

  private async waitForSessionTitleMessages(
    sessionId: string
  ): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }> | null> {
    const MAX_WAIT_MS = 30000
    const POLL_MS = 250
    const startedAt = Date.now()
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const readTitleMessages = async () => {
      const titleMessages = this.buildTitleMessages(
        await this.sharedData.transcript.getMessages(sessionId)
      )
      return titleMessages.length > 0 ? titleMessages : null
    }

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      const session = this.sessionManager.get(sessionId)
      if (!session) return null

      const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
      const state = await handle.snapshot()
      if (!state) return null
      if (state.status === 'error') return null
      if (state.status === 'idle') {
        const titleMessages = await readTitleMessages()
        if (titleMessages) {
          return titleMessages
        }
      }

      const remainingMs = MAX_WAIT_MS - (Date.now() - startedAt)
      const ready = await handle.waitForFirstTurnReady({
        timeoutMs: Math.min(POLL_MS, Math.max(0, remainingMs))
      })
      if (!ready) {
        continue
      }

      const titleMessages = await readTitleMessages()
      if (titleMessages) {
        return titleMessages
      }

      await sleep(POLL_MS)
    }

    return null
  }

  private async buildSessionWithState(
    record: SessionRecord,
    mode: 'full' | 'list' = 'full'
  ): Promise<SessionWithState> {
    const state = await this.agentManager
      .resolveSessionHandle(toAppSessionId(record.id))
      .handle.snapshot({ lightweight: mode === 'list' })
    const status = state?.status ?? 'idle'
    this.sessionStatusSnapshots.set(record.id, status)
    return {
      ...record,
      status,
      providerId: state?.providerId ?? '',
      modelId: state?.modelId ?? ''
    }
  }

  private mapSessionRecordToListItem(record: SessionRecord): SessionListItem {
    return {
      ...record,
      status: this.sessionStatusSnapshots.get(record.id) ?? 'idle'
    }
  }

  private dedupeAndSortSessionListItems(items: SessionListItem[]): SessionListItem[] {
    const sessionMap = new Map<string, SessionListItem>()
    for (const item of items) {
      sessionMap.set(item.id, item)
    }

    return Array.from(sessionMap.values()).sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt
      }

      return right.id.localeCompare(left.id)
    })
  }

  private matchesLightweightFilter(
    record: SessionRecord,
    options?: {
      includeSubagents?: boolean
      agentId?: string
    }
  ): boolean {
    if (options?.agentId && record.agentId !== options.agentId) {
      return false
    }

    if (options?.includeSubagents !== true && record.sessionKind === 'subagent') {
      return false
    }

    return true
  }

  private async tryBuildSessionWithState(
    record: SessionRecord,
    mode: 'full' | 'list' = 'full'
  ): Promise<SessionWithState> {
    try {
      return await this.buildSessionWithState(record, mode)
    } catch (error) {
      console.warn(
        `[AgentSessionPresenter] Skipping unavailable session id=${record.id} agent=${record.agentId}:`,
        error
      )
      return null as unknown as SessionWithState
    }
  }

  private requireDirectAcpHandle(sessionId: string): DirectAcpSessionHandle {
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (handle.kind !== 'acp') {
      throw new Error(`Session ${sessionId} is not a direct ACP session.`)
    }
    return handle
  }

  private requireAcpAsLlmProviderSessionControl(): AcpAsLlmProviderSessionControlPort {
    if (this.acpAsLlmProviderSessionControl) {
      return this.acpAsLlmProviderSessionControl
    }
    throw new Error('ACP-as-LLM provider session control is not available.')
  }

  private async resolveDeepChatAgentConfigCompat(
    agentId: string
  ): Promise<Awaited<ReturnType<IConfigPresenter['resolveDeepChatAgentConfig']>> | null> {
    if (typeof this.configPresenter.resolveDeepChatAgentConfig !== 'function') {
      return {} as Awaited<ReturnType<IConfigPresenter['resolveDeepChatAgentConfig']>>
    }

    return await this.configPresenter.resolveDeepChatAgentConfig(agentId)
  }

  private getDefaultProjectPathCompat(): string | null {
    if (typeof this.configPresenter.getDefaultProjectPath !== 'function') {
      return null
    }

    return this.configPresenter.getDefaultProjectPath() ?? null
  }

  private resolveCreateSessionProjectDir(
    inputProjectDir: string | null | undefined,
    agentDefaultProjectDir: string | null | undefined
  ): string | null {
    if (inputProjectDir === null) {
      return null
    }

    return (
      inputProjectDir?.trim() ||
      agentDefaultProjectDir?.trim() ||
      this.getDefaultProjectPathCompat() ||
      null
    )
  }

  private mergeDeepChatDefaultGenerationSettings(
    config: Awaited<ReturnType<IConfigPresenter['resolveDeepChatAgentConfig']>> | null,
    overrides?: Partial<SessionGenerationSettings>
  ): Partial<SessionGenerationSettings> | undefined {
    const defaults: Partial<SessionGenerationSettings> = {}

    if (typeof config?.systemPrompt === 'string') {
      defaults.systemPrompt = config.systemPrompt
    }

    const merged = {
      ...defaults,
      ...overrides
    }

    return Object.keys(merged).length > 0 ? merged : undefined
  }

  private resolveSessionSubagentEnabled(
    agentType: 'deepchat' | 'acp' | null,
    inputEnabled?: boolean,
    configEnabled?: boolean
  ): boolean {
    if (agentType !== 'deepchat') {
      return false
    }

    if (typeof inputEnabled === 'boolean') {
      return inputEnabled
    }

    return configEnabled === true
  }

  private async resolveSubagentSessionRuntimeConfig(input: {
    agentId: string
    targetAgentId?: string | null
    providerId: string
    modelId: string
    generationSettings?: Partial<SessionGenerationSettings>
    disabledAgentTools?: string[]
    activeSkills?: string[]
  }): Promise<{
    agentId: string
    targetAgentId: string | null
    providerId: string
    modelId: string
    generationSettings?: Partial<SessionGenerationSettings>
    disabledAgentTools: string[]
    activeSkills: string[]
  }> {
    const trimmedAgentId = input.agentId.trim()
    const resolvedAgentId = resolveAcpAgentAlias(trimmedAgentId)
    let descriptor
    try {
      descriptor = this.agentManager.resolveBackend(resolvedAgentId).descriptor
    } catch {
      throw new Error(`Agent ${input.agentId} is not a valid subagent target.`)
    }

    if (descriptor.kind === 'acp') {
      return {
        agentId: descriptor.id,
        targetAgentId: input.targetAgentId?.trim() ? descriptor.id : null,
        providerId: 'acp',
        modelId: descriptor.id,
        generationSettings: {
          systemPrompt: ''
        },
        disabledAgentTools: [],
        activeSkills: []
      }
    }

    return {
      agentId: descriptor.id,
      targetAgentId: input.targetAgentId?.trim() ? descriptor.id : null,
      providerId: input.providerId,
      modelId: input.modelId,
      generationSettings: input.generationSettings,
      disabledAgentTools: this.normalizeDisabledAgentTools(input.disabledAgentTools),
      activeSkills: this.normalizeActiveSkills(input.activeSkills)
    }
  }

  private async assessTransferSession(session: SessionRecord): Promise<{
    status: SessionWithState['status']
    isEmptyDraft: boolean
    blockReason?: AgentTransferBlockReason
  }> {
    const { handle, facet } = this.agentManager.resolveTransferSource(toAppSessionId(session.id))
    const state = await handle.snapshot()
    const status = state?.status ?? 'idle'
    let hasMessages = true
    try {
      hasMessages = await facet.hasMessages(toAppSessionId(session.id))
    } catch (error) {
      console.warn(
        `[AgentSessionPresenter] Failed to inspect messages for session=${session.id}:`,
        error
      )
    }
    let hasPendingInput = false
    try {
      hasPendingInput = (await facet.listPendingInputs(toAppSessionId(session.id))).length > 0
    } catch (error) {
      console.warn(
        `[AgentSessionPresenter] Failed to inspect pending input for session=${session.id}:`,
        error
      )
      hasPendingInput = true
    }
    const hasSubagentChildren =
      session.sessionKind === 'regular' &&
      this.sessionManager.list({ includeSubagents: true, parentSessionId: session.id }).length > 0
    const isEmptyDraft = Boolean(session.isDraft) && !hasMessages && !hasSubagentChildren

    if (status === 'generating') {
      return { status, isEmptyDraft, blockReason: 'active' }
    }
    if (hasPendingInput) {
      return { status, isEmptyDraft, blockReason: 'pending-input' }
    }

    return { status, isEmptyDraft }
  }

  private async moveSessionToAgentInternal(
    sessionId: string,
    toAgentId: string,
    allowSubagent: boolean = false
  ): Promise<SessionWithState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    if (!allowSubagent && session.sessionKind !== 'regular') {
      throw new Error('Only regular conversations can be moved from the conversation menu.')
    }

    const targetAgentId = toAgentId.trim()
    if (!targetAgentId) {
      throw new Error('Target agent id is required.')
    }
    if (session.agentId === targetAgentId) {
      throw new Error('Conversation is already assigned to the selected agent.')
    }

    const assessment = await this.assessTransferSession(session)
    if (assessment.blockReason) {
      throw new Error(`Session ${sessionId} cannot be moved: ${assessment.blockReason}`)
    }

    const targetContext = await this.resolveTransferTargetContext(targetAgentId, session.projectDir)
    const source = this.agentManager.resolveTransferSource(toAppSessionId(sessionId))
    const sourceState = await source.handle.snapshot()
    const previousDirectAcp = source.handle.kind === 'acp'
    const previousCompatibilityAcp =
      source.handle.kind === 'deepchat' && sourceState?.providerId === 'acp'
    const { facet: transferTarget } = this.agentManager.resolveDeepChatTransferTarget(
      targetContext.agentId
    )

    await transferTarget.setSessionAgentContext(toAppSessionId(sessionId), {
      agentId: targetContext.agentId,
      providerId: targetContext.providerId,
      modelId: targetContext.modelId,
      projectDir: targetContext.projectDir,
      permissionMode: targetContext.permissionMode,
      generationSettings: targetContext.generationSettings
    })

    this.sessionManager.updateAgentId(sessionId, targetContext.agentId)
    this.sessionManager.update(sessionId, {
      projectDir: targetContext.projectDir,
      subagentEnabled: session.sessionKind === 'regular' ? targetContext.subagentEnabled : false
    })
    this.sessionManager.updateDisabledAgentTools(sessionId, targetContext.disabledAgentTools)

    await this.syncAcpSessionWorkdir(
      targetContext.providerId,
      sessionId,
      targetContext.agentId,
      targetContext.projectDir
    )

    const updated = this.sessionManager.get(sessionId)
    if (!updated) {
      throw new Error(`Session not found after transfer: ${sessionId}`)
    }

    const sessionWithState = await this.tryBuildSessionWithState(updated)
    if (!sessionWithState) {
      throw new Error(`Failed to build session state after transfer: ${sessionId}`)
    }

    if (previousDirectAcp && source.closeRuntime) {
      try {
        await source.closeRuntime()
      } catch (error) {
        console.warn(
          `[AgentSessionPresenter] Failed to close direct ACP runtime after transfer ${sessionId}:`,
          error
        )
      }
    } else if (previousCompatibilityAcp) {
      try {
        await this.requireAcpAsLlmProviderSessionControl().clearAcpSession(sessionId)
      } catch (error) {
        console.warn(
          `[AgentSessionPresenter] Failed to clear stale ACP binding after transfer ${sessionId}:`,
          error
        )
      }
    }

    return sessionWithState
  }

  private async resolveTransferTargetContext(
    targetAgentId: string,
    currentProjectDir: string | null
  ): Promise<AgentTransferTargetContext> {
    const resolvedAgentId = resolveAcpAgentAlias(targetAgentId.trim())
    let descriptor
    try {
      descriptor = this.agentManager.resolveBackend(resolvedAgentId).descriptor
    } catch {
      throw new Error(`Target agent not found: ${targetAgentId}`)
    }
    if (descriptor.kind === 'acp') {
      throw new Error('Conversation history cannot be moved to ACP agents.')
    }

    const currentProject = currentProjectDir?.trim() || null
    const config = await this.resolveDeepChatAgentConfigCompat(descriptor.id)
    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId =
      config?.defaultModelPreset?.providerId?.trim() || defaultModel?.providerId?.trim() || ''
    const modelId =
      config?.defaultModelPreset?.modelId?.trim() || defaultModel?.modelId?.trim() || ''
    if (!providerId || !modelId) {
      throw new Error('Target DeepChat agent does not have a default model.')
    }
    if (providerId.toLowerCase() === 'acp') {
      throw new Error('Conversation history cannot be moved to ACP agents.')
    }

    return {
      agentId: descriptor.id,
      agentType: 'deepchat',
      providerId,
      modelId,
      projectDir:
        currentProject ||
        config?.defaultProjectPath?.trim() ||
        this.getDefaultProjectPathCompat() ||
        null,
      permissionMode: normalizePermissionMode(config?.permissionMode),
      generationSettings: this.mergeDeepChatDefaultGenerationSettings(config),
      disabledAgentTools: this.normalizeDisabledAgentTools(config?.disabledAgentTools),
      subagentEnabled: this.resolveSessionSubagentEnabled(
        'deepchat',
        undefined,
        config?.subagentEnabled
      )
    }
  }

  private async deleteSessionInternal(sessionId: string): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) return []

    const deletedSessionIds: string[] = []

    if (session.sessionKind === 'regular') {
      const children = this.sessionManager.list({
        includeSubagents: true,
        parentSessionId: sessionId
      })
      for (const child of children) {
        deletedSessionIds.push(...(await this.deleteSessionInternal(child.id)))
      }
    }

    let backendCleanupError: unknown
    try {
      await this.agentManager.cleanupSessionBackends(toAppSessionId(sessionId))
    } catch (error) {
      backendCleanupError = error
    }
    try {
      await this.sharedData.sessionState.destroySession(sessionId)
    } catch (error) {
      if (!backendCleanupError) throw error
    }
    if (backendCleanupError) throw backendCleanupError
    this.sessionPermissionPort?.clearSessionPermissions(sessionId)
    await this.skillPresenter?.clearNewAgentSessionSkills?.(sessionId)
    this.sessionManager.delete(sessionId)
    this.sessionStatusSnapshots.delete(sessionId)
    deletedSessionIds.push(sessionId)

    return deletedSessionIds
  }

  private async findReusableDraftSession(
    agentId: string,
    projectDir: string
  ): Promise<SessionRecord | null> {
    const candidates = this.sessionManager.list({ agentId, projectDir })
    for (const session of candidates) {
      if (!session.isDraft) continue
      const hasMessages = await this.hasSessionMessages(session.id)
      if (!hasMessages) {
        return session
      }
    }
    return null
  }

  private async hasSessionMessages(sessionId: string): Promise<boolean> {
    try {
      return await this.sharedData.transcript.hasMessages(sessionId)
    } catch (error) {
      console.warn(
        `[AgentSessionPresenter] Failed to inspect messages for session=${sessionId}:`,
        error
      )
      return true
    }
  }

  private async ensureSessionRuntimeInitialized(
    sessionId: string,
    config: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir: string
      permissionMode: PermissionMode
    }
  ): Promise<void> {
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (!(await handle.lifecycle.isInitialized())) {
      await this.initializeSessionRuntime(sessionId, config)
      return
    }
    const state = await handle.snapshot()
    if (!state) throw new Error(`Session ${sessionId} not found`)

    if (state.permissionMode && state.permissionMode !== config.permissionMode) {
      await handle.settings.setPermissionMode(config.permissionMode)
    }

    await this.syncAcpSessionWorkdir(
      config.providerId,
      sessionId,
      config.agentId ?? config.modelId,
      config.projectDir
    )
  }

  private async initializeSessionRuntime(
    sessionId: string,
    config: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir?: string | null
      permissionMode: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    }
  ): Promise<void> {
    await this.agentManager
      .resolveSessionHandle(toAppSessionId(sessionId))
      .handle.lifecycle.initialize(config)
    await this.syncAcpSessionWorkdir(
      config.providerId,
      sessionId,
      config.agentId ?? config.modelId,
      config.projectDir ?? null
    )
  }

  private async syncAcpSessionWorkdir(
    providerId: string,
    conversationId: string,
    agentId: string,
    projectDir?: string | null
  ): Promise<void> {
    if (providerId !== 'acp') {
      return
    }

    const normalizedProjectDir = projectDir?.trim()
    if (!normalizedProjectDir) {
      return
    }

    try {
      const handle = this.agentManager.resolveSessionHandle(toAppSessionId(conversationId)).handle
      if (handle.kind === 'acp') {
        await handle.acp.updateWorkdir(normalizedProjectDir)
        return
      }
      await this.requireAcpAsLlmProviderSessionControl().setAcpWorkdir(
        conversationId,
        resolveAcpAgentAlias(agentId),
        normalizedProjectDir
      )
    } catch (error) {
      console.warn('[AgentSessionPresenter] Failed to sync ACP workdir for session:', {
        conversationId,
        agentId,
        projectDir: normalizedProjectDir,
        error
      })
      throw error
    }
  }

  private async cleanupFailedSessionInitialization(
    sessionId: string,
    providerId?: string
  ): Promise<void> {
    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    if (providerId === 'acp' && handle.kind !== 'acp') {
      try {
        await this.requireAcpAsLlmProviderSessionControl().clearAcpSession(sessionId)
      } catch (error) {
        console.warn(
          `[AgentSessionPresenter] Failed to clear ACP session after initialization error ${sessionId}:`,
          error
        )
      }
    }

    try {
      await handle.close()
    } catch (cleanupError) {
      console.warn(
        `[AgentSessionPresenter] Failed to cleanup session runtime after initialization error ${sessionId}:`,
        cleanupError
      )
    }

    this.sessionManager.delete(sessionId)
  }

  private buildTitleMessages(
    records: ChatMessageRecord[]
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const sorted = [...records].sort((a, b) => a.orderSeq - b.orderSeq)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    for (const record of sorted) {
      if (record.role === 'user') {
        const text = this.extractUserText(record.content)
        if (text) {
          messages.push({ role: 'user', content: text })
        }
        continue
      }

      if (record.role === 'assistant') {
        const text = this.extractAssistantText(record.content)
        if (text) {
          messages.push({ role: 'assistant', content: text })
        }
      }
    }

    return messages.slice(0, 6)
  }

  private extractUserText(content: string): string {
    try {
      const parsed = JSON.parse(content) as UserMessageContent | string
      if (typeof parsed === 'string') return parsed.trim()
      return typeof parsed.text === 'string' ? parsed.text.trim() : ''
    } catch {
      return content.trim()
    }
  }

  private extractAssistantText(content: string): string {
    try {
      const parsed = JSON.parse(content) as AssistantMessageBlock[] | string
      if (typeof parsed === 'string') return parsed.trim()
      if (!Array.isArray(parsed)) return ''
      return parsed
        .filter((block) => block.type === 'content')
        .map((block) => block.content)
        .join('\n')
        .trim()
    } catch {
      return content.trim()
    }
  }

  private normalizeGeneratedTitle(rawTitle: string): string {
    if (!rawTitle) return ''
    let cleaned = rawTitle.replace(/<think>.*?<\/think>/gs, '').trim()
    cleaned = cleaned.replace(/^<think>/, '').trim()
    cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim()
    if (cleaned.length > 80) {
      cleaned = cleaned.slice(0, 80).trim()
    }
    return cleaned
  }

  private buildForkTitle(sourceTitle: string, customTitle?: string): string {
    const normalizedCustom = customTitle?.trim()
    if (normalizedCustom) {
      return normalizedCustom
    }
    const base = sourceTitle?.trim() || 'New Chat'
    if (base.length >= 60) {
      return base.slice(0, 60).trim()
    }
    return `${base} - Fork`
  }

  private assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void {
    if (providerId !== 'acp') {
      return
    }
    if (projectDir?.trim()) {
      return
    }
    throw new Error('ACP agent requires selecting a workdir before sending messages.')
  }

  private normalizeSendMessageInput(content: string | SendMessageInput): SendMessageInput {
    if (typeof content === 'string') {
      return { text: content, files: [] }
    }

    if (!content || typeof content !== 'object') {
      return { text: '', files: [] }
    }

    const text = typeof content.text === 'string' ? content.text : ''
    const files = Array.isArray(content.files)
      ? content.files.filter((file): file is MessageFile => Boolean(file))
      : []
    const activeSkills = this.normalizeActiveSkills(content.activeSkills)
    const inlineItems = Array.isArray(content.inlineItems) ? content.inlineItems : []
    return {
      text,
      files,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(inlineItems.length > 0 ? { inlineItems } : {})
    }
  }

  private normalizeCreateSessionInput(input: CreateSessionInput): SendMessageInput {
    const text = typeof input.message === 'string' ? input.message : ''
    const files = Array.isArray(input.files)
      ? input.files.filter((file): file is MessageFile => Boolean(file))
      : []
    const inlineItems = Array.isArray(input.inlineItems) ? input.inlineItems : []
    return this.withInitialMessageActiveSkills(
      {
        text,
        files,
        ...(inlineItems.length > 0 ? { inlineItems } : {})
      },
      input.activeSkills
    )
  }

  private withInitialMessageActiveSkills(
    input: SendMessageInput,
    activeSkills?: string[]
  ): SendMessageInput {
    const normalizedActiveSkills = this.normalizeActiveSkills(activeSkills ?? input.activeSkills)
    return {
      ...input,
      ...(normalizedActiveSkills.length > 0 ? { activeSkills: normalizedActiveSkills } : {})
    }
  }

  private normalizeDisabledAgentTools(disabledAgentTools?: string[]): string[] {
    if (!Array.isArray(disabledAgentTools)) {
      return []
    }

    return Array.from(
      new Set(
        disabledAgentTools
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .map((item) => LEGACY_AGENT_TOOL_NAME_MAP[item] ?? item)
          .filter((item) => Boolean(item) && !RETIRED_DEFAULT_AGENT_TOOLS.has(item))
      )
    ).sort((left, right) => left.localeCompare(right))
  }

  private normalizeActiveSkills(activeSkills?: string[]): string[] {
    if (!Array.isArray(activeSkills)) {
      return []
    }

    return Array.from(
      new Set(
        activeSkills
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )
  }
}
