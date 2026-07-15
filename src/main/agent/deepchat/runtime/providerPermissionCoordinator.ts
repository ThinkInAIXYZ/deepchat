import type { DeepChatSessionState } from '@shared/types/agent-interface'
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
import { buildUsageFromMetadata, stampTerminalMetadata } from './runtimeMetadata'
import type {
  DeepChatEventPublisher,
  PendingToolInteraction,
  ProcessResult,
  StreamState
} from './types'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'

interface ProviderPermissionCoordinatorDependencies {
  messageStore: SessionTranscript
  getOrCreateInstance(sessionId: string): DeepChatAgentInstance
  getHydratedInstance(sessionId: string): DeepChatAgentInstance | undefined
  permissionPort: AcpAsLlmProviderPermissionPort
  emitMessageRefresh(sessionId: string, messageId: string): void
  resolveStreamRequestId(sessionId: string, messageId: string): string
  dispatchTerminalHooks(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void
  getRuntimeState(sessionId: string): DeepChatSessionState | undefined
  setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void
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

    this.deps.getOrCreateInstance(sessionId).registerActiveProviderPermission({
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
    const instance = this.deps.getHydratedInstance(input.sessionId)
    const activeCandidate = instance?.getActiveProviderPermission(input.requestId)
    const active =
      activeCandidate?.messageId === input.messageId &&
      activeCandidate.toolCallId === input.toolCallId
        ? activeCandidate
        : undefined
    const hasConflictingActive = Boolean(activeCandidate && !active)
    const ownerRun = input.ownerRun?.messageId === input.messageId ? input.ownerRun : undefined

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
        resolution = await this.resolveSafely(
          active
            ? () => active.resolve(input.granted)
            : () => this.deps.permissionPort.resolveAgentPermission(input.requestId, input.granted)
        )
      } finally {
        instance?.clearActiveProviderPermission(input.requestId, active)
      }

      if (
        input.signal?.aborted ||
        ownerRun.abortController.signal.aborted ||
        !instance?.isActiveRun(ownerRun.runId)
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
      this.removePending(instance, input)
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
        resolution = await this.resolveSafely(
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

  clearSession(sessionId: string): void {
    for (const permission of this.deps
      .getHydratedInstance(sessionId)
      ?.takeActiveProviderPermissions() ?? []) {
      void this.resolveSafely(() => permission.resolve(false)).catch((error) => {
        console.warn(
          `[DeepChatAgent] Failed to cancel ACP permission request ${permission.requestId}:`,
          error
        )
      })
    }
  }

  private async resolveSafely(
    task: () => Promise<void>
  ): Promise<{ status: 'resolved' } | { status: 'stale'; error: unknown }> {
    try {
      await task()
      return { status: 'resolved' }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
      if (!message?.startsWith('Unknown ACP permission request:')) {
        throw error
      }
      return { status: 'stale', error }
    }
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
    const terminalMetadata = stampTerminalMetadata(
      parseMessageMetadata(message.metadata),
      'error',
      'provider_error'
    )
    this.deps.messageStore.setMessageError(
      input.messageId,
      terminalBlocks,
      JSON.stringify(terminalMetadata)
    )
    this.deps.emitMessageRefresh(input.sessionId, input.messageId)
    this.deps.publishEvent('chat.stream.failed', {
      requestId: this.deps.resolveStreamRequestId(input.sessionId, input.messageId),
      sessionId: input.sessionId,
      messageId: input.messageId,
      failedAt: Date.now(),
      error: errorMessage
    })
    this.deps.dispatchTerminalHooks(input.sessionId, this.deps.getRuntimeState(input.sessionId), {
      status: 'error',
      stopReason: 'provider_error',
      errorMessage,
      usage: buildUsageFromMetadata(terminalMetadata)
    })
    if (instance) {
      this.removePending(instance, input)
      if (!instance.getActiveGeneration()) {
        this.deps.setSessionStatus(input.sessionId, 'error')
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
