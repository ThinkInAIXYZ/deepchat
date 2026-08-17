import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { parseMessageMetadata } from '@/session/usageStats'
import type { AcpAsLlmProviderPermissionPort } from '@/provider/ports'
import {
  applyProviderPermissionProjection,
  parseAssistantBlocks,
  type ProviderPermissionInteractionInput,
  type ProviderPermissionProjection
} from './interactionProjection'
import { buildTerminalErrorBlocks, type SessionTranscript } from '@/session/data/transcript'
import { buildUsageFromMetadata, stampInteractionResolution } from './runtimeMetadata'
import type {
  DeepChatEventPublisher,
  PendingToolInteraction,
  StreamState
} from './types'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { MessageProjectionService } from './messageProjectionService'
import { resolveProviderPermissionSafely } from './providerPermissionResolution'

type ProviderPermissionRunLifecyclePort = Pick<
  RunLifecycleCoordinator,
  | 'getHydratedScope'
  | 'getOrCreateScope'
  | 'isMessageAssociatedWithRun'
  | 'isRunCurrentForScope'
  | 'observeTerminal'
  | 'resolveStreamRequestId'
  | 'transitionCurrentStatus'
>

interface ProviderPermissionCoordinatorDependencies {
  messageStore: SessionTranscript
  runLifecycle: ProviderPermissionRunLifecyclePort
  permissionPort: AcpAsLlmProviderPermissionPort
  messageProjection: Pick<MessageProjectionService, 'refresh'>
  publishEvent: DeepChatEventPublisher
}

export class ProviderPermissionCoordinator {
  constructor(private readonly deps: ProviderPermissionCoordinatorDependencies) {}

  register(
    sessionId: string,
    messageId: string,
    permission: NonNullable<PendingToolInteraction['permission']>,
    tool: { callId?: string; name?: string; params?: string },
    commitDecision: (granted: boolean) => void
  ): void {
    const requestId = permission.requestId?.trim()
    const providerId = permission.providerId?.trim()
    if (!requestId || providerId !== 'acp') {
      return
    }

    this.deps.runLifecycle.getOrCreateScope(sessionId).instance.registerActiveProviderPermission({
      requestId,
      messageId,
      toolCallId: tool.callId || '',
      providerId,
      permissionType: permission.permissionType,
      resolve: async (granted) => {
        await this.deps.permissionPort.resolveAgentPermission(requestId, granted)
        commitDecision(granted)
      }
    })
  }

  async resolve(input: ProviderPermissionInteractionInput): Promise<void> {
    const instance = this.deps.runLifecycle.getHydratedScope(input.sessionId)?.instance
    const activeCandidate = instance?.getActiveProviderPermission(input.requestId)
    const active =
      activeCandidate?.messageId === input.messageId &&
      activeCandidate.toolCallId === input.toolCallId
        ? activeCandidate
        : undefined
    const hasConflictingActive = Boolean(activeCandidate && !active)
    const ownerRun = this.deps.runLifecycle.isMessageAssociatedWithRun(
      input.ownerRun,
      input.messageId
    )
      ? input.ownerRun
      : undefined

    if (input.signal?.aborted || ownerRun?.abortController.signal.aborted) {
      return
    }

    if (ownerRun) {
      if (hasConflictingActive) {
        const projection: ProviderPermissionProjection = {
          status: 'error',
          message: 'ACP permission request ownership changed.'
        }
        this.updateActiveState(ownerRun, input, projection)
        this.updatePersistedState(input, projection)
        if (instance) {
          this.removePending(instance, input)
        }
        return
      }

      let resolution: { status: 'resolved' } | { status: 'stale'; error: unknown }
      try {
        resolution = await resolveProviderPermissionSafely(
          active
            ? () => active.resolve(input.granted)
            : () => this.deps.permissionPort.resolveAgentPermission(input.requestId, input.granted)
        )
      } finally {
        instance?.clearActiveProviderPermission(input.requestId, active)
      }

      const currentScope = this.deps.runLifecycle.getHydratedScope(input.sessionId)
      if (
        input.signal?.aborted ||
        ownerRun.abortController.signal.aborted ||
        !currentScope ||
        !this.deps.runLifecycle.isRunCurrentForScope(currentScope, ownerRun.runId)
      ) {
        return
      }
      if (resolution.status === 'stale') {
        console.warn(
          `[DeepChatAgent] ACP permission request expired while its generation remained active: ${input.requestId}`,
          resolution.error
        )
      }
      if (!active || resolution.status === 'stale') {
        const projection: ProviderPermissionProjection =
          resolution.status === 'resolved'
            ? { status: 'resolved', granted: input.granted }
            : { status: 'error', message: 'Permission request expired.' }
        this.updateActiveState(ownerRun, input, projection)
        this.updatePersistedState(input, projection)
      }
      this.removePending(currentScope.instance, input)
      return
    }

    if (hasConflictingActive) {
      this.fail(input, 'ACP permission request ownership changed.', instance)
      return
    }

    let resolution:
      | { status: 'resolved' }
      | { status: 'stale'; error: unknown }
      | { status: 'failed'; error: unknown }
    try {
      try {
        resolution = await resolveProviderPermissionSafely(
          active
            ? () => active.resolve(false)
            : () => this.deps.permissionPort.resolveAgentPermission(input.requestId, false)
        )
      } catch (error) {
        resolution = { status: 'failed', error }
      }
    } finally {
      instance?.clearActiveProviderPermission(input.requestId, active)
    }

    if (input.signal?.aborted) {
      return
    }
    if (resolution.status === 'stale') {
      console.warn(
        `[DeepChatAgent] Failing stale ACP permission request ${input.requestId}:`,
        resolution.error
      )
    } else if (resolution.status === 'failed') {
      console.warn(
        `[DeepChatAgent] Failed to deny orphaned ACP permission request ${input.requestId}:`,
        resolution.error
      )
    }
    this.fail(
      input,
      resolution.status === 'stale'
        ? 'Permission request expired.'
        : 'ACP permission request lost its active generation.',
      instance
    )
  }

  private updatePersistedState(
    input: ProviderPermissionInteractionInput,
    projection: ProviderPermissionProjection
  ): void {
    const message = this.deps.messageStore.getMessage(input.messageId)
    if (!message || message.role !== 'assistant') {
      return
    }
    const blocks = parseAssistantBlocks(message.content)
    if (applyProviderPermissionProjection(blocks, input, projection)) {
      this.deps.messageStore.updateAssistantContent(input.messageId, blocks)
    }
  }

  private updateActiveState(
    ownerRun: LoopRun<unknown>,
    input: ProviderPermissionInteractionInput,
    projection: ProviderPermissionProjection
  ): void {
    const streamState = ownerRun.streamState as StreamState
    if (Array.isArray(streamState.blocks)) {
      if (applyProviderPermissionProjection(streamState.blocks, input, projection)) {
        streamState.dirty = true
      }
    }
  }

  private fail(
    input: ProviderPermissionInteractionInput,
    errorMessage: string,
    instance?: DeepChatAgentInstance
  ): void {
    const message = this.deps.messageStore.getMessage(input.messageId)
    if (!message || message.role !== 'assistant') {
      return
    }

    const blocks = parseAssistantBlocks(message.content)
    applyProviderPermissionProjection(blocks, input, { status: 'error', message: errorMessage })
    const terminalBlocks = buildTerminalErrorBlocks(blocks, errorMessage)
    const terminalMetadata = stampInteractionResolution(
      parseMessageMetadata(message.metadata),
      'error'
    )
    this.deps.messageStore.setMessageError(
      input.messageId,
      terminalBlocks,
      JSON.stringify(terminalMetadata)
    )
    this.deps.messageProjection.refresh(input.sessionId, input.messageId)
    this.deps.publishEvent('chat.stream.failed', {
      requestId: this.deps.runLifecycle.resolveStreamRequestId(
        input.sessionId,
        input.messageId
      ),
      sessionId: input.sessionId,
      messageId: input.messageId,
      failedAt: Date.now(),
      error: errorMessage
    })
    this.deps.runLifecycle.observeTerminal(input.sessionId, {
      status: 'error',
      stopReason: 'provider_error',
      errorMessage,
      usage: buildUsageFromMetadata(terminalMetadata)
    })
    if (instance) {
      this.removePending(instance, input)
      if (!instance.getActiveGeneration()) {
        this.deps.runLifecycle.transitionCurrentStatus(
          input.sessionId,
          'error',
          buildUsageFromMetadata(terminalMetadata)
        )
      }
    }
  }

  private removePending(
    instance: DeepChatAgentInstance,
    input: ProviderPermissionInteractionInput
  ): void {
    instance.replacePendingInteractions(
      instance
        .getPendingInteractions()
        .filter(
          (interaction) =>
            interaction.messageId !== input.messageId || interaction.toolCallId !== input.toolCallId
        )
    )
  }
}
