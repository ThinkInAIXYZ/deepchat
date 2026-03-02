import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  DeepChatSessionState,
  IAgentImplementation,
  PermissionMode,
  ToolInteractionResponse,
  ToolInteractionResult,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { MCPToolCall, MCPToolResponse } from '@shared/types/core/mcp'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { IConfigPresenter, ILlmProviderPresenter, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS, STREAM_EVENTS } from '@/events'
import { presenter } from '@/presenter'
import { buildContext, buildResumeContext } from './contextBuilder'
import { DeepChatMessageStore } from './messageStore'
import { processStream } from './process'
import { DeepChatSessionStore } from './sessionStore'
import type { PendingToolInteraction, ProcessResult } from './types'

type PendingInteractionEntry = {
  interaction: PendingToolInteraction
  blockIndex: number
}

type DeferredToolExecutionResult = {
  responseText: string
  isError: boolean
  requiresPermission?: boolean
  permissionRequest?: PendingToolInteraction['permission']
}

export class DeepChatAgentPresenter implements IAgentImplementation {
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly configPresenter: IConfigPresenter
  private readonly toolPresenter: IToolPresenter | null
  private readonly sessionStore: DeepChatSessionStore
  private readonly messageStore: DeepChatMessageStore
  private readonly runtimeState: Map<string, DeepChatSessionState> = new Map()
  private readonly abortControllers: Map<string, AbortController> = new Map()
  private readonly sessionProjectDirs: Map<string, string | null> = new Map()
  private readonly interactionLocks: Set<string> = new Set()
  private readonly resumingMessages: Set<string> = new Set()

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    toolPresenter?: IToolPresenter
  ) {
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.toolPresenter = toolPresenter ?? null
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)

    const recovered = this.messageStore.recoverPendingMessages()
    if (recovered > 0) {
      console.log(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
    }
  }

  async initSession(
    sessionId: string,
    config: { providerId: string; modelId: string; projectDir?: string | null }
  ): Promise<void> {
    const projectDir = this.normalizeProjectDir(config.projectDir)
    console.log(
      `[DeepChatAgent] initSession id=${sessionId} provider=${config.providerId} model=${config.modelId} projectDir=${projectDir ?? '<none>'}`
    )
    this.sessionStore.create(sessionId, config.providerId, config.modelId, 'full_access')
    this.sessionProjectDirs.set(sessionId, projectDir)
    this.runtimeState.set(sessionId, {
      status: 'idle',
      providerId: config.providerId,
      modelId: config.modelId,
      permissionMode: 'full_access'
    })
  }

  async destroySession(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }

    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.delete(sessionId)
    this.runtimeState.delete(sessionId)
    this.sessionProjectDirs.delete(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    const state = this.runtimeState.get(sessionId)
    if (state) {
      if (this.hasPendingInteractions(sessionId)) {
        state.status = 'generating'
      }
      return { ...state }
    }

    const dbSession = this.sessionStore.get(sessionId)
    if (!dbSession) return null

    const rebuilt: DeepChatSessionState = {
      status: this.hasPendingInteractions(sessionId) ? 'generating' : 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id,
      permissionMode: dbSession.permission_mode || 'full_access'
    }
    this.runtimeState.set(sessionId, rebuilt)
    return { ...rebuilt }
  }

  async processMessage(
    sessionId: string,
    content: string,
    context?: { projectDir?: string | null }
  ): Promise<void> {
    const state = this.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const projectDir = this.resolveProjectDir(sessionId, context?.projectDir)
    console.log(
      `[DeepChatAgent] processMessage session=${sessionId} content="${content.slice(0, 60)}" projectDir=${projectDir ?? '<none>'}`
    )

    this.setSessionStatus(sessionId, 'generating')

    try {
      const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
      const maxTokens = modelConfig.maxTokens ?? 4096
      const systemPrompt = await this.configPresenter.getDefaultSystemPrompt()
      const messages = buildContext(
        sessionId,
        content,
        systemPrompt,
        modelConfig.contextLength,
        maxTokens,
        this.messageStore
      )

      const userOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      const userContent: UserMessageContent = {
        text: content,
        files: [],
        links: [],
        search: false,
        think: false
      }
      this.messageStore.createUserMessage(sessionId, userOrderSeq, userContent)

      const assistantOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      const assistantMessageId = this.messageStore.createAssistantMessage(
        sessionId,
        assistantOrderSeq
      )

      const result = await this.runStreamForMessage({
        sessionId,
        messageId: assistantMessageId,
        messages,
        projectDir
      })
      this.applyProcessResultStatus(sessionId, result)
    } catch (err) {
      console.error('[DeepChatAgent] processMessage error:', err)
      this.setSessionStatus(sessionId, 'error')
    }
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const lockKey = `${messageId}:${toolCallId}`
    if (this.interactionLocks.has(lockKey)) {
      return { resumed: false }
    }
    this.interactionLocks.add(lockKey)

    try {
      const message = await this.messageStore.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Assistant message not found: ${messageId}`)
      }
      if (message.sessionId !== sessionId) {
        throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
      }

      const blocks = this.parseAssistantBlocks(message.content)
      const pendingEntries = this.collectPendingInteractionEntries(messageId, blocks)
      if (pendingEntries.length === 0) {
        throw new Error('No pending interaction found in target message.')
      }

      const currentEntry = pendingEntries[0]
      if (currentEntry.interaction.toolCallId !== toolCallId) {
        throw new Error('Interaction queue out of order. Please handle the first pending item.')
      }

      let waitingForUserMessage = false
      const actionBlock = blocks[currentEntry.blockIndex]
      const toolCall = actionBlock.tool_call
      if (!toolCall?.id) {
        throw new Error('Invalid action block without tool call id.')
      }

      if (actionBlock.action_type === 'question_request') {
        if (response.kind === 'permission') {
          throw new Error('Invalid response kind for question interaction.')
        }

        if (response.kind === 'question_other') {
          const deferredResult = 'User chose to answer with a follow-up message.'
          this.markQuestionResolved(actionBlock, '')
          this.updateToolCallResponse(blocks, toolCall.id, deferredResult, false)
          waitingForUserMessage = true
        } else {
          const answerText =
            response.kind === 'question_option' ? response.optionLabel : response.answerText
          const normalizedAnswer = answerText.trim()
          if (!normalizedAnswer) {
            throw new Error('Answer cannot be empty.')
          }
          this.markQuestionResolved(actionBlock, normalizedAnswer)
          this.updateToolCallResponse(blocks, toolCall.id, normalizedAnswer, false)
        }
      } else if (actionBlock.action_type === 'tool_call_permission') {
        if (response.kind !== 'permission') {
          throw new Error('Invalid response kind for permission interaction.')
        }
        const permissionPayload = this.parsePermissionPayload(actionBlock)
        const permissionType = permissionPayload?.permissionType ?? 'write'

        if (response.granted) {
          this.markPermissionResolved(actionBlock, true, permissionType)
          await this.grantPermissionForPayload(sessionId, permissionPayload, toolCall)
          const execution = await this.executeDeferredToolCall(sessionId, toolCall)
          this.updateToolCallResponse(
            blocks,
            toolCall.id,
            execution.responseText,
            execution.isError
          )

          if (execution.requiresPermission && execution.permissionRequest) {
            actionBlock.status = 'pending'
            actionBlock.content = execution.permissionRequest.description
            actionBlock.extra = {
              ...actionBlock.extra,
              needsUserAction: true,
              permissionType: execution.permissionRequest.permissionType,
              permissionRequest: JSON.stringify(execution.permissionRequest)
            }
          }
        } else {
          this.markPermissionResolved(actionBlock, false, permissionType)
          this.updateToolCallResponse(blocks, toolCall.id, 'User denied the request.', true)
        }
      } else {
        throw new Error(`Unsupported action type: ${actionBlock.action_type}`)
      }

      this.messageStore.updateAssistantContent(messageId, blocks)
      const remainingPending = this.collectPendingInteractionEntries(messageId, blocks)
      this.emitMessageRefresh(sessionId, messageId)

      if (remainingPending.length > 0) {
        this.messageStore.updateMessageStatus(messageId, 'pending')
        this.setSessionStatus(sessionId, 'generating')
        return { resumed: false }
      }

      if (waitingForUserMessage) {
        this.messageStore.updateMessageStatus(messageId, 'sent')
        this.setSessionStatus(sessionId, 'idle')
        return { resumed: false, waitingForUserMessage: true }
      }

      await this.resumeAssistantMessage(sessionId, messageId, blocks)
      return { resumed: true }
    } finally {
      this.interactionLocks.delete(lockKey)
    }
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const normalizedMode: PermissionMode = mode === 'default' ? 'default' : 'full_access'
    const state = this.runtimeState.get(sessionId)
    if (state) {
      state.permissionMode = normalizedMode
    }
    this.sessionStore.updatePermissionMode(sessionId, normalizedMode)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    const state = this.runtimeState.get(sessionId)
    if (state) {
      return state.permissionMode
    }
    const dbSession = this.sessionStore.get(sessionId)
    return dbSession?.permission_mode || 'full_access'
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }
    this.setSessionStatus(sessionId, 'idle')
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return this.messageStore.getMessages(sessionId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return this.messageStore.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return this.messageStore.getMessage(messageId)
  }

  private async runStreamForMessage(args: {
    sessionId: string
    messageId: string
    messages: ChatMessage[]
    projectDir: string | null
    initialBlocks?: AssistantMessageBlock[]
  }): Promise<ProcessResult> {
    const { sessionId, messageId, messages, projectDir, initialBlocks } = args
    const state = this.runtimeState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const provider = (
      this.llmProviderPresenter as unknown as {
        getProviderInstance: (id: string) => {
          coreStream: (
            messages: ChatMessage[],
            modelId: string,
            modelConfig: ModelConfig,
            temperature: number,
            maxTokens: number,
            tools: import('@shared/presenter').MCPToolDefinition[]
          ) => AsyncGenerator<import('@shared/types/core/llm-events').LLMCoreStreamEvent>
        }
      }
    ).getProviderInstance(state.providerId)

    const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
    const temperature = modelConfig.temperature ?? 0.7
    const maxTokens = modelConfig.maxTokens ?? 4096

    let tools: import('@shared/presenter').MCPToolDefinition[] = []
    if (this.toolPresenter) {
      try {
        tools = await this.toolPresenter.getAllToolDefinitions({
          chatMode: 'agent',
          conversationId: sessionId,
          agentWorkspacePath: projectDir
        })
      } catch (error) {
        console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
      }
    }

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    try {
      return await processStream({
        messages,
        tools,
        toolPresenter: this.toolPresenter,
        coreStream: provider.coreStream.bind(provider),
        modelId: state.modelId,
        modelConfig,
        temperature,
        maxTokens,
        permissionMode: state.permissionMode,
        initialBlocks,
        io: {
          sessionId,
          messageId,
          messageStore: this.messageStore,
          abortSignal: abortController.signal
        }
      })
    } finally {
      const active = this.abortControllers.get(sessionId)
      if (active === abortController) {
        this.abortControllers.delete(sessionId)
      }
    }
  }

  private applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined
  ): void {
    if (!result || !result.status) {
      this.setSessionStatus(sessionId, 'idle')
      return
    }
    if (result.status === 'completed') {
      this.setSessionStatus(sessionId, 'idle')
      return
    }
    if (result.status === 'paused') {
      this.setSessionStatus(sessionId, 'generating')
      return
    }
    if (result.status === 'aborted') {
      this.setSessionStatus(sessionId, 'idle')
      return
    }
    this.setSessionStatus(sessionId, 'error')
  }

  private async resumeAssistantMessage(
    sessionId: string,
    messageId: string,
    initialBlocks: AssistantMessageBlock[]
  ): Promise<void> {
    if (this.resumingMessages.has(messageId)) {
      return
    }
    this.resumingMessages.add(messageId)

    try {
      const state = this.runtimeState.get(sessionId)
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }

      this.setSessionStatus(sessionId, 'generating')
      const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
      const maxTokens = modelConfig.maxTokens ?? 4096
      const systemPrompt = await this.configPresenter.getDefaultSystemPrompt()
      const resumeContext = buildResumeContext(
        sessionId,
        messageId,
        systemPrompt,
        modelConfig.contextLength,
        maxTokens,
        this.messageStore
      )

      const result = await this.runStreamForMessage({
        sessionId,
        messageId,
        messages: resumeContext,
        projectDir: this.resolveProjectDir(sessionId),
        initialBlocks
      })
      this.applyProcessResultStatus(sessionId, result)
    } catch (error) {
      console.error('[DeepChatAgent] resumeAssistantMessage error:', error)
      this.setSessionStatus(sessionId, 'error')
      throw error
    } finally {
      this.resumingMessages.delete(messageId)
    }
  }

  private parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
    try {
      const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private collectPendingInteractionEntries(
    messageId: string,
    blocks: AssistantMessageBlock[]
  ): PendingInteractionEntry[] {
    const entries: PendingInteractionEntry[] = []

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      if (
        block.type !== 'action' ||
        (block.action_type !== 'tool_call_permission' &&
          block.action_type !== 'question_request') ||
        block.status !== 'pending' ||
        block.extra?.needsUserAction === false
      ) {
        continue
      }

      const toolCallId = block.tool_call?.id
      if (!toolCallId) {
        continue
      }

      const toolName = block.tool_call?.name || ''
      const toolArgs = block.tool_call?.params || ''

      if (block.action_type === 'question_request') {
        entries.push({
          blockIndex: index,
          interaction: {
            type: 'question',
            messageId,
            toolCallId,
            toolName,
            toolArgs,
            serverName: block.tool_call?.server_name,
            serverIcons: block.tool_call?.server_icons,
            serverDescription: block.tool_call?.server_description,
            question: {
              header:
                typeof block.extra?.questionHeader === 'string' ? block.extra.questionHeader : '',
              question:
                typeof block.extra?.questionText === 'string' ? block.extra.questionText : '',
              options: this.parseQuestionOptions(block.extra?.questionOptions),
              custom: block.extra?.questionCustom !== false,
              multiple: Boolean(block.extra?.questionMultiple)
            }
          }
        })
        continue
      }

      entries.push({
        blockIndex: index,
        interaction: {
          type: 'permission',
          messageId,
          toolCallId,
          toolName,
          toolArgs,
          serverName: block.tool_call?.server_name,
          serverIcons: block.tool_call?.server_icons,
          serverDescription: block.tool_call?.server_description,
          permission: this.parsePermissionPayload(block)
        }
      })
    }

    return entries
  }

  private parseQuestionOptions(raw: unknown): Array<{ label: string; description?: string }> {
    const parseOption = (value: unknown): { label: string; description?: string } | null => {
      if (!value || typeof value !== 'object') return null
      const candidate = value as { label?: unknown; description?: unknown }
      if (typeof candidate.label !== 'string') return null
      const label = candidate.label.trim()
      if (!label) return null
      if (typeof candidate.description === 'string' && candidate.description.trim()) {
        return { label, description: candidate.description.trim() }
      }
      return { label }
    }

    if (Array.isArray(raw)) {
      return raw
        .map((item) => parseOption(item))
        .filter((item): item is { label: string; description?: string } => Boolean(item))
    }
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => parseOption(item))
            .filter((item): item is { label: string; description?: string } => Boolean(item))
        }
      } catch {
        return []
      }
    }
    return []
  }

  private parsePermissionPayload(
    block: AssistantMessageBlock
  ): PendingToolInteraction['permission'] | undefined {
    const rawPayload = block.extra?.permissionRequest
    if (typeof rawPayload === 'string' && rawPayload.trim()) {
      try {
        const parsed = JSON.parse(rawPayload) as PendingToolInteraction['permission']
        if (parsed && typeof parsed === 'object') {
          return {
            ...parsed,
            permissionType:
              parsed.permissionType === 'read' ||
              parsed.permissionType === 'write' ||
              parsed.permissionType === 'all' ||
              parsed.permissionType === 'command'
                ? parsed.permissionType
                : 'write'
          }
        }
      } catch {
        // ignore parsing failure
      }
    }

    const permissionType = block.extra?.permissionType
    return {
      permissionType:
        permissionType === 'read' ||
        permissionType === 'write' ||
        permissionType === 'all' ||
        permissionType === 'command'
          ? permissionType
          : 'write',
      description: typeof block.content === 'string' ? block.content : '',
      toolName:
        typeof block.extra?.toolName === 'string' ? block.extra.toolName : block.tool_call?.name,
      serverName:
        typeof block.extra?.serverName === 'string'
          ? block.extra.serverName
          : block.tool_call?.server_name,
      providerId: typeof block.extra?.providerId === 'string' ? block.extra.providerId : undefined,
      requestId:
        typeof block.extra?.permissionRequestId === 'string'
          ? block.extra.permissionRequestId
          : undefined
    }
  }

  private markQuestionResolved(block: AssistantMessageBlock, answerText: string): void {
    block.status = 'success'
    block.extra = {
      ...block.extra,
      needsUserAction: false,
      questionResolution: 'replied',
      ...(answerText ? { answerText } : {})
    }
  }

  private markPermissionResolved(
    block: AssistantMessageBlock,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command'
  ): void {
    block.status = granted ? 'granted' : 'denied'
    block.extra = {
      ...block.extra,
      needsUserAction: false,
      ...(granted ? { grantedPermissions: permissionType } : {})
    }
    if (!granted) {
      block.content = 'User denied the request.'
    }
  }

  private updateToolCallResponse(
    blocks: AssistantMessageBlock[],
    toolCallId: string,
    responseText: string,
    isError: boolean
  ): void {
    const toolBlock = blocks.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
    )
    if (!toolBlock?.tool_call) return
    toolBlock.tool_call.response = responseText
    toolBlock.status = isError ? 'error' : 'success'
  }

  private async grantPermissionForPayload(
    sessionId: string,
    payload: PendingToolInteraction['permission'] | undefined,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): Promise<void> {
    if (!payload) return

    const permissionType = payload.permissionType
    const serverName = payload.serverName || toolCall.server_name || ''
    const toolName = payload.toolName || toolCall.name || ''

    if (permissionType === 'command') {
      const command = payload.command || payload.commandInfo?.command || ''
      const signature =
        payload.commandSignature ||
        payload.commandInfo?.signature ||
        (command ? presenter.commandPermissionService.extractCommandSignature(command) : '')
      if (signature) {
        presenter.commandPermissionService.approve(sessionId, signature, false)
      }
      return
    }

    if (serverName === 'agent-filesystem' && Array.isArray(payload.paths) && payload.paths.length) {
      presenter.filePermissionService?.approve(sessionId, payload.paths, false)
      return
    }

    if (serverName === 'deepchat-settings' && toolName) {
      presenter.settingsPermissionService?.approve(sessionId, toolName, false)
      return
    }

    if (
      serverName &&
      (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
    ) {
      await presenter.mcpPresenter.grantPermission(serverName, permissionType, false, sessionId)
    }
  }

  private async executeDeferredToolCall(
    sessionId: string,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): Promise<DeferredToolExecutionResult> {
    if (!this.toolPresenter) {
      return {
        responseText: 'Tool presenter is not available.',
        isError: true
      }
    }

    const toolName = toolCall.name
    if (!toolName) {
      return {
        responseText: 'Invalid tool call without tool name.',
        isError: true
      }
    }

    const projectDir = this.resolveProjectDir(sessionId)
    let toolDefinitions: import('@shared/presenter').MCPToolDefinition[] = []
    try {
      toolDefinitions = await this.toolPresenter.getAllToolDefinitions({
        chatMode: 'agent',
        conversationId: sessionId,
        agentWorkspacePath: projectDir
      })
    } catch (error) {
      console.error(
        '[DeepChatAgent] Failed to load tool definitions for deferred execution:',
        error
      )
    }

    const toolDefinition = toolDefinitions.find((definition) => {
      if (definition.function.name !== toolName) {
        return false
      }
      if (toolCall.server_name) {
        return definition.server.name === toolCall.server_name
      }
      return true
    })

    const request: MCPToolCall = {
      id: toolCall.id || '',
      type: 'function',
      function: {
        name: toolName,
        arguments: toolCall.params || '{}'
      },
      server: toolDefinition?.server,
      conversationId: sessionId
    }

    try {
      const result = await this.toolPresenter.callTool(request)
      const rawData = result.rawData as MCPToolResponse
      if (rawData.requiresPermission) {
        return {
          responseText: this.toolContentToText(rawData.content),
          isError: true,
          requiresPermission: true,
          permissionRequest: rawData.permissionRequest as PendingToolInteraction['permission']
        }
      }
      return {
        responseText: this.toolContentToText(rawData.content),
        isError: Boolean(rawData.isError)
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      return {
        responseText: `Error: ${errorText}`,
        isError: true
      }
    }
  }

  private toolContentToText(content: MCPToolResponse['content']): string {
    if (typeof content === 'string') {
      return content
    }
    if (!Array.isArray(content)) {
      return ''
    }
    return content
      .map((item) => {
        if (item.type === 'text') return item.text
        if (item.type === 'resource' && item.resource?.text) return item.resource.text
        return `[${item.type}]`
      })
      .join('\n')
  }

  private hasPendingInteractions(sessionId: string): boolean {
    const messages = this.messageStore.getMessages(sessionId)
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const blocks = this.parseAssistantBlocks(message.content)
      const pendingEntries = this.collectPendingInteractionEntries(message.id, blocks)
      if (pendingEntries.length > 0) {
        return true
      }
    }
    return false
  }

  private setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void {
    const current = this.runtimeState.get(sessionId)
    if (!current) {
      return
    }
    if (current.status === status) {
      return
    }
    current.status = status
    eventBus.sendToRenderer(SESSION_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      sessionId,
      status
    })
  }

  private emitMessageRefresh(sessionId: string, messageId: string): void {
    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      eventId: messageId,
      messageId
    })
  }

  private normalizeProjectDir(projectDir?: string | null): string | null {
    const normalized = projectDir?.trim()
    return normalized ? normalized : null
  }

  private resolveProjectDir(sessionId: string, incoming?: string | null): string | null {
    if (incoming !== undefined) {
      const normalized = this.normalizeProjectDir(incoming)
      this.sessionProjectDirs.set(sessionId, normalized)
      return normalized
    }
    return this.sessionProjectDirs.get(sessionId) ?? null
  }
}
