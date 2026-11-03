import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { SessionRuntimeScope } from '@/agent/deepchat/instance/deepChatAgentRuntime'
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
import type { DeepChatEventPublisher, PendingToolInteraction, StreamState } from './types'
import { markStreamChanged } from './types'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { MessageProjectionService } from './messageProjectionService'
import { resolveProviderPermissionSafely } from './providerPermissionResolution'

type ProviderPermissionRunLifecyclePort = Pick<
  RunLifecycleCoordinator,
  | 'getHydratedScope'
  | 'isMessageAssociatedWithRun'
  | 'isRunCurrentForScope'
  | 'observeTerminal'
  | 'resolveStreamRequestId'
  | 'scopeFor'
  | 'transitionStatus'
>

interface ProviderPermissionCoordinatorDependencies {
  messageStore: Pick<SessionTranscript, 'getMessage' | 'updateAssistantContent' | 'setMessageError'>
  runLifecycle: ProviderPermissionRunLifecyclePort
  permissionPort: AcpAsLlmProviderPermissionPort
  messageProjection: Pick<MessageProjectionService, 'refresh'>
  publishEvent: DeepChatEventPublisher
}

export class ProviderPermissionCoordinator {
  constructor(private readonly deps: ProviderPermissionCoordinatorDependencies) {}

  async register(
    scope: SessionRuntimeScope,
    ownerRun: LoopRun<unknown>,
    permission: NonNullable<PendingToolInteraction['permission']>,
    tool: { callId?: string; name?: string; params?: string },
    commitDecision: (granted: boolean) => void
  ): Promise<void> {
    const requestId = permission.requestId?.trim()
    const providerId = permission.providerId?.trim()
    if (!requestId || providerId !== 'acp') return
    await scope.instance.registerActiveProviderPermission(
      {
        requestId,
        messageId: ownerRun.messageId,
        toolCallId: tool.callId || '',
        providerId,
        permissionType: permission.permissionType,
        resolve: async (granted) => {
          await this.deps.permissionPort.resolveAgentPermission(requestId, granted)
          if (
            this.deps.runLifecycle.isRunCurrentForScope(scope, ownerRun.runId) &&
            (!granted || !ownerRun.abortController.signal.aborted)
          )
            commitDecision(granted)
        }
      },
      ownerRun.runId
    )
  }

  async resolve(
    input: ProviderPermissionInteractionInput & { interactionLeaseId: string }
  ): Promise<void> {
    const scope = this.deps.runLifecycle.getHydratedScope(input.sessionId)
    if (!scope) return
    const { instance } = scope
    const candidate = instance.getActiveProviderPermission(input.requestId)
    const active =
      candidate?.messageId === input.messageId && candidate.toolCallId === input.toolCallId
        ? candidate
        : undefined
    const ownerRun = this.deps.runLifecycle.isMessageAssociatedWithRun(
      input.ownerRun,
      input.messageId
    )
      ? input.ownerRun
      : undefined
    if (input.signal?.aborted || ownerRun?.abortController.signal.aborted) return

    const granted = ownerRun ? input.granted : false
    const decision = await instance.takeProviderPermission({
      requestId: input.requestId,
      messageId: input.messageId,
      toolCallId: input.toolCallId,
      runId: ownerRun?.runId ?? null,
      leaseId: input.interactionLeaseId,
      granted,
      expected: active
    })
    if (
      decision.kind === 'stale' ||
      input.signal?.aborted ||
      !scope.isCurrent() ||
      ownerRun?.abortController.signal.aborted
    )
      return
    if (decision.kind === 'conflict') {
      if (ownerRun) {
        const projection: ProviderPermissionProjection = {
          status: 'error',
          message: 'ACP permission request ownership changed.'
        }
        this.updateActiveState(ownerRun, input, projection)
        this.updatePersistedState(input, projection)
        await this.removePending(instance, input)
      } else {
        await this.fail(
          input,
          'ACP permission request ownership changed.',
          instance,
          !input.ownerRun
        )
      }
      return
    }

    const resolve = async () =>
      decision.kind === 'spent'
        ? {
            status: 'stale' as const,
            error: new Error('ACP permission resolution was already claimed.')
          }
        : await resolveProviderPermissionSafely(() =>
            decision.kind === 'callback'
              ? decision.permission.resolve(granted)
              : this.deps.permissionPort.resolveAgentPermission(input.requestId, granted)
          )
    if (ownerRun) {
      const resolution = await resolve()
      if (
        input.signal?.aborted ||
        ownerRun.abortController.signal.aborted ||
        !this.deps.runLifecycle.isRunCurrentForScope(scope, ownerRun.runId)
      )
        return
      if (resolution.status === 'stale') {
        console.warn(
          `[DeepChatAgent] ACP permission request expired while its generation remained active: ${input.requestId}`,
          resolution.error
        )
      }
      if (decision.kind !== 'callback' || resolution.status === 'stale') {
        const projection: ProviderPermissionProjection =
          resolution.status === 'resolved'
            ? { status: 'resolved', granted: input.granted }
            : { status: 'error', message: 'Permission request expired.' }
        this.updateActiveState(ownerRun, input, projection)
        this.updatePersistedState(input, projection)
      }
      await this.removePending(instance, input)
      return
    }

    let resolution: Awaited<ReturnType<typeof resolve>> | { status: 'failed'; error: unknown }
    try {
      resolution = await resolve()
    } catch (error) {
      resolution = { status: 'failed', error }
    }
    if (input.signal?.aborted || !scope.isCurrent()) return
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
    await this.fail(
      input,
      resolution.status === 'stale'
        ? 'Permission request expired.'
        : 'ACP permission request lost its active generation.',
      instance,
      !input.ownerRun
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
        markStreamChanged(streamState)
      }
    }
  }

  private async fail(
    input: ProviderPermissionInteractionInput,
    errorMessage: string,
    instance?: DeepChatAgentInstance,
    publishStatus = true
  ): Promise<void> {
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
      requestId: this.deps.runLifecycle.resolveStreamRequestId(input.sessionId, input.messageId),
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
      await this.removePending(instance, input)
      if (publishStatus && !instance.getActiveGeneration()) {
        await this.deps.runLifecycle.transitionStatus(
          this.deps.runLifecycle.scopeFor(input.sessionId, instance),
          'error',
          input.controlOwner ?? { kind: 'orphan' },
          buildUsageFromMetadata(terminalMetadata)
        )
      }
    }
  }

  private async removePending(
    instance: DeepChatAgentInstance,
    input: ProviderPermissionInteractionInput
  ): Promise<void> {
    await instance.replacePendingInteractions(
      instance
        .getPendingInteractions()
        .filter(
          (interaction) =>
            interaction.messageId !== input.messageId || interaction.toolCallId !== input.toolCallId
        ),
      input.controlOwner ??
        (input.ownerRun ? { kind: 'run', id: input.ownerRun.runId } : { kind: 'orphan' })
    )
  }
}
