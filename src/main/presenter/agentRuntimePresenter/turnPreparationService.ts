import logger from '@shared/logger'
import fs from 'fs'
import path from 'path'
import type {
  DeepChatSessionState,
  MessageFile,
  SendMessageInput,
  SessionCompactionState,
  SessionGenerationSettings,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IConfigPresenter, ISkillPresenter, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ReasoningPortrait } from '@shared/types/model-db'
import { ApiEndpointType, ModelType, isDeepSeekSeriesModelId } from '@shared/model'
import { isVideoGenerationModelConfig } from '@shared/videoGenerationSettings'
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPrompt
} from '@/lib/agentRuntime/systemEnvPromptBuilder'
import type { ProviderCatalogPort } from '../runtimePorts'
import { providerDbLoader } from '../configPresenter/providerDbLoader'
import { capAgentRequestMaxTokens, estimateToolReserveTokens } from './contextBudget'
import {
  appendReconstructionAnchorStateSection,
  appendSummarySection,
  type CompactionIntent
} from './compactionService'
import type {
  ManualCompactionRequest,
  NextUserTurnCompactionRequest
} from './memoryCompactionService'
import type { ContextBuildMetadata } from './contextBuilder'
import { buildTapeChatView, getTapeContextHistoryRecords } from './tapeViewAssembler'
import type { DeepChatMessageStore } from './messageStore'
import type { RuntimeSharedState } from './runtimeSharedState'
import type { SessionSettingsService } from './sessionSettingsService'
import type { DeepChatSessionStore, SessionSummaryState } from './sessionStore'
import type { DeepChatTapeService } from './tapeService'
import type { InterleavedReasoningConfig } from './types'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewTaskType
} from '@shared/types/tape-view-manifest'
import type { TapeViewContextSelection } from './tapeViewManifest'

type PackageJsonManifest = {
  name?: unknown
  scripts?: Record<string, unknown>
}

type SystemPromptCacheEntry = {
  prompt: string
  dayKey: string
  fingerprint: string
}

type ToolProfileKind = 'code' | 'research' | 'analysis' | 'general'

type ToolProfileCacheEntry = {
  profile: ToolProfileKind
  fingerprint: string
  tools: MCPToolDefinition[]
}

export type AgentExtensionPolicy = {
  enabledSkillNames?: string[] | null
}

export type TurnPreparationViewContext = {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

export type PreparedNewTurn = {
  sessionId: string
  normalizedInput: SendMessageInput
  projectDir: string | null
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  baseSystemPrompt: string
  interleavedReasoning: InterleavedReasoningConfig
  userMessageId: string
  assistantMessageId: string
  viewContext: TurnPreparationViewContext
  preStreamStartedAt: number
  refreshSystemPrompt: (
    activeSkillNames: string[] | undefined,
    toolDefinitions: MCPToolDefinition[]
  ) => Promise<string>
}

export type PrepareNewTurnInput = {
  sessionId: string
  content: string | SendMessageInput
  projectDir?: string | null
  signal?: AbortSignal
  onMessageCreated?: (role: 'user' | 'assistant', messageId: string) => void
}

export type TurnPreparationCompactionPort = {
  prepareForNextUserTurn: (
    params: NextUserTurnCompactionRequest
  ) => Promise<CompactionIntent | null>
}

type SkillRuntimePresenter = Pick<
  ISkillPresenter,
  'getMetadataList' | 'getActiveSkills' | 'loadSkillContent'
>

export type TurnPreparationDependencies = {
  configPresenter: IConfigPresenter
  toolPresenter: IToolPresenter | null
  sessionStore: DeepChatSessionStore
  messageStore: DeepChatMessageStore
  tapeService: DeepChatTapeService
  compactionPort: TurnPreparationCompactionPort
  sessionSettingsService: SessionSettingsService
  runtimeSharedState: RuntimeSharedState
  providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
  skillPresenter?: SkillRuntimePresenter
}

export type UserPromptSubmitContext = {
  sessionId: string
  messageId: string
  promptPreview: string
  providerId: string
  modelId: string
  projectDir: string | null
}

export type TurnPreparationHost = {
  hasPendingInteractions: (sessionId: string) => boolean
  resolveProjectDir: (sessionId: string, incoming?: string | null) => string | null
  getSessionAgentId: (sessionId: string) => string | undefined
  getSessionKind: (sessionId: string) => string | null | undefined
  getDisabledAgentTools: (sessionId: string) => string[]
  applyCompactionIntent: (
    sessionId: string,
    intent: CompactionIntent,
    options: {
      compactionMessageId: string
      startedExternally: true
      signal?: AbortSignal
    }
  ) => Promise<SessionSummaryState>
  emitCompactionState: (sessionId: string, state: SessionCompactionState) => void
  triggerMemoryExtractionFromCompaction: (sessionId: string, intent: CompactionIntent) => void
  appendMemoryInjection: (
    sessionId: string,
    systemPrompt: string,
    query: string,
    messageId?: string | null,
    signal?: AbortSignal
  ) => Promise<string>
  emitMessageRefresh: (sessionId: string, messageId: string) => void
  dispatchUserPromptSubmit: (context: UserPromptSubmitContext) => void
}

const PRE_STREAM_SLOW_STEP_MS = 500

function readPackageJsonManifest(workdir: string): PackageJsonManifest | null {
  try {
    const packageJsonPath = path.join(workdir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      return null
    }

    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    return parsed as PackageJsonManifest
  } catch {
    return null
  }
}

function getVerificationScriptNames(workdir: string): string[] {
  const manifest = readPackageJsonManifest(workdir)
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object') {
    return []
  }

  return Object.entries(scripts)
    .filter(
      ([name, value]) => typeof name === 'string' && typeof value === 'string' && value.trim()
    )
    .map(([name]) => name)
}

function buildTapeViewSelection(
  metadata: ContextBuildMetadata,
  newUserMessageId?: string | null
): TapeViewContextSelection {
  return {
    includedRecords: metadata.includedRecords,
    excludedRecords: metadata.excludedRecords,
    summaryCursor: metadata.summaryCursor,
    includesSystemPrompt: metadata.includesSystemPrompt,
    newUserMessageId
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export class TurnPreparationService {
  private readonly systemPromptCache = new Map<string, SystemPromptCacheEntry>()
  private readonly toolProfileCache = new Map<string, ToolProfileCacheEntry>()
  private readonly runtimeActivatedSkillsBySession = new Map<string, Set<string>>()
  private toolRegistryRevision = 0

  constructor(
    private readonly dependencies: TurnPreparationDependencies,
    private readonly host: TurnPreparationHost
  ) {}

  async prepareNewTurn(input: PrepareNewTurnInput): Promise<PreparedNewTurn> {
    const { sessionId, signal, onMessageCreated } = input
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.host.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const normalizedInput = this.normalizeUserMessageInput(input.content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }

    const supportsVision = this.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.supportsAudioInput(state.providerId, state.modelId)
    const projectDir = this.host.resolveProjectDir(sessionId, input.projectDir)
    logger.info(
      `[DeepChatAgent] prepareNewTurn session=${sessionId} content="${normalizedInput.text.slice(0, 60)}" projectDir=${projectDir ?? '<none>'}`
    )

    const preStreamStartedAt = Date.now()
    try {
      this.throwIfAbortRequested(signal)
      let stepStartedAt = Date.now()
      const generationSettings =
        await this.dependencies.sessionSettingsService.getEffectiveGenerationSettings(sessionId)
      this.logSlowPreStreamStep(sessionId, 'generation-settings', stepStartedAt)
      const modelConfig = this.dependencies.configPresenter.getModelConfig(
        state.modelId,
        state.providerId
      )
      const useContextBudget = this.shouldUseDeepChatContextBudget(
        state.providerId,
        modelConfig,
        state.modelId
      )
      this.throwIfAbortRequested(signal)
      const interleavedReasoning = this.resolveInterleavedReasoningConfig(
        state.providerId,
        state.modelId,
        generationSettings
      )
      const contextBudgetLength = this.resolveDeepChatContextBudgetLength(
        state.providerId,
        generationSettings.contextLength,
        modelConfig,
        state.modelId
      )
      const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)

      stepStartedAt = Date.now()
      this.resetRuntimeActivatedSkills(sessionId)
      this.setRuntimeActivatedSkills(sessionId, normalizedInput.activeSkills ?? [])
      const sessionActiveSkillNames = await this.resolveActiveSkillNamesForToolProfile(sessionId)
      const effectiveActiveSkillNames = this.resolveEffectiveActiveSkillNames(
        sessionActiveSkillNames,
        sessionId
      )
      this.logSlowPreStreamStep(sessionId, 'active-skills', stepStartedAt)

      stepStartedAt = Date.now()
      const tools = await this.loadToolDefinitionsForSession(
        sessionId,
        projectDir,
        effectiveActiveSkillNames
      )
      this.logSlowPreStreamStep(sessionId, 'tool-definitions', stepStartedAt)
      const toolReserveTokens = estimateToolReserveTokens(tools)
      this.throwIfAbortRequested(signal)

      stepStartedAt = Date.now()
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt,
        tools,
        effectiveActiveSkillNames
      )
      this.logSlowPreStreamStep(sessionId, 'system-prompt', stepStartedAt)
      this.throwIfAbortRequested(signal)

      const tapeReady = this.dependencies.tapeService.ensureSessionTapeReady(
        sessionId,
        this.dependencies.messageStore
      )
      const historyRecords = getTapeContextHistoryRecords(tapeReady.historyRecords)
      const userContent: UserMessageContent = {
        text: normalizedInput.text,
        files: normalizedInput.files || [],
        links: [],
        search: false,
        think: false,
        ...(normalizedInput.activeSkills?.length
          ? { activeSkills: normalizedInput.activeSkills }
          : {}),
        ...(normalizedInput.inlineItems?.length ? { inlineItems: normalizedInput.inlineItems } : {})
      }

      let compactionIntent: CompactionIntent | null = null
      if (useContextBudget) {
        stepStartedAt = Date.now()
        compactionIntent = await this.dependencies.compactionPort.prepareForNextUserTurn({
          sessionId,
          providerId: state.providerId,
          modelId: state.modelId,
          systemPrompt: baseSystemPrompt,
          contextLength: generationSettings.contextLength,
          reserveTokens: maxTokens,
          extraReserveTokens: toolReserveTokens,
          supportsVision,
          supportsAudioInput,
          preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
          preserveEmptyInterleavedReasoning:
            interleavedReasoning.preserveEmptyReasoningContent === true,
          newUserContent: normalizedInput,
          historyRecords,
          signal
        })
        this.logSlowPreStreamStep(sessionId, 'compaction-prepare', stepStartedAt)
      }

      let summaryState: SessionSummaryState
      let userMessageId: string
      if (compactionIntent) {
        const compactionMessageId = this.dependencies.messageStore.createCompactionMessage(
          sessionId,
          this.dependencies.messageStore.getNextOrderSeq(sessionId),
          'compacting',
          compactionIntent.previousState.summaryUpdatedAt
        )
        userMessageId = this.dependencies.messageStore.createUserMessage(
          sessionId,
          this.dependencies.messageStore.getNextOrderSeq(sessionId),
          userContent
        )
        this.host.emitCompactionState(sessionId, {
          status: 'compacting',
          cursorOrderSeq: compactionIntent.targetCursorOrderSeq,
          summaryUpdatedAt: compactionIntent.previousState.summaryUpdatedAt
        })
        summaryState = await this.host.applyCompactionIntent(sessionId, compactionIntent, {
          compactionMessageId,
          startedExternally: true,
          signal
        })
        this.host.triggerMemoryExtractionFromCompaction(sessionId, compactionIntent)
      } else {
        summaryState = this.dependencies.sessionStore.getSummaryState(sessionId)
        userMessageId = this.dependencies.messageStore.createUserMessage(
          sessionId,
          this.dependencies.messageStore.getNextOrderSeq(sessionId),
          userContent
        )
      }

      if (!userMessageId) {
        throw new Error('Failed to create user message.')
      }
      onMessageCreated?.('user', userMessageId)
      this.throwIfAbortRequested(signal)
      this.host.emitMessageRefresh(sessionId, userMessageId)
      this.host.dispatchUserPromptSubmit({
        sessionId,
        messageId: userMessageId,
        promptPreview: normalizedInput.text,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      const buildPromptWithTurnContext = async (
        activeSkillNames: string[] | undefined,
        toolDefinitions: MCPToolDefinition[]
      ): Promise<string> => {
        const refreshedBasePrompt = await this.buildSystemPromptWithSkills(
          sessionId,
          generationSettings.systemPrompt,
          toolDefinitions,
          activeSkillNames ?? effectiveActiveSkillNames
        )
        const prompt = await this.host.appendMemoryInjection(
          sessionId,
          appendReconstructionAnchorStateSection(
            appendSummarySection(refreshedBasePrompt, summaryState.summaryText),
            this.dependencies.sessionStore.getReconstructionAnchorPromptState(sessionId)
          ),
          normalizedInput.text,
          userMessageId,
          signal
        )
        this.throwIfAbortRequested(signal)
        return prompt
      }

      stepStartedAt = Date.now()
      const systemPrompt = await buildPromptWithTurnContext(effectiveActiveSkillNames, tools)
      this.logSlowPreStreamStep(sessionId, 'memory-injection', stepStartedAt)
      this.throwIfAbortRequested(signal)

      stepStartedAt = Date.now()
      const contextBuild = buildTapeChatView({
        sessionId,
        newUserContent: normalizedInput,
        systemPrompt,
        contextLength: contextBudgetLength,
        reserveTokens: maxTokens,
        messageStore: this.dependencies.messageStore,
        supportsVision,
        historyRecords,
        options: {
          summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
          supportsAudioInput,
          extraReserveTokens: toolReserveTokens,
          preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
          preserveEmptyInterleavedReasoning:
            interleavedReasoning.preserveEmptyReasoningContent === true
        }
      })
      this.logSlowPreStreamStep(sessionId, 'context-build', stepStartedAt)

      const assistantMessageId = this.dependencies.messageStore.createAssistantMessage(
        sessionId,
        this.dependencies.messageStore.getNextOrderSeq(sessionId)
      )
      onMessageCreated?.('assistant', assistantMessageId)
      this.dependencies.toolPresenter?.clearAgentPlanState?.(sessionId)
      this.throwIfAbortRequested(signal)

      return {
        sessionId,
        normalizedInput,
        projectDir,
        messages: contextBuild.messages,
        tools,
        baseSystemPrompt,
        interleavedReasoning,
        userMessageId,
        assistantMessageId,
        viewContext: {
          taskType: 'chat',
          policy: contextBuild.policyId,
          policyVersion: contextBuild.policyVersion,
          selection: buildTapeViewSelection(contextBuild.metadata, userMessageId),
          summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
          supportsVision,
          supportsAudioInput,
          traceDebugEnabled:
            this.dependencies.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
        },
        preStreamStartedAt,
        refreshSystemPrompt: buildPromptWithTurnContext
      }
    } catch (error) {
      this.resetRuntimeActivatedSkills(sessionId)
      throw error
    }
  }

  supportsManualCompaction(state: DeepChatSessionState): boolean {
    const modelConfig = this.dependencies.configPresenter.getModelConfig(
      state.modelId,
      state.providerId
    )
    return !this.shouldBypassDeepChatContextBudget(state.providerId, modelConfig, state.modelId)
  }

  async buildManualCompactionRequest(
    sessionId: string,
    state: DeepChatSessionState,
    signal?: AbortSignal
  ): Promise<ManualCompactionRequest> {
    this.throwIfAbortRequested(signal)
    const modelConfig = this.dependencies.configPresenter.getModelConfig(
      state.modelId,
      state.providerId
    )
    const generationSettings =
      await this.dependencies.sessionSettingsService.getEffectiveGenerationSettings(sessionId)
    this.throwIfAbortRequested(signal)
    const interleavedReasoning = this.resolveInterleavedReasoningConfig(
      state.providerId,
      state.modelId,
      generationSettings
    )
    const contextBudgetLength = this.resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      modelConfig,
      state.modelId
    )
    const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)
    const activeSkillNames = await this.resolveActiveSkillNamesForToolProfile(sessionId)
    this.throwIfAbortRequested(signal)
    const projectDir = this.host.resolveProjectDir(sessionId)
    const tools = await this.loadToolDefinitionsForSession(sessionId, projectDir, activeSkillNames)
    this.throwIfAbortRequested(signal)
    const toolReserveTokens = estimateToolReserveTokens(tools)
    const baseSystemPrompt = await this.buildSystemPromptWithSkills(
      sessionId,
      generationSettings.systemPrompt,
      tools,
      activeSkillNames
    )
    this.throwIfAbortRequested(signal)
    const tapeReady = this.dependencies.tapeService.ensureSessionTapeReady(
      sessionId,
      this.dependencies.messageStore
    )

    return {
      sessionId,
      providerId: state.providerId,
      modelId: state.modelId,
      systemPrompt: baseSystemPrompt,
      contextLength: generationSettings.contextLength,
      reserveTokens: maxTokens,
      extraReserveTokens: toolReserveTokens,
      supportsVision: this.supportsVision(state.providerId, state.modelId),
      supportsAudioInput: this.supportsAudioInput(state.providerId, state.modelId),
      preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
      preserveEmptyInterleavedReasoning:
        interleavedReasoning.preserveEmptyReasoningContent === true,
      historyRecords: tapeReady.historyRecords,
      ...(signal ? { signal } : {})
    }
  }

  normalizeUserMessageInput(input: string | SendMessageInput): SendMessageInput {
    if (typeof input === 'string') {
      return { text: input, files: [] }
    }
    if (!input || typeof input !== 'object') {
      return { text: '', files: [] }
    }
    const text = typeof input.text === 'string' ? input.text : ''
    const files = Array.isArray(input.files)
      ? input.files.filter((file): file is MessageFile => Boolean(file))
      : []
    const activeSkills = this.normalizeSkillNames(
      Array.isArray(input.activeSkills) ? input.activeSkills : []
    )
    const inlineItems = Array.isArray(input.inlineItems) ? input.inlineItems : []
    return {
      text,
      files,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(inlineItems.length > 0 ? { inlineItems } : {})
    }
  }

  supportsVision(providerId: string, modelId: string): boolean {
    return Boolean(this.dependencies.configPresenter.getModelConfig(modelId, providerId)?.vision)
  }

  supportsAudioInput(providerId: string, modelId: string): boolean {
    return (
      this.dependencies.configPresenter.supportsAudioInputCapability?.(providerId, modelId) === true
    )
  }

  shouldUseDeepChatContextBudget(
    providerId?: string | null,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): boolean {
    if (providerId?.trim() === 'acp') {
      return false
    }
    if (!modelConfig) {
      return true
    }
    if (modelConfig.type === ModelType.ImageGeneration || modelConfig.type === ModelType.TTS) {
      return false
    }
    if (modelConfig.apiEndpoint && modelConfig.apiEndpoint !== ApiEndpointType.Chat) {
      return false
    }
    if (modelConfig.endpointType === 'image-generation') {
      return false
    }
    if (isVideoGenerationModelConfig(modelConfig, modelId?.trim() || '')) {
      return false
    }
    return true
  }

  shouldBypassDeepChatContextBudget(
    providerId?: string | null,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): boolean {
    return !this.shouldUseDeepChatContextBudget(providerId, modelConfig, modelId)
  }

  resolveDeepChatContextBudgetLength(
    providerId: string | null | undefined,
    contextLength: number,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): number {
    return this.shouldBypassDeepChatContextBudget(providerId, modelConfig, modelId)
      ? Number.MAX_SAFE_INTEGER
      : contextLength
  }

  resolveInterleavedReasoningConfig(
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings
  ): InterleavedReasoningConfig {
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const isDeepSeekSeries = isDeepSeekSeriesModelId(modelId)
    const explicitSessionSetting =
      typeof generationSettings.forceInterleavedThinkingCompat === 'boolean'
        ? generationSettings.forceInterleavedThinkingCompat
        : undefined
    const forcedBySessionSetting = explicitSessionSetting === true
    const portraitInterleaved = portrait?.interleaved === true
    const reasoningSupported =
      this.dependencies.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    const preserveReasoningContent =
      isDeepSeekSeries ||
      (explicitSessionSetting !== undefined ? explicitSessionSetting : portraitInterleaved)

    return {
      preserveReasoningContent,
      preserveEmptyReasoningContent: isDeepSeekSeries,
      forcedBySessionSetting,
      portraitInterleaved,
      reasoningSupported,
      providerDbSourceUrl: providerDbLoader.getSourceUrl()
    }
  }

  getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null {
    return this.dependencies.configPresenter.getReasoningPortrait?.(providerId, modelId) ?? null
  }

  resolveCapabilityProviderId(providerId: string, modelId: string | undefined): string {
    if (!modelId) {
      return providerId
    }
    return (
      this.dependencies.configPresenter.getCapabilityProviderId?.(providerId, modelId) ?? providerId
    )
  }

  isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean {
    if (this.host.getSessionKind(sessionId) !== 'subagent') {
      return false
    }
    const resolvedProviderId =
      providerId?.trim() ||
      this.dependencies.runtimeSharedState.runtimeState.get(sessionId)?.providerId?.trim() ||
      ''
    return resolvedProviderId === 'acp'
  }

  async buildSystemPromptWithSkills(
    sessionId: string,
    basePrompt: string,
    toolDefinitions: MCPToolDefinition[],
    activeSkillNamesOverride?: string[]
  ): Promise<string> {
    const normalizedBase = basePrompt?.trim() ?? ''
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    const providerId = state?.providerId?.trim() || 'unknown-provider'
    const modelId = state?.modelId?.trim() || 'unknown-model'
    if (this.isAcpBackedSubagentSession(sessionId, providerId)) {
      return normalizedBase
    }

    const workdir = this.host.resolveProjectDir(sessionId)
    const now = new Date()
    const dayKey = this.buildLocalDayKey(now)
    const skillsEnabled = this.dependencies.configPresenter.getSkillsEnabled()
    const skillPresenter = this.dependencies.skillPresenter
    const availableSkills: Array<{
      name: string
      description: string
      category?: string | null
      platforms?: string[]
    }> = []
    const activeSkillNames: string[] = activeSkillNamesOverride ? [...activeSkillNamesOverride] : []
    const skillDraftSuggestionsEnabled =
      this.dependencies.configPresenter.getSkillDraftSuggestionsEnabled?.() ?? false
    const extensionPolicy = await this.resolveAgentExtensionPolicy(sessionId)
    const allowedSkillNameSet =
      extensionPolicy.enabledSkillNames === null || extensionPolicy.enabledSkillNames === undefined
        ? null
        : new Set(this.normalizeSkillNames(extensionPolicy.enabledSkillNames))

    if (skillsEnabled && skillPresenter) {
      if (skillPresenter.getMetadataList) {
        const stepStartedAt = Date.now()
        try {
          const metadataList = await skillPresenter.getMetadataList()
          for (const metadata of metadataList) {
            const skillName = metadata?.name?.trim()
            if (skillName && (!allowedSkillNameSet || allowedSkillNameSet.has(skillName))) {
              availableSkills.push({
                name: skillName,
                description: metadata.description?.trim() || '',
                category: metadata.category ?? null,
                platforms: metadata.platforms
              })
            }
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load skills metadata for session ${sessionId}:`,
            error
          )
        }
        this.logSlowPreStreamStep(sessionId, 'system-prompt.skills-metadata-load', stepStartedAt)
      }

      if (!activeSkillNamesOverride && skillPresenter.getActiveSkills) {
        const stepStartedAt = Date.now()
        try {
          const activeSkills = await skillPresenter.getActiveSkills(sessionId)
          for (const skillName of activeSkills) {
            const normalizedName = skillName?.trim()
            if (normalizedName) {
              activeSkillNames.push(normalizedName)
            }
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load active skills for session ${sessionId}:`,
            error
          )
        }
        this.logSlowPreStreamStep(sessionId, 'system-prompt.active-skills-load', stepStartedAt)
      }
    }

    let stepStartedAt = Date.now()
    const normalizedAvailableSkills = this.normalizeSkillMetadata(availableSkills)
    const availableSkillNames = new Set(normalizedAvailableSkills.map((skill) => skill.name))
    const normalizedActiveSkills = this.filterSkillNamesByPolicy(
      activeSkillNames.filter((skillName) => availableSkillNames.has(skillName)),
      extensionPolicy
    )
    const agentToolNames = this.getAgentToolNames(toolDefinitions)
    const fingerprint = this.buildSystemPromptFingerprint({
      providerId,
      modelId,
      workdir,
      basePrompt: normalizedBase,
      skillsEnabled,
      availableSkillNames: normalizedAvailableSkills.map((skill) => skill.name),
      activeSkillNames: normalizedActiveSkills,
      toolSignature: this.buildToolSignature(toolDefinitions),
      skillDraftSuggestionsEnabled
    })
    this.logSlowPreStreamStep(sessionId, 'system-prompt.fingerprint', stepStartedAt)

    const cachedPrompt = this.systemPromptCache.get(sessionId)
    if (
      cachedPrompt &&
      cachedPrompt.dayKey === dayKey &&
      cachedPrompt.fingerprint === fingerprint
    ) {
      return cachedPrompt.prompt
    }

    const runtimePrompt = buildRuntimeCapabilitiesPrompt({
      hasYoBrowser: toolDefinitions.some(
        (tool) => tool.source === 'agent' && tool.server.name === 'yobrowser'
      ),
      hasExec: agentToolNames.has('exec'),
      hasProcess: agentToolNames.has('process')
    })
    const skillsMetadataPrompt = skillsEnabled
      ? this.buildSkillsMetadataPrompt(
          normalizedAvailableSkills,
          {
            canListSkills: agentToolNames.has('skill_list'),
            canViewSkills: agentToolNames.has('skill_view'),
            canManageDraftSkills: agentToolNames.has('skill_manage'),
            canRunSkillScripts: agentToolNames.has('skill_run')
          },
          skillDraftSuggestionsEnabled
        )
      : ''

    let skillsPrompt = ''
    if (skillsEnabled && skillPresenter?.loadSkillContent && normalizedActiveSkills.length > 0) {
      stepStartedAt = Date.now()
      const skillSections: string[] = []
      for (const skillName of normalizedActiveSkills) {
        try {
          const skill = await skillPresenter.loadSkillContent(skillName)
          const content = skill?.content?.trim()
          if (content) {
            skillSections.push(`### ${skillName}\n${content}`)
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load skill content for "${skillName}" in session ${sessionId}:`,
            error
          )
        }
      }
      skillsPrompt = this.buildPinnedSkillsPrompt(skillSections)
      this.logSlowPreStreamStep(sessionId, 'system-prompt.pinned-skills-load', stepStartedAt)
    }

    let envPrompt = ''
    try {
      stepStartedAt = Date.now()
      envPrompt = await buildSystemEnvPrompt({
        providerId,
        modelId,
        workdir,
        now,
        modelLookup: this.dependencies.providerCatalogPort
      })
      this.logSlowPreStreamStep(sessionId, 'system-prompt.env-prompt', stepStartedAt)
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to build env prompt for session ${sessionId}:`, error)
    }

    let toolingPrompt = ''
    if (this.dependencies.toolPresenter) {
      try {
        stepStartedAt = Date.now()
        toolingPrompt = this.dependencies.toolPresenter.buildToolSystemPrompt({
          conversationId: sessionId,
          toolDefinitions
        })
        this.logSlowPreStreamStep(sessionId, 'system-prompt.tooling-prompt', stepStartedAt)
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to build tooling prompt for session ${sessionId}:`,
          error
        )
      }
    }

    stepStartedAt = Date.now()
    const composedPrompt = this.composePromptSections([
      normalizedBase,
      runtimePrompt,
      envPrompt,
      skillsMetadataPrompt,
      skillsPrompt,
      toolingPrompt,
      this.buildPermissionRulesPrompt(agentToolNames),
      this.buildVerificationPolicyPrompt(workdir)
    ])
    this.logSlowPreStreamStep(sessionId, 'system-prompt.compose', stepStartedAt)
    this.systemPromptCache.set(sessionId, {
      prompt: composedPrompt,
      dayKey,
      fingerprint
    })
    return composedPrompt
  }

  async loadToolDefinitionsForSession(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[]
  ): Promise<MCPToolDefinition[]> {
    const toolPresenter = this.dependencies.toolPresenter
    if (!toolPresenter) {
      return []
    }
    const providerId = this.dependencies.runtimeSharedState.runtimeState
      .get(sessionId)
      ?.providerId?.trim()
    if (this.isAcpBackedSubagentSession(sessionId, providerId)) {
      return []
    }

    try {
      const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
      const policy = await this.resolveAgentExtensionPolicy(sessionId)
      const effectiveActiveSkillNames =
        activeSkillNamesOverride === undefined
          ? await this.resolveActiveSkillNamesForToolProfile(sessionId)
          : this.filterSkillNamesByPolicy(activeSkillNamesOverride, policy)
      const profile = await this.resolveToolProfile(
        sessionId,
        projectDir,
        effectiveActiveSkillNames,
        policy
      )
      const cachedProfile = this.toolProfileCache.get(sessionId)
      if (
        cachedProfile &&
        cachedProfile.profile === profile.kind &&
        cachedProfile.fingerprint === profile.fingerprint
      ) {
        toolPresenter.syncAgentToolContext?.({
          chatMode: 'agent',
          agentWorkspacePath: projectDir
        })
        return cachedProfile.tools
      }

      const tools = await toolPresenter.getAllToolDefinitions({
        agentId,
        disabledAgentTools: this.host.getDisabledAgentTools(sessionId),
        chatMode: 'agent',
        conversationId: sessionId,
        agentWorkspacePath: projectDir,
        activeSkillNames: effectiveActiveSkillNames
      })
      this.toolProfileCache.set(sessionId, {
        profile: profile.kind,
        fingerprint: profile.fingerprint,
        tools
      })
      return tools
    } catch (error) {
      console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
      return []
    }
  }

  async resolveActiveSkillNamesForToolProfile(sessionId: string): Promise<string[]> {
    if (
      !this.dependencies.configPresenter.getSkillsEnabled() ||
      !this.dependencies.skillPresenter?.getActiveSkills
    ) {
      return []
    }

    try {
      const policy = await this.resolveAgentExtensionPolicy(sessionId)
      return this.filterSkillNamesByPolicy(
        this.normalizeSkillNames(await this.dependencies.skillPresenter.getActiveSkills(sessionId)),
        policy
      )
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to load active skills for tool profile in session ${sessionId}:`,
        error
      )
      return []
    }
  }

  async resolveAgentExtensionPolicy(sessionId: string): Promise<AgentExtensionPolicy> {
    const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
    if (typeof this.dependencies.configPresenter.resolveDeepChatAgentConfig !== 'function') {
      return {}
    }

    try {
      const config = await this.dependencies.configPresenter.resolveDeepChatAgentConfig(agentId)
      return { enabledSkillNames: config.enabledSkillNames }
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to resolve extension policy for agent ${agentId}:`,
        error
      )
      return {}
    }
  }

  resetRuntimeActivatedSkills(sessionId: string): void {
    this.runtimeActivatedSkillsBySession.delete(sessionId)
  }

  setRuntimeActivatedSkills(sessionId: string, skillNames: string[]): void {
    const normalizedSkillNames = this.normalizeSkillNames(skillNames)
    if (normalizedSkillNames.length === 0) {
      return
    }
    this.runtimeActivatedSkillsBySession.set(sessionId, new Set(normalizedSkillNames))
  }

  getRuntimeActivatedSkills(sessionId: string): string[] {
    return this.normalizeSkillNames(
      Array.from(this.runtimeActivatedSkillsBySession.get(sessionId) ?? [])
    )
  }

  async activateRuntimeSkill(sessionId: string, skillName: string): Promise<string[]> {
    const normalizedSkillName = skillName.trim()
    if (!normalizedSkillName) {
      return this.getRuntimeActivatedSkills(sessionId)
    }
    let activeSkills = this.runtimeActivatedSkillsBySession.get(sessionId)
    if (!activeSkills) {
      activeSkills = new Set<string>()
      this.runtimeActivatedSkillsBySession.set(sessionId, activeSkills)
    }
    activeSkills.add(normalizedSkillName)
    this.invalidateSessionCaches(sessionId)
    return this.getRuntimeActivatedSkills(sessionId)
  }

  resolveEffectiveActiveSkillNames(sessionActiveSkillNames: string[], sessionId: string): string[] {
    return this.normalizeSkillNames([
      ...sessionActiveSkillNames,
      ...this.getRuntimeActivatedSkills(sessionId)
    ])
  }

  normalizeSkillNames(skillNames: string[]): string[] {
    return Array.from(
      new Set(skillNames.map((name) => name.trim()).filter((name) => name.length > 0))
    ).sort((left, right) => left.localeCompare(right))
  }

  normalizeNullablePolicyList(value?: string[] | null): string[] | null | undefined {
    if (value === null || value === undefined) {
      return value
    }
    return this.normalizeSkillNames(value)
  }

  filterSkillNamesByPolicy(
    skillNames: string[] | undefined,
    policy: AgentExtensionPolicy
  ): string[] {
    const normalizedSkillNames = this.normalizeSkillNames(skillNames ?? [])
    if (policy.enabledSkillNames === null || policy.enabledSkillNames === undefined) {
      return normalizedSkillNames
    }
    const allowed = new Set(this.normalizeSkillNames(policy.enabledSkillNames))
    return normalizedSkillNames.filter((skillName) => allowed.has(skillName))
  }

  invalidateSystemPromptCache(sessionId: string): void {
    this.systemPromptCache.delete(sessionId)
  }

  invalidateToolProfileCache(sessionId: string): void {
    this.toolProfileCache.delete(sessionId)
  }

  invalidateSessionCaches(sessionId: string): void {
    this.invalidateSystemPromptCache(sessionId)
    this.invalidateToolProfileCache(sessionId)
  }

  clearSession(sessionId: string): void {
    this.systemPromptCache.delete(sessionId)
    this.toolProfileCache.delete(sessionId)
    this.runtimeActivatedSkillsBySession.delete(sessionId)
  }

  readonly handleToolRegistryChanged = (): void => {
    this.toolRegistryRevision += 1
    this.toolProfileCache.clear()
  }

  private async resolveToolProfile(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    extensionPolicy?: AgentExtensionPolicy
  ): Promise<{ kind: ToolProfileKind; fingerprint: string }> {
    const normalizedProjectDir = projectDir?.trim() || null
    const skillsEnabled = this.dependencies.configPresenter.getSkillsEnabled()
    const policy = extensionPolicy ?? (await this.resolveAgentExtensionPolicy(sessionId))
    const activeSkillNames = this.filterSkillNamesByPolicy(
      activeSkillNamesOverride ?? (await this.resolveActiveSkillNamesForToolProfile(sessionId)),
      policy
    )
    const disabledAgentTools = this.host.getDisabledAgentTools(sessionId)
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
    const kind: ToolProfileKind = normalizedProjectDir ? 'code' : 'general'

    return {
      kind,
      fingerprint: JSON.stringify({
        kind,
        agentId,
        projectDir: normalizedProjectDir ?? '',
        providerId: state?.providerId ?? '',
        modelId: state?.modelId ?? '',
        toolRegistryRevision: this.toolRegistryRevision,
        disabledAgentTools: [...disabledAgentTools].sort((left, right) =>
          left.localeCompare(right)
        ),
        enabledSkillNames: this.normalizeNullablePolicyList(policy.enabledSkillNames),
        skillsEnabled,
        activeSkillNames
      })
    }
  }

  private normalizeSkillMetadata(
    skills: Array<{
      name: string
      description: string
      category?: string | null
      platforms?: string[]
    }>
  ): Array<{
    name: string
    description: string
    category?: string | null
    platforms?: string[]
  }> {
    const deduped = new Map<string, (typeof skills)[number]>()
    for (const skill of skills) {
      const name = skill.name.trim()
      if (!name || deduped.has(name)) continue
      deduped.set(name, {
        ...skill,
        name,
        description: skill.description.trim(),
        category: skill.category?.trim() || null,
        platforms: skill.platforms?.map((platform) => platform.trim()).filter(Boolean)
      })
    }
    return Array.from(deduped.values()).sort((left, right) => {
      return (
        (left.category ?? '').localeCompare(right.category ?? '') ||
        left.name.localeCompare(right.name)
      )
    })
  }

  private buildSystemPromptFingerprint(params: {
    providerId: string
    modelId: string
    workdir: string | null
    basePrompt: string
    skillsEnabled: boolean
    availableSkillNames: string[]
    activeSkillNames: string[]
    toolSignature: string[]
    skillDraftSuggestionsEnabled: boolean
  }): string {
    return JSON.stringify({
      providerId: params.providerId,
      modelId: params.modelId,
      workdir: params.workdir ?? '',
      basePrompt: params.basePrompt,
      skillsEnabled: params.skillsEnabled,
      availableSkillNames: params.availableSkillNames,
      activeSkillNames: params.activeSkillNames,
      toolSignature: params.toolSignature,
      skillDraftSuggestionsEnabled: params.skillDraftSuggestionsEnabled
    })
  }

  private getAgentToolNames(toolDefinitions: MCPToolDefinition[]): Set<string> {
    return new Set(
      toolDefinitions.filter((tool) => tool.source === 'agent').map((tool) => tool.function.name)
    )
  }

  private buildToolSignature(toolDefinitions: MCPToolDefinition[]): string[] {
    return toolDefinitions
      .filter((tool) => tool.source === 'agent')
      .map((tool) => `${tool.server.name}:${tool.function.name}`)
      .sort((left, right) => left.localeCompare(right))
  }

  private buildLocalDayKey(now: Date): string {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private composePromptSections(sections: string[]): string {
    return sections
      .map((section) => section.trim())
      .filter((section) => section.length > 0)
      .join('\n\n')
  }

  private buildPermissionRulesPrompt(agentToolNames: Set<string>): string {
    const readOnlyTools = ['read'].filter((toolName) => agentToolNames.has(toolName))
    const serializedTools = ['write', 'edit', 'exec', 'process'].filter((toolName) =>
      agentToolNames.has(toolName)
    )
    if (readOnlyTools.length === 0 && serializedTools.length === 0) return ''

    const lines = ['## Permission Rules']
    if (readOnlyTools.length > 0) {
      lines.push(
        `Read-only Agent tools may be batched in parallel when useful: ${readOnlyTools
          .map((toolName) => `\`${toolName}\``)
          .join(', ')}.`
      )
    }
    if (serializedTools.length > 0) {
      lines.push(
        `Mutating and runtime tools stay serialized or permission-gated: ${serializedTools
          .map((toolName) => `\`${toolName}\``)
          .join(', ')}.`
      )
    }
    lines.push('Do not assume approval for file writes or commands when the session asks for it.')
    return lines.join('\n')
  }

  private buildVerificationPolicyPrompt(workdir: string | null): string {
    const lines = [
      '## Verification Policy',
      'After changing code, configuration, tests, docs that affect behavior, or generated assets, check verification status before the final response.',
      'If verification was not run, state the reason explicitly in the final response.'
    ]
    const normalizedWorkdir = workdir?.trim()
    if (!normalizedWorkdir) return lines.join('\n')

    const verificationScripts = getVerificationScriptNames(normalizedWorkdir)
    const manifest = readPackageJsonManifest(normalizedWorkdir)
    const isDeepChatWorkspace =
      String(manifest?.name ?? '').toLowerCase() === 'deepchat' ||
      ['format', 'i18n', 'lint'].every((scriptName) => verificationScripts.includes(scriptName))
    if (isDeepChatWorkspace) {
      lines.push(
        'In the DeepChat repository, prioritize `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after feature work.'
      )
    } else if (verificationScripts.length > 0) {
      const suggestedScripts = verificationScripts
        .slice(0, 4)
        .map((scriptName) => `\`${scriptName}\``)
      lines.push(
        `When relevant, prefer project-local verification scripts such as ${suggestedScripts.join(', ')}.`
      )
    }
    return lines.join('\n')
  }

  private buildSkillsMetadataPrompt(
    availableSkills: Array<{
      name: string
      description: string
      category?: string | null
      platforms?: string[]
    }>,
    capabilities: {
      canListSkills: boolean
      canViewSkills: boolean
      canManageDraftSkills: boolean
      canRunSkillScripts: boolean
    },
    skillDraftSuggestionsEnabled: boolean
  ): string {
    if (
      !capabilities.canListSkills &&
      !capabilities.canViewSkills &&
      !capabilities.canManageDraftSkills &&
      !capabilities.canRunSkillScripts
    ) {
      return ''
    }

    const lines = ['## Skills']
    let hasContent = false
    if (capabilities.canListSkills || capabilities.canViewSkills) {
      lines.push(
        'Before replying, always scan available skills. If any skill plausibly matches the task, call `skill_view` first.'
      )
      lines.push(
        'Viewing a skill root `SKILL.md` activates that skill for the current message/tool loop; it does not pin the skill to the conversation. Viewing linked skill files is read-only and does not activate the skill.'
      )
      hasContent = true
    }
    if (capabilities.canRunSkillScripts) {
      lines.push(
        'Use `skill_run` only for skills that are active in the current message/tool loop, including manually pinned skills and skills activated by `skill_view`.'
      )
      hasContent = true
    }
    if (capabilities.canManageDraftSkills && skillDraftSuggestionsEnabled) {
      lines.push(
        'After completing a complex task, solving a tricky bug, or discovering a non-trivial workflow, you may draft a reusable skill with `skill_manage`.'
      )
      lines.push(
        'Only propose one draft per task, do it after the main answer is complete, and use `deepchat_question` to ask whether the user wants to keep the draft.'
      )
      lines.push(
        'Do not modify installed skills with `skill_manage`; it is draft-only in this version.'
      )
      hasContent = true
    }

    if (availableSkills.length > 0) {
      lines.push('<available_skills>')
      lines.push(
        ...availableSkills.map((skill) => {
          const details: string[] = []
          if (skill.category) details.push(`category=${skill.category}`)
          if (skill.platforms?.length) details.push(`platforms=${skill.platforms.join(',')}`)
          const suffix = details.length > 0 ? ` [${details.join('; ')}]` : ''
          return `- ${skill.name}: ${skill.description}${suffix}`
        })
      )
      lines.push('</available_skills>')
      hasContent = true
    } else if (hasContent) {
      lines.push('<available_skills>')
      lines.push('(none)')
      lines.push('</available_skills>')
    }
    return hasContent ? lines.join('\n') : ''
  }

  private buildPinnedSkillsPrompt(skillSections: string[]): string {
    if (skillSections.length === 0) return ''
    return [
      '## Active Skills',
      'These skills are active for the current message context. Some may be manually pinned for the conversation; others may have been activated by `skill_view` for this message/tool loop only. Follow them when relevant.',
      '',
      skillSections.join('\n\n')
    ].join('\n')
  }

  private throwIfAbortRequested(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw createAbortError()
    }
  }

  private logSlowPreStreamStep(sessionId: string, step: string, startedAt: number): void {
    const elapsed = Date.now() - startedAt
    if (elapsed < PRE_STREAM_SLOW_STEP_MS) return
    logger.warn(
      `[DeepChatAgent] pre-stream step slow session=${sessionId} step=${step} elapsed=${elapsed}ms`
    )
  }
}
