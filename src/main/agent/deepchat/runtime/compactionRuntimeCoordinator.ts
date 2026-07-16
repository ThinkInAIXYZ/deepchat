import type { SessionCompactionState } from '@shared/types/agent-interface'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { CompactionIntent, CompactionService } from './compactionService'
import type { DeepChatEventPublisher } from './types'
import type { SessionTranscript } from '@/session/data/transcript'
import type { SessionSettingsStore, SessionSummaryState } from '@/session/data/settings'

interface CompactionRuntimeCoordinatorDependencies {
  compactionService: CompactionService
  sessionStore: SessionSettingsStore
  messageStore: SessionTranscript
  getInstance(sessionId: string): DeepChatAgentInstance
  assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void
  emitMessageRefresh(sessionId: string, messageId: string): void
  isAbortError(error: unknown): boolean
  throwIfAbortRequested(signal?: AbortSignal): void
  publishEvent: DeepChatEventPublisher
}

interface ApplyCompactionOptions {
  compactionMessageId?: string
  compactionMessageOrderSeq?: number
  shiftMessagesFromCompactionOrderSeq?: boolean
  startedExternally?: boolean
  signal?: AbortSignal
}

export class CompactionRuntimeCoordinator {
  constructor(private readonly deps: CompactionRuntimeCoordinatorDependencies) {}

  async apply(
    sessionId: string,
    intent: CompactionIntent | null,
    options?: ApplyCompactionOptions,
    expectedInstance = this.deps.getInstance(sessionId)
  ): Promise<SessionSummaryState> {
    this.deps.assertCurrent(sessionId, expectedInstance)
    if (!intent) {
      return this.deps.sessionStore.getSummaryState(sessionId)
    }

    const compactionMessageId =
      options?.compactionMessageId ??
      (options?.compactionMessageOrderSeq !== undefined
        ? this.deps.messageStore.createCompactionMessageAtOrderSeq(
            sessionId,
            Math.max(1, Math.floor(options.compactionMessageOrderSeq)),
            'compacting',
            intent.previousState.summaryUpdatedAt,
            { shiftExistingMessages: options.shiftMessagesFromCompactionOrderSeq === true }
          )
        : this.deps.messageStore.createCompactionMessage(
            sessionId,
            this.deps.messageStore.getNextOrderSeq(sessionId),
            'compacting',
            intent.previousState.summaryUpdatedAt
          ))

    if (!options?.startedExternally) {
      this.deps.emitMessageRefresh(sessionId, compactionMessageId)
      this.emit(
        sessionId,
        {
          status: 'compacting',
          cursorOrderSeq: intent.targetCursorOrderSeq,
          summaryUpdatedAt: intent.previousState.summaryUpdatedAt
        },
        expectedInstance
      )
    }

    let result: Awaited<ReturnType<CompactionService['applyCompaction']>>
    try {
      result = await this.deps.compactionService.applyCompaction(intent, options?.signal)
    } catch (error) {
      this.deps.assertCurrent(sessionId, expectedInstance)
      this.deps.messageStore.deleteMessage(compactionMessageId)
      this.deps.emitMessageRefresh(sessionId, compactionMessageId)
      this.emit(sessionId, this.fromSummary(intent.previousState), expectedInstance)
      if (this.deps.isAbortError(error) || options?.signal?.aborted) {
        this.deps.throwIfAbortRequested(options?.signal)
      }
      throw error
    }

    this.deps.assertCurrent(sessionId, expectedInstance)
    if (result.succeeded) {
      this.deps.messageStore.updateCompactionMessage(
        compactionMessageId,
        'compacted',
        result.summaryState.summaryUpdatedAt
      )
    } else {
      this.deps.messageStore.deleteMessage(compactionMessageId)
    }
    this.deps.emitMessageRefresh(sessionId, compactionMessageId)
    this.emit(
      sessionId,
      result.succeeded
        ? this.fromSummary(result.summaryState, 'compacted')
        : this.fromSummary(result.summaryState),
      expectedInstance
    )
    return result.summaryState
  }

  idleState(): SessionCompactionState {
    return { status: 'idle', cursorOrderSeq: 1, summaryUpdatedAt: null }
  }

  fromSummary(
    summaryState: SessionSummaryState,
    preferredStatus?: 'compacted'
  ): SessionCompactionState {
    const hasPersistedSummary =
      Boolean(summaryState.summaryText?.trim()) && summaryState.summaryUpdatedAt !== null
    return preferredStatus === 'compacted' || hasPersistedSummary
      ? {
          status: 'compacted',
          cursorOrderSeq: Math.max(1, summaryState.summaryCursorOrderSeq),
          summaryUpdatedAt: summaryState.summaryUpdatedAt
        }
      : this.idleState()
  }

  isSame(left: SessionCompactionState, right: SessionCompactionState): boolean {
    return (
      left.status === right.status &&
      left.cursorOrderSeq === right.cursorOrderSeq &&
      left.summaryUpdatedAt === right.summaryUpdatedAt
    )
  }

  emit(
    sessionId: string,
    state: SessionCompactionState,
    expectedInstance = this.deps.getInstance(sessionId)
  ): void {
    this.deps.assertCurrent(sessionId, expectedInstance)
    expectedInstance.setCompactionState(state)
    this.deps.publishEvent('sessions.compaction.changed', {
      sessionId,
      status: state.status,
      cursorOrderSeq: state.cursorOrderSeq,
      summaryUpdatedAt: state.summaryUpdatedAt,
      version: Date.now()
    })
  }

  reset(sessionId: string, expectedInstance = this.deps.getInstance(sessionId)): void {
    this.deps.assertCurrent(sessionId, expectedInstance)
    this.deps.sessionStore.resetSummaryState(sessionId)
    this.emit(sessionId, this.idleState(), expectedInstance)
  }

  invalidateIfNeeded(
    sessionId: string,
    orderSeq: number,
    expectedInstance = this.deps.getInstance(sessionId)
  ): void {
    this.deps.assertCurrent(sessionId, expectedInstance)
    if (orderSeq < this.deps.sessionStore.getSummaryState(sessionId).summaryCursorOrderSeq) {
      this.reset(sessionId, expectedInstance)
    }
  }
}
