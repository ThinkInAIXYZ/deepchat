import type {
  AssistantMessageBlock,
  DeepChatSessionState,
  MessageMetadata,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SkillServicePort } from '@shared/types/skill'
import logger from '@shared/logger'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { SessionPermissionPort } from '@/session/contracts'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import {
  insertBlocksAfterToolCall,
  prepareToolImagePreviewPresentation
} from './imageGenerationBlocks'
import {
  buildSkillDraftToolResponse,
  collectPendingInteractionEntries,
  hasQuestionFollowUpIntent,
  isSkillDraftConfirmationBlock,
  markPermissionResolved,
  markQuestionResolved,
  parseAssistantBlocks,
  parsePermissionPayload,
  reconcilePendingInteractionEntries,
  replacePendingInteractions,
  resolveSkillDraftChoice,
  SKILL_DRAFT_ACTION_LABELS,
  SKILL_DRAFT_STATUS_BY_CHOICE,
  updateSkillDraftQuestionOptions,
  updateSkillDraftToolCallResponse,
  updateToolCallResponse
} from './interactionProjection'
import { redactRuntimeErrorForLog } from './runtimeErrorLogging'
import type { SessionTranscript } from '@/session/data/transcript'
import type { ProviderPermissionCoordinator } from './providerPermissionCoordinator'
import { MAX_TOOL_CALLS_SKIPPED_ERROR } from './process'
import {
  buildUsageFromMetadata,
  incrementToolCallAccounting,
  stampTerminalMetadata
} from './runtimeMetadata'
import type { DeferredToolExecutionResult } from './deferredToolExecutor'
import type { DeepChatEventPublisher, PendingToolInteraction, ProcessResult } from './types'
import { parseMessageMetadata } from '@/session/usageStats'
import { MAX_TOOL_CALLS } from '@/agent/deepchat/loop/deepChatLoopEngine'

export type ResumeBudgetToolCall = {
  id: string
  name: string
  offloadPath?: string
}

type SkillDraftPresenter = Pick<
  SkillServicePort,
  'viewDraftSkill' | 'installDraftSkill' | 'discardDraftSkill'
>

type RuntimeHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'Stop'
  | 'SessionEnd'

type RuntimeHookContext = {
  sessionId: string
  messageId?: string
  providerId?: string
  modelId?: string
  projectDir?: string | null
  tool?: {
    callId?: string
    name?: string
    params?: string
    response?: string
    error?: string
  }
  permission?: Record<string, unknown> | null
  stop?: { reason?: string; userStop?: boolean } | null
  usage?: Record<string, number> | null
  error?: { message?: string; stack?: string } | null
}

export interface InteractionCoordinatorPorts {
  messageStore: SessionTranscript
  providerPermissionCoordinator: ProviderPermissionCoordinator
  skillService: SkillDraftPresenter
  getDeepChatInstance(sessionId: string): DeepChatAgentInstance
  getRuntimeState(sessionId: string): DeepChatSessionState | undefined
  ensureSessionAbortController(sessionId: string): AbortController
  clearSessionAbortController(sessionId: string, controller?: AbortController): void
  throwIfAbortRequested(signal?: AbortSignal): void
  isAbortError(error: unknown): boolean
  isCurrentInstance(sessionId: string, expectedInstance: DeepChatAgentInstance): boolean
  resolveProjectDir(sessionId: string): string | null
  sessionPermissionPort: SessionPermissionPort
  executeDeferredToolCall(
    sessionId: string,
    messageId: string,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>,
    onToolCallStarted?: () => void
  ): Promise<DeferredToolExecutionResult>
  emitMessageRefresh(sessionId: string, messageId: string): void
  resolveStreamRequestId(sessionId: string, messageId: string): string
  setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void
  dispatchHook(event: RuntimeHookEvent, context: RuntimeHookContext): void
  dispatchTerminalHooks(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void
  settleAbortedTurn(
    sessionId: string,
    messageId: string | null,
    runId?: string,
    metadata?: string
  ): void
  drainPendingQueueIfPossible(sessionId: string, reason: 'enqueue' | 'completed'): Promise<boolean>
  resumeAssistantMessage(
    sessionId: string,
    messageId: string,
    initialBlocks: AssistantMessageBlock[],
    budgetToolCall?: ResumeBudgetToolCall | null,
    initialAccounting?: MessageMetadata
  ): Promise<boolean>
  publishEvent: DeepChatEventPublisher
}

export class InteractionCoordinator {
  constructor(private readonly ports: InteractionCoordinatorPorts) {}

  async respond(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const instance = this.ports.getDeepChatInstance(sessionId)
    if (!instance.tryLockInteraction(messageId, toolCallId)) {
      return { resumed: false }
    }

    const interactionOwnerRun = instance.getActiveGeneration()
    const interactionOwnedByActiveRun = interactionOwnerRun?.messageId === messageId
    let interactionAbortController: AbortController | null = null
    let interactionAbortSignal: AbortSignal | undefined
    try {
      if (interactionOwnerRun) {
        if (interactionOwnedByActiveRun && interactionOwnerRun.abortController.signal.aborted) {
          return { resumed: false }
        }
        interactionAbortSignal = interactionOwnerRun.abortController.signal
      } else {
        interactionAbortController = this.ports.ensureSessionAbortController(sessionId)
        interactionAbortSignal = interactionAbortController.signal
      }
      this.ports.throwIfAbortRequested(interactionAbortSignal)
      const message = await this.ports.messageStore.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Assistant message not found: ${messageId}`)
      }
      if (message.sessionId !== sessionId) {
        throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
      }

      const blocks = parseAssistantBlocks(message.content)
      const pendingEntries = reconcilePendingInteractionEntries(
        instance,
        collectPendingInteractionEntries(messageId, blocks)
      )
      replacePendingInteractions(instance, pendingEntries)
      if (pendingEntries.length === 0) {
        throw new Error('No pending interaction found in target message.')
      }

      const firstPendingInteraction = instance.getFirstPendingInteraction()
      const currentEntry = pendingEntries[0]
      if (
        firstPendingInteraction?.messageId !== messageId ||
        firstPendingInteraction.toolCallId !== toolCallId
      ) {
        throw new Error('Interaction queue out of order. Please handle the first pending item.')
      }

      let waitingForUserMessage = false
      let resumeBudgetToolCall: ResumeBudgetToolCall | null = null
      let emitResolvedToolHook: (() => void) | null = null
      let resumeAccounting = parseMessageMetadata(message.metadata)
      let accountingChanged = false
      const actionBlock = blocks[currentEntry.blockIndex]
      const toolCall = actionBlock.tool_call
      if (!toolCall?.id) {
        throw new Error('Invalid action block without tool call id.')
      }

      if (actionBlock.action_type === 'question_request') {
        if (response.kind === 'permission') {
          throw new Error('Invalid response kind for question interaction.')
        }

        if (isSkillDraftConfirmationBlock(actionBlock)) {
          const result = await awaitWithAbort(
            this.handleSkillDraftInteraction(
              sessionId,
              instance,
              blocks,
              actionBlock,
              toolCall,
              response
            ),
            interactionAbortSignal
          )
          if (!this.ports.isCurrentInstance(sessionId, instance)) {
            return { resumed: false }
          }
          waitingForUserMessage = result.waitingForUserMessage
          if (result.keepPending) {
            this.ports.messageStore.updateAssistantContent(messageId, blocks)
            this.ports.emitMessageRefresh(sessionId, messageId)
            this.ports.messageStore.updateMessageStatus(messageId, 'pending')
            this.ports.setSessionStatus(sessionId, 'generating')
            return { resumed: false, handledInline: result.handledInline === true }
          }
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
        } else if (response.kind === 'question_other') {
          const deferredResult = 'User chose to answer with a follow-up message.'
          markQuestionResolved(actionBlock, '', true)
          updateToolCallResponse(blocks, toolCall.id, deferredResult, false)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
          waitingForUserMessage = true
        } else {
          const answerText =
            response.kind === 'question_option' ? response.optionLabel : response.answerText
          const normalizedAnswer = answerText.trim()
          if (!normalizedAnswer) {
            throw new Error('Answer cannot be empty.')
          }
          markQuestionResolved(actionBlock, normalizedAnswer)
          updateToolCallResponse(blocks, toolCall.id, normalizedAnswer, false)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
        }
      } else if (actionBlock.action_type === 'tool_call_permission') {
        if (response.kind !== 'permission') {
          throw new Error('Invalid response kind for permission interaction.')
        }
        const permissionPayload = parsePermissionPayload(actionBlock)
        const permissionType = permissionPayload?.permissionType ?? 'write'
        const requestId = permissionPayload?.requestId?.trim()
        const providerId = permissionPayload?.providerId?.trim()
        if (providerId === 'acp' && requestId) {
          await awaitWithAbort(
            this.ports.providerPermissionCoordinator.resolve({
              sessionId,
              messageId,
              toolCallId: toolCall.id,
              requestId,
              permissionType,
              granted: response.granted,
              ownerRun: interactionOwnerRun,
              signal: interactionAbortSignal
            }),
            interactionAbortSignal
          )
          return { resumed: false }
        }
        const state = this.ports.getRuntimeState(sessionId)
        const projectDir = this.ports.resolveProjectDir(sessionId)
        let shouldDispatchResolvedToolHook = false

        if (response.granted) {
          markPermissionResolved(actionBlock, true, permissionType)
          await awaitWithAbort(
            this.grantPermissionForPayload(sessionId, permissionPayload, toolCall),
            interactionAbortSignal
          )
          const nextToolCallAccounting = incrementToolCallAccounting(resumeAccounting)
          let deferredToolCallCounted = false
          const markDeferredToolCallStarted = () => {
            if (deferredToolCallCounted) {
              return
            }
            deferredToolCallCounted = true
            resumeAccounting = nextToolCallAccounting
            accountingChanged = true
            this.ports.messageStore.updateAssistantMetadata(
              messageId,
              JSON.stringify(resumeAccounting)
            )
          }
          let execution: DeferredToolExecutionResult
          if ((nextToolCallAccounting.toolCalls ?? 0) > MAX_TOOL_CALLS) {
            execution = {
              responseText: MAX_TOOL_CALLS_SKIPPED_ERROR,
              isError: true
            }
          } else {
            this.ports.dispatchHook('PreToolUse', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.params
              }
            })
            execution = await this.ports.executeDeferredToolCall(
              sessionId,
              messageId,
              toolCall,
              markDeferredToolCallStarted
            )
            if ((execution.invoked || execution.terminalError) && !deferredToolCallCounted) {
              markDeferredToolCallStarted()
            }
          }
          if (execution.invoked) {
            instance.advancePendingToolBatch({ invokedCallId: toolCall.id })
          }
          if (execution.terminalError) {
            const terminalMetadata = stampTerminalMetadata(resumeAccounting, 'error', 'tool_error')
            instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
            this.ports.dispatchHook('PostToolUseFailure', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.params,
                error: execution.terminalError
              }
            })
            updateToolCallResponse(blocks, toolCall.id, execution.terminalError, true)
            this.ports.messageStore.setMessageError(
              messageId,
              blocks,
              JSON.stringify(terminalMetadata)
            )
            this.ports.emitMessageRefresh(sessionId, messageId)
            this.ports.publishEvent('chat.stream.failed', {
              requestId: this.ports.resolveStreamRequestId(sessionId, messageId),
              sessionId,
              messageId,
              failedAt: Date.now(),
              error: execution.terminalError
            })
            this.ports.dispatchHook('Stop', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              stop: { reason: 'tool_error', userStop: false }
            })
            this.ports.dispatchHook('SessionEnd', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              usage: buildUsageFromMetadata(terminalMetadata) ?? null,
              error: { message: execution.terminalError }
            })
            this.ports.setSessionStatus(sessionId, 'error')
            replacePendingInteractions(
              instance,
              reconcilePendingInteractionEntries(
                instance,
                collectPendingInteractionEntries(messageId, blocks)
              )
            )
            return { resumed: false }
          }
          const imagePresentation = prepareToolImagePreviewPresentation({
            toolCallId: toolCall.id,
            toolName: toolCall.name || '',
            toolSource: execution.toolSource,
            serverName: execution.serverName,
            isError: execution.isError,
            imagePreviews: execution.imagePreviews
          })

          updateToolCallResponse(blocks, toolCall.id, execution.responseText, execution.isError, {
            rtkApplied: execution.rtkApplied,
            rtkMode: execution.rtkMode,
            rtkFallbackReason: execution.rtkFallbackReason,
            imagePreviews: imagePresentation.toolBlockImagePreviews
          })
          insertBlocksAfterToolCall(blocks, toolCall.id, imagePresentation.promotedBlocks)
          resumeBudgetToolCall = {
            id: toolCall.id,
            name: toolCall.name || '',
            offloadPath: execution.offloadPath
          }

          if (execution.requiresPermission && execution.permissionRequest) {
            instance.transitionPendingInteractionOrigin(
              messageId,
              toolCall.id,
              'post-call-permission'
            )
            this.ports.dispatchHook('PermissionRequest', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              permission: execution.permissionRequest,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.params
              }
            })
            actionBlock.status = 'pending'
            actionBlock.content = execution.permissionRequest.description
            actionBlock.extra = {
              ...actionBlock.extra,
              needsUserAction: true,
              permissionType: execution.permissionRequest.permissionType,
              permissionRequest: JSON.stringify(execution.permissionRequest)
            }
          } else {
            instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
            shouldDispatchResolvedToolHook = true
          }
        } else {
          markPermissionResolved(actionBlock, false, permissionType)
          updateToolCallResponse(blocks, toolCall.id, 'User denied the request.', true)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
          shouldDispatchResolvedToolHook = true
        }

        emitResolvedToolHook = shouldDispatchResolvedToolHook
          ? () => {
              this.dispatchResolvedToolHook({
                sessionId,
                messageId,
                providerId: state?.providerId,
                modelId: state?.modelId,
                projectDir,
                blocks,
                toolCall
              })
            }
          : null
      } else {
        throw new Error(`Unsupported action type: ${actionBlock.action_type}`)
      }

      const remainingPending = reconcilePendingInteractionEntries(
        instance,
        collectPendingInteractionEntries(messageId, blocks)
      )
      const awaitsUserFollowUp = waitingForUserMessage || hasQuestionFollowUpIntent(blocks)
      const finishesForUserFollowUp = awaitsUserFollowUp && remainingPending.length === 0
      const persistedMetadata = finishesForUserFollowUp
        ? stampTerminalMetadata(resumeAccounting, 'completed', 'user_follow_up')
        : resumeAccounting
      this.ports.messageStore.updateAssistantContent(
        messageId,
        blocks,
        finishesForUserFollowUp || accountingChanged ? JSON.stringify(persistedMetadata) : undefined
      )
      replacePendingInteractions(instance, remainingPending)
      this.ports.emitMessageRefresh(sessionId, messageId)

      if (remainingPending.length > 0) {
        emitResolvedToolHook?.()
        this.ports.messageStore.updateMessageStatus(messageId, 'pending')
        this.ports.setSessionStatus(sessionId, 'generating')
        return { resumed: false }
      }

      if (awaitsUserFollowUp) {
        emitResolvedToolHook?.()
        this.ports.messageStore.updateMessageStatus(messageId, 'sent')
        this.ports.dispatchTerminalHooks(sessionId, this.ports.getRuntimeState(sessionId), {
          status: 'completed',
          stopReason: 'user_follow_up',
          usage: buildUsageFromMetadata(persistedMetadata)
        })
        this.ports.setSessionStatus(sessionId, 'idle')
        return { resumed: false, waitingForUserMessage: true }
      }

      this.ports.clearSessionAbortController(sessionId, interactionAbortController ?? undefined)
      const resumed = await this.ports.resumeAssistantMessage(
        sessionId,
        messageId,
        blocks,
        resumeBudgetToolCall,
        resumeAccounting
      )
      emitResolvedToolHook?.()
      return { resumed }
    } catch (error) {
      if (this.ports.isAbortError(error) || interactionAbortSignal?.aborted) {
        if (interactionOwnedByActiveRun) {
          return { resumed: false }
        }
        const accounting = parseMessageMetadata(
          this.ports.messageStore.getMessage(messageId)?.metadata ?? '{}'
        )
        if (interactionAbortController) {
          this.ports.clearSessionAbortController(sessionId, interactionAbortController)
        }
        instance.replacePendingInteractions([])
        this.ports.settleAbortedTurn(
          sessionId,
          messageId,
          undefined,
          JSON.stringify(stampTerminalMetadata(accounting, 'aborted', 'user_stop'))
        )
        void this.ports.drainPendingQueueIfPossible(sessionId, 'completed').catch((drainError) => {
          logger.error(
            `[DeepChatAgent] drainPendingQueueIfPossible error session=${sessionId} reason=completed`,
            redactRuntimeErrorForLog(drainError)
          )
        })
        return { resumed: false }
      }
      throw error
    } finally {
      if (interactionAbortController) {
        this.ports.clearSessionAbortController(sessionId, interactionAbortController)
      }
      instance.unlockInteraction(messageId, toolCallId)
    }
  }

  private async handleSkillDraftInteraction(
    sessionId: string,
    instance: DeepChatAgentInstance,
    blocks: AssistantMessageBlock[],
    actionBlock: AssistantMessageBlock,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>,
    response: Exclude<ToolInteractionResponse, { kind: 'permission' }>
  ): Promise<{ keepPending: boolean; waitingForUserMessage: boolean; handledInline?: boolean }> {
    const skillService = this.ports.skillService

    if (response.kind === 'question_other') {
      throw new Error('Custom skill draft responses are not supported.')
    }

    const answerText =
      response.kind === 'question_option' ? response.optionLabel : response.answerText
    const choice = resolveSkillDraftChoice(answerText)
    if (!choice) {
      throw new Error('Unknown skill draft action.')
    }

    const draftId = String(actionBlock.extra?.skillDraftId ?? '').trim()
    if (!draftId) {
      throw new Error('Skill draft id is missing.')
    }

    if (choice === 'view') {
      const result = await skillService.viewDraftSkill(sessionId, draftId)
      if (!result.success) {
        const error = result.error || 'Unknown error'
        actionBlock.extra = {
          ...actionBlock.extra,
          skillDraftStatus: 'error',
          skillDraftError: error
        }
        updateSkillDraftToolCallResponse(
          blocks,
          toolCall.id!,
          buildSkillDraftToolResponse({ success: false, action: 'view', draftId, error }),
          true
        )
        markQuestionResolved(actionBlock, SKILL_DRAFT_ACTION_LABELS.view)
        return { keepPending: false, waitingForUserMessage: false }
      }

      const responseText = buildSkillDraftToolResponse({
        success: true,
        action: 'view',
        draftId,
        skillName: result.skillName
      })
      actionBlock.status = 'pending'
      const currentExtra = actionBlock.extra ?? {}
      actionBlock.extra = {
        ...currentExtra,
        needsUserAction: true,
        questionResolution: 'asked',
        skillDraftStatus: 'viewed',
        skillDraftName: result.skillName ?? currentExtra.skillDraftName,
        skillDraftPreview: result.content ?? ''
      }
      updateSkillDraftQuestionOptions(actionBlock, true)
      updateSkillDraftToolCallResponse(blocks, toolCall.id!, responseText, false)
      return { keepPending: true, waitingForUserMessage: false, handledInline: true }
    }

    const result =
      choice === 'install'
        ? await skillService.installDraftSkill(sessionId, draftId)
        : await skillService.discardDraftSkill(sessionId, draftId)

    const responseText = buildSkillDraftToolResponse({
      success: result.success,
      action: result.action,
      draftId,
      skillName: result.skillName,
      installedSkillName: result.installedSkillName,
      error: result.error
    })

    const error = result.error || 'Unknown error'
    actionBlock.extra = {
      ...actionBlock.extra,
      skillDraftStatus: result.success ? SKILL_DRAFT_STATUS_BY_CHOICE[choice] : 'error',
      ...(result.success ? {} : { skillDraftError: error })
    }
    markQuestionResolved(actionBlock, SKILL_DRAFT_ACTION_LABELS[choice])
    updateSkillDraftToolCallResponse(blocks, toolCall.id!, responseText, !result.success)

    if (choice === 'install' && result.success) {
      instance.invalidateResourceCaches()
    }

    return { keepPending: false, waitingForUserMessage: false }
  }

  private dispatchResolvedToolHook(params: {
    sessionId: string
    messageId: string
    providerId?: string
    modelId?: string
    projectDir?: string | null
    blocks: AssistantMessageBlock[]
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  }): void {
    const resolvedBlock = params.blocks.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === params.toolCall.id
    )
    const responseText = resolvedBlock?.tool_call?.response ?? ''
    const isError = resolvedBlock?.status === 'error'

    this.ports.dispatchHook(isError ? 'PostToolUseFailure' : 'PostToolUse', {
      sessionId: params.sessionId,
      messageId: params.messageId,
      providerId: params.providerId,
      modelId: params.modelId,
      projectDir: params.projectDir,
      tool: isError
        ? {
            callId: params.toolCall.id,
            name: params.toolCall.name,
            params: params.toolCall.params,
            error: responseText
          }
        : {
            callId: params.toolCall.id,
            name: params.toolCall.name,
            params: params.toolCall.params,
            response: responseText
          }
    })
  }

  private async grantPermissionForPayload(
    sessionId: string,
    payload: PendingToolInteraction['permission'] | undefined,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): Promise<void> {
    if (!payload) return

    const sessionPermissionPort = this.ports.sessionPermissionPort
    const permissionType = payload.permissionType
    const serverName = payload.serverName || toolCall.server_name || ''
    const toolName = payload.toolName || toolCall.name || ''

    if (permissionType === 'command') {
      const command = payload.command || payload.commandInfo?.command || ''
      const signature = payload.commandSignature || payload.commandInfo?.signature || command
      if (signature) {
        await sessionPermissionPort.approvePermission(sessionId, {
          permissionType: 'command',
          command,
          commandSignature: signature,
          commandInfo: payload.commandInfo
        })
      }
      return
    }

    if (serverName === 'agent-filesystem' && Array.isArray(payload.paths) && payload.paths.length) {
      await sessionPermissionPort.approvePermission(sessionId, {
        permissionType:
          permissionType === 'read' || permissionType === 'write' || permissionType === 'all'
            ? permissionType
            : 'write',
        serverName,
        toolName,
        paths: payload.paths
      })
      return
    }

    if (serverName === 'deepchat-settings' && toolName) {
      await sessionPermissionPort.approvePermission(sessionId, {
        permissionType: 'write',
        serverName,
        toolName
      })
      return
    }

    if (
      serverName &&
      (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
    ) {
      await sessionPermissionPort.approvePermission(sessionId, {
        permissionType,
        serverName,
        toolName
      })
    }
  }
}
