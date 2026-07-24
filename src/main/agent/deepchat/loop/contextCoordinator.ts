import type { LoopRun } from './loopRun'
import { advanceRequestSequence } from './loopRun'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent, ProviderRoundStopReason } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ModelConfig } from '@shared/types/provider'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewSyntheticContribution,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import {
  getContextSyntheticContributions,
  type ContextCheckpoint,
  type ContextRuntimeContributions
} from '@/agent/deepchat/runtime/contextContributions'

export interface ContextAssembly<TContributions, TView> {
  assembleContributions(): Promise<TContributions>
  buildView(contributions: TContributions): TView
  assertCurrent(): void
}

export interface PreparedContext<TContributions, TView> {
  contributions: TContributions
  view: TView
}

export type OptionalCompactionResult<TSummary> =
  | { applied: false }
  | { applied: true; summary: TSummary }

export interface ContextPressureRecovery<TSummary> {
  requestMessages: ChatMessage[]
  baseSystemPrompt?: string
  requestedMaxTokens: number
  toolReserveTokens: number
  minimumProtectedTailCount: number
  contextContributions: ContextRuntimeContributions
  prepareCompaction(systemPrompt: string): Promise<OptionalCompactionResult<TSummary>>
  assembleCheckpoint(summary: TSummary): Promise<ContextCheckpoint>
  getSummaryCursorOrderSeq(summary: TSummary): number
  fit(input: {
    messages: ChatMessage[]
    reserveTokens: number
    minimumProtectedTailCount: number
  }): ChatMessage[]
  assertCurrent(): void
}

export interface ContextPressureRecoveryResult {
  messages: ChatMessage[]
  summaryCursorOrderSeq?: number
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export interface RequestContextPreflight {
  messages: ChatMessage[]
  inputTokens: number
  toolReserveTokens: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  usableContextLength: number
  remainingOutputTokens: number
  totalRequestTokens: number
  fitsWithinContext: boolean
  shrunkByContextPressure: boolean
  requiresContextPressureRecovery: boolean
}

export interface ProviderAttemptBudgetPort {
  estimateToolReserveTokens(tools: MCPToolDefinition[]): number
  preflight(input: {
    messages: ChatMessage[]
    tools: MCPToolDefinition[]
    requestedMaxTokens: number
  }): RequestContextPreflight
  fitStrictRetry(input: { messages: ChatMessage[]; reserveTokens: number }): ChatMessage[]
  getStrictRetryMaxTokens(maxTokens: number): number
  getStrictRetryExtraReserve(): number
  buildOverflowError(preflight: RequestContextPreflight): Error
  buildOverflowAfterRecoveryError(preflight: RequestContextPreflight): Error
}

export interface ProviderAttemptRecoveryPort {
  recover(input: {
    requestMessages: ChatMessage[]
    requestedMaxTokens: number
    tools: MCPToolDefinition[]
  }): Promise<ContextPressureRecoveryResult>
}

export interface ProviderAttemptManifestContext<TSelection> {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  contextBuilderVersion: 'legacy-v1' | 'cache-aware-v1'
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export interface ProviderAttemptManifestInput<TSelection> {
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  selection?: TSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  contextBuilderVersion: 'legacy-v1' | 'cache-aware-v1'
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export interface ProviderAttemptManifestPort<TSelection> {
  resolvePolicy(input: {
    recoveredFromContextPressure: boolean
    isInitialViewRequest: boolean
    viewPolicy?: DeepChatTapeViewPolicy
    viewPolicyVersion?: number | null
  }): { policy: DeepChatTapeViewPolicy; policyVersion: number | null }
  append(input: ProviderAttemptManifestInput<TSelection>): void
  onAppendError(error: unknown): void
}

export interface ProviderRateGatePort {
  beforeWait(): void
  wait(signal: AbortSignal): Promise<void>
  clearWaiting(): void
}

export interface ProviderAttemptStreamPort {
  stream(input: {
    messages: ChatMessage[]
    modelId: string
    modelConfig: ModelConfig
    temperature: number
    maxTokens: number
    tools: MCPToolDefinition[]
  }): AsyncGenerator<LLMCoreStreamEvent>
  assertAvailable?(): void
  beforeStream(): void
}

export interface ProviderAttemptOutcomeInput {
  requestSeq: number
  status: 'completed' | 'context_overflow' | 'aborted' | 'error'
  stopReason: ProviderRoundStopReason | null
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  } | null
}

export interface ProviderAttemptOutcomePort {
  append(input: ProviderAttemptOutcomeInput): void
  onAppendError(error: unknown): void
}

function resolveProviderAttemptStatus(input: {
  contextOverflowObserved: boolean
  providerThrew: boolean
  providerError: unknown
  sawErrorEvent: boolean
  stopReason: ProviderRoundStopReason | null
  signalAborted: boolean
  isAbortError(error: unknown): boolean
}): ProviderAttemptOutcomeInput['status'] {
  if (input.contextOverflowObserved) return 'context_overflow'
  if (input.providerThrew) {
    return input.isAbortError(input.providerError) ? 'aborted' : 'error'
  }
  if (
    input.signalAborted &&
    (input.stopReason === null || input.stopReason === 'error' || input.sawErrorEvent)
  ) {
    return 'aborted'
  }
  if (input.sawErrorEvent || input.stopReason === 'error' || input.stopReason === null) {
    return 'error'
  }
  return 'completed'
}

export interface ProviderAttemptInput<TSelection> {
  run: LoopRun<unknown>
  requestMessages: ChatMessage[]
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
  bypassContextBudget: boolean
  fallbackContextLength: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  viewContext?: ProviderAttemptManifestContext<TSelection>
  budget: ProviderAttemptBudgetPort
  recovery: ProviderAttemptRecoveryPort
  manifest: ProviderAttemptManifestPort<TSelection>
  rateGate: ProviderRateGatePort
  provider: ProviderAttemptStreamPort
  outcome: ProviderAttemptOutcomePort
  isContextOverflowEvent(event: LLMCoreStreamEvent): boolean
  isContextOverflowError(error: unknown): boolean
  isAbortError(error: unknown): boolean
  createAbortError(): Error
}

export class DeepChatContextCoordinator {
  async assemble<TContributions, TView>(
    input: ContextAssembly<TContributions, TView>
  ): Promise<PreparedContext<TContributions, TView>> {
    const contributions = await input.assembleContributions()
    input.assertCurrent()
    return {
      contributions,
      view: input.buildView(contributions)
    }
  }

  async recoverFromPressure<TSummary>(
    input: ContextPressureRecovery<TSummary>
  ): Promise<ContextPressureRecoveryResult> {
    input.assertCurrent()
    const systemPromptBase =
      input.baseSystemPrompt ?? this.getLeadingSystemPrompt(input.requestMessages) ?? ''
    const compaction = await input.prepareCompaction(systemPromptBase)
    input.assertCurrent()
    if (!compaction.applied) {
      return { messages: input.requestMessages }
    }

    const checkpoint = await input.assembleCheckpoint(compaction.summary)
    input.assertCurrent()
    const messages = this.replaceCheckpointMessage(
      input.requestMessages,
      input.contextContributions.checkpoint.message,
      checkpoint.message
    )
    input.contextContributions.checkpoint = checkpoint

    return {
      messages: input.fit({
        messages,
        reserveTokens: input.requestedMaxTokens + input.toolReserveTokens,
        minimumProtectedTailCount: input.minimumProtectedTailCount
      }),
      summaryCursorOrderSeq: input.getSummaryCursorOrderSeq(compaction.summary),
      syntheticContributions: getContextSyntheticContributions(input.contextContributions)
    }
  }

  async *streamProviderAttempts<TSelection>(
    input: ProviderAttemptInput<TSelection>
  ): AsyncGenerator<LLMCoreStreamEvent> {
    let preflightContextRecoveryAttempted = false
    let providerOverflowRecoveryAttempted = false
    let providerContextOverflowRecoveryApplied = false
    let strictProviderOverflowRetryPending = false
    let manifestSummaryCursorOrderSeq = input.viewContext?.summaryCursorOrderSeq ?? 1
    let manifestSyntheticContributions = input.viewContext?.syntheticContributions
    const effectiveRequestToolReserveTokens = input.budget.estimateToolReserveTokens(input.tools)

    const prepareProviderAttempt = async (options?: {
      strictProviderOverflowRetry?: boolean
    }): Promise<{
      providerMessages: ChatMessage[]
      providerMaxTokens: number
      requestSeq: number
    }> => {
      let providerMessages = input.requestMessages
      let providerMaxTokens = input.maxTokens
      let manifestRequestedMaxTokens = input.maxTokens
      let manifestReserveTokens = input.maxTokens
      let strictExtraReserveTokens = 0
      let recoveredFromContextPressure =
        providerContextOverflowRecoveryApplied || options?.strictProviderOverflowRetry === true

      if (!input.bypassContextBudget) {
        let requestedMaxTokens = input.maxTokens
        if (options?.strictProviderOverflowRetry) {
          input.run.providerRecovery.strictProviderOverflowRetryUsed = true
          requestedMaxTokens = input.budget.getStrictRetryMaxTokens(input.maxTokens)
          strictExtraReserveTokens = input.budget.getStrictRetryExtraReserve()
          input.requestMessages.splice(
            0,
            input.requestMessages.length,
            ...input.budget.fitStrictRetry({
              messages: input.requestMessages,
              reserveTokens:
                requestedMaxTokens + effectiveRequestToolReserveTokens + strictExtraReserveTokens
            })
          )
        }

        let requestPreflight = input.budget.preflight({
          messages: input.requestMessages,
          tools: input.tools,
          requestedMaxTokens
        })
        if (
          !options?.strictProviderOverflowRetry &&
          (requestPreflight.requiresContextPressureRecovery || !requestPreflight.fitsWithinContext)
        ) {
          preflightContextRecoveryAttempted = true
          recoveredFromContextPressure = true
          if (!input.run.providerRecovery.contextOverflowHandoffAttempted) {
            input.run.providerRecovery.contextOverflowHandoffAttempted = true
            const recovered = await input.recovery.recover({
              requestMessages: requestPreflight.messages,
              requestedMaxTokens: requestPreflight.requestedMaxTokens,
              tools: input.tools
            })
            if (recovered.summaryCursorOrderSeq !== undefined) {
              manifestSummaryCursorOrderSeq = recovered.summaryCursorOrderSeq
            }
            if (recovered.syntheticContributions) {
              manifestSyntheticContributions = recovered.syntheticContributions
            }
            input.requestMessages.splice(0, input.requestMessages.length, ...recovered.messages)
            requestPreflight = input.budget.preflight({
              messages: input.requestMessages,
              tools: input.tools,
              requestedMaxTokens
            })
            input.requestMessages.splice(
              0,
              input.requestMessages.length,
              ...requestPreflight.messages
            )
          }
        }
        if (!requestPreflight.fitsWithinContext) {
          throw input.budget.buildOverflowError(requestPreflight)
        }
        providerMessages = requestPreflight.messages
        providerMaxTokens = requestPreflight.effectiveMaxTokens
        manifestRequestedMaxTokens = requestPreflight.requestedMaxTokens
        manifestReserveTokens = requestPreflight.requestedMaxTokens + strictExtraReserveTokens
      }
      if (providerMessages.length === 0) {
        throw new Error('Request was not sent because the prompt became empty.')
      }

      const requestSeq = advanceRequestSequence(input.run)
      const isInitialViewRequest =
        requestSeq === input.run.initialRequestSeq + 1 && Boolean(input.viewContext)
      const manifestPolicy = input.manifest.resolvePolicy({
        recoveredFromContextPressure,
        isInitialViewRequest,
        viewPolicy: input.viewContext?.policy,
        viewPolicyVersion: input.viewContext?.policyVersion
      })
      try {
        input.manifest.append({
          requestSeq,
          taskType: isInitialViewRequest ? input.viewContext!.taskType : 'tool_loop',
          policy: manifestPolicy.policy,
          policyVersion: manifestPolicy.policyVersion,
          messages: providerMessages,
          tools: input.tools,
          tokenBudget: {
            contextLength: input.modelConfig.contextLength ?? input.fallbackContextLength,
            requestedMaxTokens: manifestRequestedMaxTokens,
            effectiveMaxTokens: providerMaxTokens,
            reserveTokens: manifestReserveTokens,
            toolReserveTokens: effectiveRequestToolReserveTokens
          },
          selection:
            isInitialViewRequest && !recoveredFromContextPressure
              ? input.viewContext!.selection
              : undefined,
          summaryCursorOrderSeq: manifestSummaryCursorOrderSeq,
          supportsVision: input.viewContext?.supportsVision ?? input.supportsVision,
          supportsAudioInput: input.viewContext?.supportsAudioInput ?? input.supportsAudioInput,
          traceDebugEnabled: input.viewContext?.traceDebugEnabled ?? input.traceDebugEnabled,
          contextBuilderVersion: input.viewContext?.contextBuilderVersion ?? 'legacy-v1',
          syntheticContributions: manifestSyntheticContributions
        })
      } catch (error) {
        input.manifest.onAppendError(error)
      }

      return { providerMessages, providerMaxTokens, requestSeq }
    }

    const recoverProviderContextOverflow = async (
      providerMessages: ChatMessage[],
      providerMaxTokens: number
    ): Promise<void> => {
      input.run.providerRecovery.contextOverflowHandoffAttempted = true
      providerOverflowRecoveryAttempted = true
      const recovered = await input.recovery.recover({
        requestMessages: providerMessages,
        requestedMaxTokens: providerMaxTokens,
        tools: input.tools
      })
      if (recovered.summaryCursorOrderSeq !== undefined) {
        manifestSummaryCursorOrderSeq = recovered.summaryCursorOrderSeq
      }
      if (recovered.syntheticContributions) {
        manifestSyntheticContributions = recovered.syntheticContributions
      }
      providerContextOverflowRecoveryApplied = true
      strictProviderOverflowRetryPending = recovered.summaryCursorOrderSeq === undefined
      input.requestMessages.splice(0, input.requestMessages.length, ...recovered.messages)
    }

    const buildProviderOverflowRetryFailure = (
      providerMessages: ChatMessage[],
      providerMaxTokens: number
    ): Error => {
      const retryPreflight = input.budget.preflight({
        messages: providerMessages,
        tools: input.tools,
        requestedMaxTokens: providerMaxTokens
      })
      return retryPreflight.fitsWithinContext
        ? input.budget.buildOverflowAfterRecoveryError(retryPreflight)
        : input.budget.buildOverflowError(retryPreflight)
    }

    const scheduleStrictProviderOverflowRetry = (): boolean => {
      if (
        input.run.providerRecovery.strictProviderOverflowRetryUsed ||
        strictProviderOverflowRetryPending
      ) {
        return false
      }
      strictProviderOverflowRetryPending = true
      return true
    }

    try {
      providerAttemptLoop: for (;;) {
        input.provider.assertAvailable?.()
        const strictProviderOverflowRetry = strictProviderOverflowRetryPending
        strictProviderOverflowRetryPending = false
        const { providerMessages, providerMaxTokens, requestSeq } = await prepareProviderAttempt({
          strictProviderOverflowRetry
        })

        input.rateGate.beforeWait()
        await input.rateGate.wait(input.run.abortController.signal)
        input.rateGate.clearWaiting()
        if (input.run.abortController.signal.aborted) {
          throw input.createAbortError()
        }

        input.provider.beforeStream()
        let yieldedProviderEvent = false
        let contextOverflowObserved = false
        let providerThrew = false
        let providerError: unknown
        let sawErrorEvent = false
        let stopReason: ProviderRoundStopReason | null = null
        let usage: ProviderAttemptOutcomeInput['usage'] = null
        try {
          for await (const event of input.provider.stream({
            messages: providerMessages,
            modelId: input.modelId,
            modelConfig: input.modelConfig,
            temperature: input.temperature,
            maxTokens: providerMaxTokens,
            tools: input.tools
          })) {
            if (event.type === 'usage') {
              usage = {
                inputTokens: event.usage.prompt_tokens,
                outputTokens: event.usage.completion_tokens,
                totalTokens: event.usage.total_tokens,
                ...(event.usage.cached_tokens !== undefined
                  ? { cacheReadTokens: event.usage.cached_tokens }
                  : {}),
                ...(event.usage.cache_write_tokens !== undefined
                  ? { cacheWriteTokens: event.usage.cache_write_tokens }
                  : {})
              }
            } else if (event.type === 'error') {
              sawErrorEvent = true
              stopReason = 'error'
            } else if (event.type === 'stop') {
              if (stopReason !== 'error') {
                stopReason = event.stop_reason
              }
            }
            if (
              !yieldedProviderEvent &&
              !input.bypassContextBudget &&
              input.isContextOverflowEvent(event)
            ) {
              contextOverflowObserved = true
              if (
                input.run.providerRecovery.strictProviderOverflowRetryUsed ||
                providerOverflowRecoveryAttempted
              ) {
                throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
              }
              if (
                preflightContextRecoveryAttempted ||
                input.run.providerRecovery.contextOverflowHandoffAttempted
              ) {
                input.provider.assertAvailable?.()
                if (!scheduleStrictProviderOverflowRetry()) {
                  throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
                }
                continue providerAttemptLoop
              }
              input.provider.assertAvailable?.()
              await recoverProviderContextOverflow(providerMessages, providerMaxTokens)
              continue providerAttemptLoop
            }
            yieldedProviderEvent = true
            yield event
          }
          break
        } catch (error) {
          providerThrew = true
          providerError = error
          if (
            !yieldedProviderEvent &&
            !input.bypassContextBudget &&
            input.isContextOverflowError(error)
          ) {
            contextOverflowObserved = true
            if (
              input.run.providerRecovery.strictProviderOverflowRetryUsed ||
              providerOverflowRecoveryAttempted
            ) {
              throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
            }
            if (
              preflightContextRecoveryAttempted ||
              input.run.providerRecovery.contextOverflowHandoffAttempted
            ) {
              input.provider.assertAvailable?.()
              if (!scheduleStrictProviderOverflowRetry()) {
                throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
              }
              continue providerAttemptLoop
            }
            input.provider.assertAvailable?.()
            await recoverProviderContextOverflow(providerMessages, providerMaxTokens)
            continue providerAttemptLoop
          }
          throw error
        } finally {
          const status = resolveProviderAttemptStatus({
            contextOverflowObserved,
            providerThrew,
            providerError,
            sawErrorEvent,
            stopReason,
            signalAborted: input.run.abortController.signal.aborted,
            isAbortError: input.isAbortError
          })
          try {
            input.outcome.append({
              requestSeq,
              status,
              stopReason,
              usage
            })
          } catch (error) {
            try {
              input.outcome.onAppendError(error)
            } catch {}
          }
        }
      }
    } finally {
      input.rateGate.clearWaiting()
    }
  }

  private getLeadingSystemPrompt(messages: ChatMessage[]): string | null {
    const first = messages[0]
    return first?.role === 'system' && typeof first.content === 'string' ? first.content : null
  }

  private replaceCheckpointMessage(
    messages: ChatMessage[],
    previous: ChatMessage | null,
    next: ChatMessage | null
  ): ChatMessage[] {
    const result = [...messages]
    const searchOffset = result[0]?.role === 'system' ? 1 : 0
    const hasPrevious =
      Boolean(previous) &&
      result[searchOffset]?.role === 'user' &&
      result[searchOffset]?.content === previous?.content

    if (hasPrevious && next) {
      result[searchOffset] = next
    } else if (hasPrevious) {
      result.splice(searchOffset, 1)
    } else if (next) {
      result.splice(searchOffset, 0, next)
    }
    return result
  }
}
