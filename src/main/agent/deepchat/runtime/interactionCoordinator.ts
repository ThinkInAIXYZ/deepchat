import type {
  AssistantMessageBlock,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SkillServicePort } from '@shared/types/skill'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type {
  SessionPermissionGrant,
  SessionPermissionPort,
  SessionPermissionRequest
} from '@/session/contracts'
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
import type { SessionTranscript } from '@/session/data/transcript'
import type { ProviderPermissionCoordinator } from './providerPermissionCoordinator'
import { MAX_TOOL_CALLS_SKIPPED_ERROR } from './process'
import {
  buildUsageFromMetadata,
  incrementToolCallAccounting,
  stampTerminalMetadata
} from './runtimeMetadata'
import type { DeferredToolExecutionResult, DeferredToolExecutor } from './deferredToolExecutor'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { MessageProjectionService } from './messageProjectionService'
import type { ResumeBudgetToolCall, TurnResumePort } from './turnResumeContract'
import type { DeepChatEventPublisher, PendingToolInteraction } from './types'
import { parseMessageMetadata } from '@/session/usageStats'
import { MAX_TOOL_CALLS } from '@/agent/deepchat/loop/deepChatLoopEngine'
import { throwIfAbortRequested } from './abortErrors'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { RuntimeHookScope, RuntimeHookSink } from './runtimeHookSink'
import { ExecutionJournalError, isExecutionJournalError } from '@/tape/domain/executionJournal'
import type { InteractionParkingRegistry } from './interactionParkingRegistry'
import { CommandShellProfileSchema } from '@shared/commandShell'
import { isCommandSignatureForProfile } from '@/tool/permission'

const DEFERRED_INTERACTION_PARKED_ERROR =
  'Execution is parked after an Execution Journal failure and will not be retried automatically.'

type DeferredPermissionGrant = {
  serverName: string
  command?: {
    signature: string
    oneShotGrantId: string
  }
}

type InteractionRunLifecyclePort = Pick<
  RunLifecycleCoordinator,
  | 'clearOperationController'
  | 'ensureOperationController'
  | 'isMessageAssociatedWithRun'
  | 'observeTerminal'
  | 'resolveStreamRequestId'
  | 'schedulePendingInputDrain'
  | 'scopeFor'
  | 'settleAbortedTurn'
  | 'transitionStatus'
>

type SkillDraftPresenter = Pick<
  SkillServicePort,
  'viewDraftSkill' | 'installDraftSkill' | 'discardDraftSkill'
>

export interface InteractionCoordinatorPorts {
  messageStore: SessionTranscript
  providerPermissionCoordinator: ProviderPermissionCoordinator
  skillService: SkillDraftPresenter
  runLifecycle: InteractionRunLifecyclePort
  registry: SessionScopeRegistry
  sessionPermissionPort: SessionPermissionPort
  deferredToolExecutor: Pick<DeferredToolExecutor, 'execute'>
  messageProjection: Pick<MessageProjectionService, 'refresh'>
  hookSink: Pick<RuntimeHookSink, 'scope'>
  turnCoordinator: TurnResumePort
  continuationAdmission: InteractionContinuationAdmissionPort
  publishEvent: DeepChatEventPublisher
  interactionParking: Pick<InteractionParkingRegistry, 'isParked' | 'park'>
}

export interface InteractionContinuationAdmissionPort {
  resume(sessionId: string, signal?: AbortSignal): Promise<boolean>
  suspend(sessionId: string): void
}

export class InteractionCoordinator {
  constructor(private readonly ports: InteractionCoordinatorPorts) {}

  async respond(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const instance = this.ports.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    if (this.ports.interactionParking.isParked(sessionId, messageId)) {
      throw new ExecutionJournalError(DEFERRED_INTERACTION_PARKED_ERROR, 'persistence_failed')
    }
    const scope = this.ports.runLifecycle.scopeFor(sessionId, instance)
    if (!instance.tryLockInteraction(messageId, toolCallId)) {
      return { resumed: false }
    }

    const interactionOwnerRun = instance.getActiveGeneration()
    const interactionOwnedByActiveRun = this.ports.runLifecycle.isMessageAssociatedWithRun(
      interactionOwnerRun,
      messageId
    )
    let resumedWaitingAdmission = false
    let interactionAbortController: AbortController | null = null
    let interactionAbortSignal: AbortSignal | undefined
    const resumeWaitingAdmission = async () => {
      if (
        await this.ports.continuationAdmission.resume(sessionId, interactionAbortSignal)
      ) {
        resumedWaitingAdmission = true
      }
    }
    try {
      if (interactionOwnerRun) {
        if (interactionOwnedByActiveRun && interactionOwnerRun.abortController.signal.aborted) {
          return { resumed: false }
        }
        interactionAbortSignal = interactionOwnerRun.abortController.signal
      } else {
        interactionAbortController = this.ports.runLifecycle.ensureOperationController(scope)
        interactionAbortSignal = interactionAbortController.signal
      }
      throwIfAbortRequested(interactionAbortSignal)
      const message = await this.ports.messageStore.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Assistant message not found: ${messageId}`)
      }
      if (message.sessionId !== sessionId) {
        throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
      }

      let blocks = parseAssistantBlocks(message.content)
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
      let actionBlock = blocks[currentEntry.blockIndex]
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
          if (!scope.isCurrent()) {
            return { resumed: false }
          }
          waitingForUserMessage = result.waitingForUserMessage
          if (result.keepPending) {
            this.ports.messageStore.updateAssistantContent(messageId, blocks)
            this.ports.messageProjection.refresh(sessionId, messageId)
            this.ports.messageStore.updateMessageStatus(messageId, 'pending')
            this.ports.runLifecycle.transitionStatus(scope, 'generating')
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
          await resumeWaitingAdmission()
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
        const state = this.ports.registry.getHydratedScope(toAppSessionId(sessionId))?.state()
        const hooks = this.ports.hookSink.scope({
          sessionId,
          messageId,
          providerId: state?.providerId,
          modelId: state?.modelId
        })
        let shouldDispatchResolvedToolHook = false

        if (response.granted) {
          await resumeWaitingAdmission()
          let permissionGrant: DeferredPermissionGrant | null = null
          let execution: DeferredToolExecutionResult
          try {
            // Await the cache mutation directly so cleanup always owns the exact grant lease.
            permissionGrant = await this.grantPermissionForPayload(
              sessionId,
              permissionPayload,
              toolCall
            )
            throwIfAbortRequested(interactionAbortSignal)
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
            if ((nextToolCallAccounting.toolCalls ?? 0) > MAX_TOOL_CALLS) {
              execution = {
                responseText: MAX_TOOL_CALLS_SKIPPED_ERROR,
                isError: true
              }
            } else {
              hooks.emit({
                event: 'PreToolUse',
                tool: { callId: toolCall.id, name: toolCall.name, params: toolCall.params }
              })
              execution = await this.ports.deferredToolExecutor.execute(
                sessionId,
                messageId,
                toolCall.server_name === permissionGrant.serverName
                  ? toolCall
                  : { ...toolCall, server_name: permissionGrant.serverName },
                markDeferredToolCallStarted,
                permissionPayload?.shellProfile,
                permissionGrant.command?.oneShotGrantId
              )
              const refreshedInteraction = this.readLatestPendingInteraction(
                sessionId,
                messageId,
                toolCall.id
              )
              if (!refreshedInteraction) {
                return { resumed: false }
              }
              blocks = refreshedInteraction.blocks
              actionBlock = refreshedInteraction.actionBlock
              if (
                (execution.invoked ||
                  execution.terminalError ||
                  execution.journalFailure?.dispatchCommitted) &&
                !deferredToolCallCounted
              ) {
                markDeferredToolCallStarted()
              }
            }
          } finally {
            if (permissionGrant?.command) {
              this.ports.sessionPermissionPort.revokeOneShotCommandPermission(
                sessionId,
                permissionGrant.command.signature,
                permissionGrant.command.oneShotGrantId
              )
            }
          }
          if (execution.journalFailure) {
            this.ports.runLifecycle.transitionStatus(scope, 'idle')
            if (!execution.journalFailure.dispatchCommitted) {
              throw execution.journalFailure.error
            }

            this.ports.interactionParking.park(sessionId, messageId)
            markPermissionResolved(actionBlock, true, permissionType)
            if (execution.invoked) {
              instance.advancePendingToolBatch({ invokedCallId: toolCall.id })
            }
            if (execution.journalFailure.outcomeCommitted) {
              instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
            }
            updateToolCallResponse(blocks, toolCall.id, execution.responseText, execution.isError)
            for (const block of blocks) {
              if (
                block.type !== 'action' ||
                block.status !== 'pending' ||
                block.extra?.needsUserAction === false
              ) {
                continue
              }
              block.status = 'error'
              block.content = DEFERRED_INTERACTION_PARKED_ERROR
              block.extra = { ...block.extra, needsUserAction: false }
              if (block.tool_call?.id) {
                updateToolCallResponse(
                  blocks,
                  block.tool_call.id,
                  DEFERRED_INTERACTION_PARKED_ERROR,
                  true
                )
              }
            }
            replacePendingInteractions(instance, [])
            try {
              this.ports.messageStore.updateAssistantContent(messageId, blocks)
              this.ports.messageProjection.refresh(sessionId, messageId)
            } catch (projectionError) {
              throw new ExecutionJournalError(
                `${execution.journalFailure.error.message} Failed to persist the parked interaction projection.`,
                'projection_failed',
                { cause: new AggregateError([execution.journalFailure.error, projectionError]) }
              )
            }
            throw execution.journalFailure.error
          }
          markPermissionResolved(actionBlock, true, permissionType)
          if (execution.invoked) {
            instance.advancePendingToolBatch({ invokedCallId: toolCall.id })
          }
          if (execution.terminalError) {
            const terminalMetadata = stampTerminalMetadata(resumeAccounting, 'error', 'tool_error')
            instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
            hooks.emit({
              event: 'PostToolUseFailure',
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
            this.ports.messageProjection.refresh(sessionId, messageId)
            this.ports.publishEvent('chat.stream.failed', {
              requestId: this.ports.runLifecycle.resolveStreamRequestId(sessionId, messageId),
              sessionId,
              messageId,
              failedAt: Date.now(),
              error: execution.terminalError
            })
            hooks.terminal({
              reason: 'tool_error',
              userStop: false,
              usage: buildUsageFromMetadata(terminalMetadata) ?? null,
              error: { message: execution.terminalError }
            })
            this.ports.runLifecycle.transitionStatus(
              scope,
              'error',
              buildUsageFromMetadata(terminalMetadata)
            )
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
            responseText: execution.responseText,
            offloadPath: execution.offloadPath,
            existingOffloadPath: execution.existingOffloadPath
          }

          if (execution.requiresPermission && execution.permissionRequest) {
            instance.transitionPendingInteractionOrigin(
              messageId,
              toolCall.id,
              'post-call-permission'
            )
            hooks.emit({
              event: 'PermissionRequest',
              permission: execution.permissionRequest,
              tool: { callId: toolCall.id, name: toolCall.name, params: toolCall.params }
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
          if (requestId) {
            await this.ports.sessionPermissionPort.denyPermission?.(sessionId, requestId)
          }
          markPermissionResolved(actionBlock, false, permissionType)
          updateToolCallResponse(blocks, toolCall.id, 'User denied the request.', true)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
          shouldDispatchResolvedToolHook = true
        }

        emitResolvedToolHook = shouldDispatchResolvedToolHook
          ? () => {
              this.emitResolvedToolFacts(hooks, blocks, toolCall)
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
      if (remainingPending.length === 0 && !awaitsUserFollowUp) {
        await resumeWaitingAdmission()
      }
      this.ports.messageStore.updateAssistantContent(
        messageId,
        blocks,
        finishesForUserFollowUp || accountingChanged ? JSON.stringify(persistedMetadata) : undefined
      )
      replacePendingInteractions(instance, remainingPending)
      this.ports.messageProjection.refresh(sessionId, messageId)

      if (remainingPending.length > 0) {
        if (resumedWaitingAdmission) this.ports.continuationAdmission.suspend(sessionId)
        emitResolvedToolHook?.()
        this.ports.messageStore.updateMessageStatus(messageId, 'pending')
        this.ports.runLifecycle.transitionStatus(scope, 'generating')
        return { resumed: false }
      }

      if (awaitsUserFollowUp) {
        emitResolvedToolHook?.()
        this.ports.messageStore.updateMessageStatus(messageId, 'sent')
        this.ports.runLifecycle.observeTerminal(sessionId, {
          status: 'completed',
          stopReason: 'user_follow_up',
          usage: buildUsageFromMetadata(persistedMetadata)
        })
        this.ports.runLifecycle.transitionStatus(
          scope,
          'idle',
          buildUsageFromMetadata(persistedMetadata)
        )
        return { resumed: false, waitingForUserMessage: true }
      }

      this.ports.runLifecycle.clearOperationController(
        scope,
        interactionAbortController ?? undefined
      )
      const resumed = await this.ports.turnCoordinator.resume(
        sessionId,
        messageId,
        blocks,
        resumeBudgetToolCall,
        resumeAccounting
      )
      emitResolvedToolHook?.()
      return { resumed }
    } catch (error) {
      if (resumedWaitingAdmission) this.ports.continuationAdmission.suspend(sessionId)
      if (isExecutionJournalError(error)) throw error
      if (interactionAbortSignal?.aborted) {
        if (interactionOwnedByActiveRun) {
          return { resumed: false }
        }
        const accounting = parseMessageMetadata(
          this.ports.messageStore.getMessage(messageId)?.metadata ?? '{}'
        )
        if (interactionAbortController) {
          this.ports.runLifecycle.clearOperationController(scope, interactionAbortController)
        }
        instance.replacePendingInteractions([])
        this.ports.runLifecycle.settleAbortedTurn(
          sessionId,
          messageId,
          undefined,
          JSON.stringify(stampTerminalMetadata(accounting, 'aborted', 'user_stop'))
        )
        this.ports.runLifecycle.schedulePendingInputDrain(sessionId, 'completed')
        return { resumed: false }
      }
      throw error
    } finally {
      if (interactionAbortController) {
        this.ports.runLifecycle.clearOperationController(scope, interactionAbortController)
      }
      instance.unlockInteraction(messageId, toolCallId)
    }
  }

  private readLatestPendingInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string
  ): { blocks: AssistantMessageBlock[]; actionBlock: AssistantMessageBlock } | null {
    const message = this.ports.messageStore.getMessage(messageId)
    if (!message) {
      return null
    }
    if (message.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }
    if (message.role !== 'assistant') {
      return null
    }

    const blocks = parseAssistantBlocks(message.content)
    const entry = collectPendingInteractionEntries(messageId, blocks).find(
      ({ interaction }) => interaction.toolCallId === toolCallId
    )
    if (!entry) {
      return null
    }

    return { blocks, actionBlock: blocks[entry.blockIndex] }
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
      instance.invalidateToolProfileCache()
    }

    return { keepPending: false, waitingForUserMessage: false }
  }

  private emitResolvedToolFacts(
    hooks: RuntimeHookScope,
    blocks: AssistantMessageBlock[],
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): void {
    const resolvedBlock = blocks.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCall.id
    )
    const responseText = resolvedBlock?.tool_call?.response ?? ''
    const isError = resolvedBlock?.status === 'error'
    const tool = { callId: toolCall.id, name: toolCall.name, params: toolCall.params }

    hooks.emit(
      isError
        ? { event: 'PostToolUseFailure', tool: { ...tool, error: responseText } }
        : { event: 'PostToolUse', tool: { ...tool, response: responseText } }
    )
  }

  private async grantPermissionForPayload(
    sessionId: string,
    payload: PendingToolInteraction['permission'] | undefined,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): Promise<DeferredPermissionGrant> {
    if (!payload) {
      throw new Error('Permission approval payload is unavailable.')
    }

    const sessionPermissionPort = this.ports.sessionPermissionPort
    const permissionType = payload.permissionType
    const payloadServerName = payload.serverName?.trim()
    const toolCallServerName = toolCall.server_name?.trim()
    if (
      payloadServerName &&
      toolCallServerName &&
      payloadServerName !== toolCallServerName
    ) {
      throw new Error('Permission approval tool server identity does not match the tool call.')
    }
    const serverName = toolCallServerName || payloadServerName
    if (!serverName) {
      throw new Error('Permission approval is missing its tool server identity.')
    }

    const payloadToolName = payload.toolName?.trim()
    const toolCallName = toolCall.name?.trim()
    if (
      (serverName === 'agent-filesystem' || serverName === 'deepchat-settings') &&
      payloadToolName &&
      toolCallName &&
      payloadToolName !== toolCallName
    ) {
      throw new Error('Permission approval tool identity does not match the tool call.')
    }
    const toolName = toolCallName || payloadToolName || ''

    if (permissionType === 'command') {
      const command = payload.command || payload.commandInfo?.command || ''
      const signature = payload.commandSignature?.trim()
      const parsedProfile = CommandShellProfileSchema.safeParse(payload.shellProfile)
      if (
        !signature ||
        !parsedProfile.success ||
        !isCommandSignatureForProfile(signature, parsedProfile.data)
      ) {
        throw new Error('Command approval is missing a valid shell profile and signature.')
      }
      const grant = await sessionPermissionPort.approvePermission(sessionId, {
        permissionType: 'command',
        command,
        commandSignature: signature,
        shellProfile: parsedProfile.data,
        commandInfo: payload.commandInfo
      })
      if (!grant || grant.kind !== 'command') {
        throw new Error('Command approval did not return a one-shot grant lease.')
      }
      if (grant.signature !== signature) {
        sessionPermissionPort.revokeOneShotCommandPermission(
          sessionId,
          grant.signature,
          grant.oneShotGrantId
        )
        throw new Error('Command approval returned a lease for another signature.')
      }
      return {
        serverName,
        command: { signature: grant.signature, oneShotGrantId: grant.oneShotGrantId }
      }
    }

    if (serverName === 'agent-filesystem') {
      const parsedProfile = CommandShellProfileSchema.safeParse(payload.shellProfile)
      if (!parsedProfile.success) {
        throw new Error('File approval is missing a valid shell profile.')
      }
      if (
        !Array.isArray(payload.paths) ||
        payload.paths.length === 0 ||
        payload.paths.some((filePath) => typeof filePath !== 'string' || !filePath.trim())
      ) {
        throw new Error('File approval is missing valid paths.')
      }
      await this.grantNonCommandPermission(sessionId, {
        permissionType:
          permissionType === 'read' || permissionType === 'write' || permissionType === 'all'
            ? permissionType
            : 'write',
        serverName,
        toolName,
        paths: payload.paths,
        shellProfile: parsedProfile.data
      })
      return { serverName }
    }

    if (serverName === 'deepchat-settings' && toolName) {
      await this.grantNonCommandPermission(sessionId, {
        permissionType: 'write',
        serverName,
        toolName
      })
      return { serverName }
    }

    if (
      serverName &&
      (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
    ) {
      await this.grantNonCommandPermission(sessionId, {
        permissionType,
        serverName,
        toolName,
        requestId: payload.requestId
      })
    }
    return { serverName }
  }

  private async grantNonCommandPermission(
    sessionId: string,
    permission: SessionPermissionRequest
  ): Promise<void> {
    const grant: SessionPermissionGrant =
      await this.ports.sessionPermissionPort.approvePermission(sessionId, permission)
    if (grant?.kind === 'granted') return
    if (grant?.kind === 'command') {
      this.ports.sessionPermissionPort.revokeOneShotCommandPermission(
        sessionId,
        grant.signature,
        grant.oneShotGrantId
      )
    }
    throw new Error('Non-command approval returned an unexpected grant result.')
  }
}
