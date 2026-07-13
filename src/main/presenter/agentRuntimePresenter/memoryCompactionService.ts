import logger from '@shared/logger'
import type {
  ChatMessageRecord,
  DeepChatSessionState,
  SessionCompactionState
} from '@shared/types/agent-interface'
import type {
  DeepChatMemoryIngestionProjectionInput,
  DeepChatMemoryIngestionProjectionRow
} from '../sqlitePresenter/tables/deepchatMemoryIngestionProjection'
import type { DeepChatTapeEntryRow } from '../sqlitePresenter/tables/deepchatTapeEntries'
import type { SQLitePresenter } from '../sqlitePresenter'
import {
  appendMemorySectionWithManifest,
  type MemoryRuntimePort
} from '../memoryPresenter/injection'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { CompactionService, type CompactionIntent } from './compactionService'
import {
  MEMORY_EXTRACTION_CHUNKS_PER_QUEUE_TASK,
  buildMemoryExtractionChunks,
  type MemoryExtractionChunk,
  type MemoryExtractionMessage
} from './memoryExtractionChunks'
import type { DeepChatMessageStore } from './messageStore'
import type { RuntimeSharedState } from './runtimeSharedState'
import type { DeepChatSessionStore, SessionSummaryState } from './sessionStore'
import { buildEffectiveTapeView } from './tapeEffectiveView'

const MEMORY_INJECTION_ACCESS_TURN_TTL_MS = 30 * 60 * 1000
const MEMORY_INJECTION_ACCESS_MAX_TURNS_PER_SESSION = 128
const MEMORY_INGESTION_PROJECTION_RETRY_COOLDOWN_MS = 30_000
const MEMORY_INGESTION_PROJECTION_FAILURE_CACHE_LIMIT = 256
const MEMORY_FALLBACK_MIN_DELTA = 6
const MEMORY_MIN_AGENTIC_TEXT_CHARS = 160

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

type MemoryAdmissionWindow = {
  chunks: MemoryExtractionChunk[]
  hadToolUse: boolean
  visibleTextChars: number
}

type MemoryInjectionAccessTurnEntry = {
  ids: Set<string>
  touchedAt: number
}

export type NextUserTurnCompactionRequest = Parameters<
  CompactionService['prepareForNextUserTurn']
>[0]
export type ContextPressureCompactionRequest = Parameters<
  CompactionService['prepareForContextPressureRecovery']
>[0]
export type ResumeTurnCompactionRequest = Parameters<CompactionService['prepareForResumeTurn']>[0]
export type ManualCompactionRequest = Parameters<CompactionService['prepareForManualCompaction']>[0]

export type MemoryCompactionHost = {
  getSessionAgentId: (sessionId: string) => string | undefined
  getSessionListState: (sessionId: string) => Promise<DeepChatSessionState | null>
  hasPendingInteractions: (sessionId: string) => boolean
  supportsManualCompaction: (state: DeepChatSessionState) => boolean
  buildManualCompactionRequest: (
    sessionId: string,
    state: DeepChatSessionState,
    signal?: AbortSignal
  ) => Promise<ManualCompactionRequest>
  setSessionStatus: (sessionId: string, status: DeepChatSessionState['status']) => void
  emitMessageRefresh: (sessionId: string, messageId: string) => void
}

export type MemoryCompactionDependencies = {
  sqlitePresenter: SQLitePresenter
  sessionStore: DeepChatSessionStore
  messageStore: DeepChatMessageStore
  runtimeSharedState: RuntimeSharedState
  compactionService: CompactionService
  memoryPort?: MemoryRuntimePort
}

export class MemoryCompactionService {
  private readonly sessionCompactionStates = new Map<string, SessionCompactionState>()
  private readonly memoryExtractionChains = new Map<string, Promise<void>>()
  private readonly memoryExtractionQueue = new Map<
    number,
    { sessionId: string; queuedAt: number }
  >()
  private nextMemoryExtractionQueueId = 0
  private readonly memoryExtractionEpochs = new Map<string, number>()
  private readonly memoryIngestionProjectionRetryAfter = new Map<string, number>()
  private readonly memoryInjectionAccessByTurn = new Map<string, MemoryInjectionAccessTurnEntry>()
  private readonly manualCompactionControllers = new Map<string, AbortController>()
  private readonly compactionEpochs = new Map<string, number>()

  constructor(
    private readonly dependencies: MemoryCompactionDependencies,
    private readonly host: MemoryCompactionHost
  ) {}

  initializeSession(sessionId: string): void {
    this.invalidateManualCompaction(sessionId)
    this.sessionCompactionStates.set(sessionId, this.buildIdleCompactionState())
    this.memoryIngestionProjectionRetryAfter.delete(sessionId)
  }

  destroySession(sessionId: string): void {
    this.invalidateManualCompaction(sessionId)
    this.bumpMemoryExtractionEpoch(sessionId)
    for (const [queueId, entry] of this.memoryExtractionQueue) {
      if (entry.sessionId === sessionId) this.memoryExtractionQueue.delete(queueId)
    }
    this.observeMemoryExtractionQueue()
    this.sessionCompactionStates.delete(sessionId)
    this.memoryIngestionProjectionRetryAfter.delete(sessionId)
    this.clearMemoryInjectionAccessForSession(sessionId)
  }

  clearMemoryIngestionProjectionRetry(sessionId: string): void {
    this.memoryIngestionProjectionRetryAfter.delete(sessionId)
  }

  async prepareForNextUserTurn(
    params: NextUserTurnCompactionRequest
  ): Promise<CompactionIntent | null> {
    return await this.dependencies.compactionService.prepareForNextUserTurn(params)
  }

  async prepareForContextPressureRecovery(
    params: ContextPressureCompactionRequest
  ): Promise<CompactionIntent | null> {
    return await this.dependencies.compactionService.prepareForContextPressureRecovery(params)
  }

  async resolveCompactionStateForResumeTurn(
    params: ResumeTurnCompactionRequest & { compactionMessageOrderSeq?: number }
  ): Promise<SessionSummaryState> {
    const intent = await this.dependencies.compactionService.prepareForResumeTurn(params)
    return await this.applyCompactionIntent(params.sessionId, intent, {
      compactionMessageOrderSeq: params.compactionMessageOrderSeq,
      shiftMessagesFromCompactionOrderSeq: params.compactionMessageOrderSeq !== undefined,
      signal: params.signal
    })
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    const runtimeState = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    const session = this.dependencies.sessionStore.get(sessionId)
    if (!runtimeState && !session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const persistedState = this.summaryStateToCompactionState(
      this.dependencies.sessionStore.getSummaryState(sessionId)
    )
    const currentCompactionState = this.sessionCompactionStates.get(sessionId)
    if (currentCompactionState?.status === 'compacting') {
      return { ...currentCompactionState }
    }

    if (
      currentCompactionState &&
      this.isSameCompactionState(currentCompactionState, persistedState)
    ) {
      return { ...currentCompactionState }
    }

    this.sessionCompactionStates.set(sessionId, persistedState)
    return { ...persistedState }
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    const lifecycleEpoch = this.ensureCompactionEpoch(sessionId)
    const state =
      this.dependencies.runtimeSharedState.runtimeState.get(sessionId) ??
      (await this.host.getSessionListState(sessionId))
    this.assertCompactionEpochCurrent(sessionId, lifecycleEpoch)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (!this.host.supportsManualCompaction(state)) {
      throw new Error('Manual compaction is only available for DeepChat agent sessions.')
    }
    if (state.status !== 'idle') {
      throw new Error('Manual compaction is only available when the session is idle.')
    }
    if (this.host.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before compacting.')
    }

    const { controller, epoch } = this.beginManualCompaction(sessionId)
    this.host.setSessionStatus(sessionId, 'generating')
    try {
      const request = await this.host.buildManualCompactionRequest(
        sessionId,
        state,
        controller.signal
      )
      this.assertManualCompactionCurrent(sessionId, controller, epoch)
      const intent = await this.dependencies.compactionService.prepareForManualCompaction({
        ...request,
        signal: controller.signal
      })
      this.assertManualCompactionCurrent(sessionId, controller, epoch)
      if (!intent) {
        const compactionState = await this.getSessionCompactionState(sessionId)
        this.assertManualCompactionCurrent(sessionId, controller, epoch)
        return {
          compacted: false,
          state: compactionState
        }
      }

      const summaryState = await this.applyCompactionIntent(sessionId, intent, {
        signal: controller.signal,
        expectedCompactionEpoch: epoch
      })
      this.assertManualCompactionCurrent(sessionId, controller, epoch)
      const compacted = summaryState.summaryUpdatedAt !== intent.previousState.summaryUpdatedAt
      const compactionState = await this.getSessionCompactionState(sessionId)
      this.assertManualCompactionCurrent(sessionId, controller, epoch)
      return {
        compacted,
        state: compactionState
      }
    } finally {
      if (this.ownsManualCompaction(sessionId, controller, epoch)) {
        this.manualCompactionControllers.delete(sessionId)
        this.host.setSessionStatus(sessionId, 'idle')
      }
    }
  }

  cancelManualCompaction(sessionId: string): boolean {
    const controller = this.manualCompactionControllers.get(sessionId)
    if (!controller || controller.signal.aborted) return false
    this.invalidateManualCompaction(sessionId)
    if (
      !this.dependencies.runtimeSharedState.activeGenerations.has(sessionId) &&
      !this.dependencies.runtimeSharedState.abortControllers.has(sessionId)
    ) {
      this.host.setSessionStatus(sessionId, 'idle')
    }
    return true
  }

  async applyCompactionIntent(
    sessionId: string,
    intent: CompactionIntent | null,
    options?: {
      compactionMessageId?: string
      compactionMessageOrderSeq?: number
      shiftMessagesFromCompactionOrderSeq?: boolean
      startedExternally?: boolean
      signal?: AbortSignal
      expectedCompactionEpoch?: number
    }
  ): Promise<SessionSummaryState> {
    this.throwIfAbortRequested(options?.signal)
    this.assertCompactionEpochCurrent(sessionId, options?.expectedCompactionEpoch)
    if (!intent) {
      return this.dependencies.sessionStore.getSummaryState(sessionId)
    }

    const compactionMessageId =
      options?.compactionMessageId ??
      (options?.compactionMessageOrderSeq !== undefined
        ? this.dependencies.messageStore.createCompactionMessageAtOrderSeq(
            sessionId,
            Math.max(1, Math.floor(options.compactionMessageOrderSeq)),
            'compacting',
            intent.previousState.summaryUpdatedAt,
            {
              shiftExistingMessages: options.shiftMessagesFromCompactionOrderSeq === true
            }
          )
        : this.dependencies.messageStore.createCompactionMessage(
            sessionId,
            this.dependencies.messageStore.getNextOrderSeq(sessionId),
            'compacting',
            intent.previousState.summaryUpdatedAt
          ))

    if (!options?.startedExternally) {
      this.host.emitMessageRefresh(sessionId, compactionMessageId)
      this.emitCompactionState(sessionId, {
        status: 'compacting',
        cursorOrderSeq: intent.targetCursorOrderSeq,
        summaryUpdatedAt: intent.previousState.summaryUpdatedAt
      })
    }

    let result: Awaited<ReturnType<CompactionService['applyCompaction']>>
    try {
      result = await this.dependencies.compactionService.applyCompaction(intent, options?.signal)
      this.throwIfAbortRequested(options?.signal)
      this.assertCompactionEpochCurrent(sessionId, options?.expectedCompactionEpoch)
    } catch (error) {
      this.dependencies.messageStore.deleteMessage(compactionMessageId)
      if (this.isCompactionEpochCurrent(sessionId, options?.expectedCompactionEpoch)) {
        this.host.emitMessageRefresh(sessionId, compactionMessageId)
        this.emitCompactionState(
          sessionId,
          this.summaryStateToCompactionState(intent.previousState)
        )
      }
      throw error
    }
    if (result.succeeded) {
      this.dependencies.messageStore.updateCompactionMessage(
        compactionMessageId,
        'compacted',
        result.summaryState.summaryUpdatedAt
      )
    } else {
      this.dependencies.messageStore.deleteMessage(compactionMessageId)
    }
    this.host.emitMessageRefresh(sessionId, compactionMessageId)
    this.emitCompactionState(
      sessionId,
      result.succeeded
        ? this.summaryStateToCompactionState(result.summaryState, 'compacted')
        : this.summaryStateToCompactionState(result.summaryState)
    )
    return result.summaryState
  }

  emitCompactionState(sessionId: string, state: SessionCompactionState): void {
    this.sessionCompactionStates.set(sessionId, { ...state })
    publishDeepchatEvent('sessions.compaction.changed', {
      sessionId,
      status: state.status,
      cursorOrderSeq: state.cursorOrderSeq,
      summaryUpdatedAt: state.summaryUpdatedAt,
      version: Date.now()
    })
  }

  resetSummaryState(sessionId: string): void {
    this.invalidateManualCompaction(sessionId)
    this.dependencies.sessionStore.resetSummaryState(sessionId)
    this.emitCompactionState(sessionId, this.buildIdleCompactionState())
  }

  resetMemoryExtractionCursor(sessionId: string): void {
    this.invalidateManualCompaction(sessionId)
    this.bumpMemoryExtractionEpoch(sessionId)
    this.dependencies.sqlitePresenter.deepchatSessionsTable.rewindMemoryCursorOrderSeq(sessionId, 0)
  }

  invalidateMemoryExtractionFromOrderSeq(sessionId: string, orderSeq: number): void {
    this.bumpMemoryExtractionEpoch(sessionId)
    const memoryCursor =
      this.dependencies.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId) ??
      0
    if (orderSeq <= memoryCursor) {
      this.dependencies.sqlitePresenter.deepchatSessionsTable.rewindMemoryCursorOrderSeq(
        sessionId,
        Math.max(0, Math.floor(orderSeq) - 1)
      )
    }
  }

  invalidateSummaryIfNeeded(sessionId: string, orderSeq: number): void {
    const summaryState = this.dependencies.sessionStore.getSummaryState(sessionId)
    if (orderSeq < summaryState.summaryCursorOrderSeq) {
      this.resetSummaryState(sessionId)
    }
  }

  async appendMemoryInjection(
    sessionId: string,
    systemPrompt: string,
    query: string,
    messageId?: string | null,
    signal?: AbortSignal
  ): Promise<string> {
    this.throwIfAbortRequested(signal)
    const memoryPort = this.dependencies.memoryPort
    if (!memoryPort) {
      return systemPrompt
    }
    try {
      const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
      if (!memoryPort.isEnabled(agentId)) {
        return systemPrompt
      }
      const injection = await memoryPort.buildInjection(agentId, query)
      this.throwIfAbortRequested(signal)
      if (!memoryPort.isEnabled(agentId)) return systemPrompt
      const assembled = appendMemorySectionWithManifest(systemPrompt, injection)
      if (assembled.manifest) {
        this.throwIfAbortRequested(signal)
        if (memoryPort.isEnabled(agentId)) {
          this.recordMemoryInjectionAccess(
            agentId,
            sessionId,
            assembled.manifest.selected,
            messageId
          )
        }
        if (memoryPort.isEnabled(agentId)) {
          this.throwIfAbortRequested(signal)
          try {
            this.dependencies.sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
              sessionId,
              name: 'memory/view_assembled',
              state: assembled.manifest as unknown as Record<string, unknown>,
              meta: messageId ? { messageId } : undefined
            })
          } catch (error) {
            logger.warn(`[DeepChatAgent] memory view anchor skipped: ${String(error)}`)
          }
        }
      }
      return assembled.prompt
    } catch (error) {
      if (this.isAbortError(error) || signal?.aborted) {
        throw error
      }
      logger.warn(`[DeepChatAgent] memory injection skipped: ${String(error)}`)
      return systemPrompt
    }
  }

  triggerMemoryExtractionFromCompaction(sessionId: string, intent: CompactionIntent): void {
    const memoryPort = this.dependencies.memoryPort
    if (!memoryPort) return
    const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
    if (!memoryPort.isEnabled(agentId)) return
    const toOrderSeq = Math.max(1, intent.targetCursorOrderSeq)
    this.enqueueSessionExtraction(sessionId, async (epoch) => {
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return
      const cursor =
        this.dependencies.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(
          sessionId
        ) ?? 0
      const window = this.buildMemoryExtractionWindow(sessionId, cursor, toOrderSeq)
      if (!window || window.visibleTextChars <= 0) return
      await this.runMemoryExtractionChunks(
        sessionId,
        {
          chunks: window.chunks,
          reason: 'compaction'
        },
        epoch
      )
    })
  }

  triggerMemoryExtractionFallback(sessionId: string): void {
    const memoryPort = this.dependencies.memoryPort
    if (!memoryPort) return
    const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
    if (!memoryPort.isEnabled(agentId)) return

    this.enqueueSessionExtraction(sessionId, async (epoch) => {
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return
      const tailOrderSeq = this.dependencies.messageStore.getNextOrderSeq(sessionId) - 1
      const cursor =
        this.dependencies.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(
          sessionId
        ) ?? 0
      if (tailOrderSeq <= cursor) return
      const window = this.buildMemoryExtractionWindow(sessionId, cursor, tailOrderSeq)
      if (!window || window.visibleTextChars <= 0) return
      const delta = tailOrderSeq - cursor
      const admit =
        window.hadToolUse ||
        delta >= MEMORY_FALLBACK_MIN_DELTA ||
        (delta >= 2 && window.visibleTextChars >= MEMORY_MIN_AGENTIC_TEXT_CHARS)
      if (!admit) return
      await this.runMemoryExtractionChunks(
        sessionId,
        {
          chunks: window.chunks,
          reason: 'fallback'
        },
        epoch
      )
    })
  }

  getLatestUserQuery(sessionId: string): string {
    const tailOrderSeq = this.dependencies.messageStore.getNextOrderSeq(sessionId) - 1
    if (tailOrderSeq < 0) return ''
    const records = this.dependencies.messageStore.getMessagesUpToOrderSeq(sessionId, tailOrderSeq)
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (records[i].role === 'user') return this.extractPlainTextFromRecord(records[i])
    }
    return ''
  }

  private buildIdleCompactionState(): SessionCompactionState {
    return {
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null
    }
  }

  private summaryStateToCompactionState(
    summaryState: SessionSummaryState,
    preferredStatus?: 'compacted'
  ): SessionCompactionState {
    const hasPersistedSummary =
      Boolean(summaryState.summaryText?.trim()) && summaryState.summaryUpdatedAt !== null
    if (preferredStatus === 'compacted' || hasPersistedSummary) {
      return {
        status: 'compacted',
        cursorOrderSeq: Math.max(1, summaryState.summaryCursorOrderSeq),
        summaryUpdatedAt: summaryState.summaryUpdatedAt
      }
    }
    return this.buildIdleCompactionState()
  }

  private isSameCompactionState(
    left: SessionCompactionState,
    right: SessionCompactionState
  ): boolean {
    return (
      left.status === right.status &&
      left.cursorOrderSeq === right.cursorOrderSeq &&
      left.summaryUpdatedAt === right.summaryUpdatedAt
    )
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
  }

  private throwIfAbortRequested(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw createAbortError()
    }
  }

  private ensureCompactionEpoch(sessionId: string): number {
    if (!this.compactionEpochs.has(sessionId)) {
      this.compactionEpochs.set(sessionId, 0)
    }
    return this.compactionEpochs.get(sessionId) ?? 0
  }

  private isCompactionEpochCurrent(sessionId: string, expectedEpoch?: number): boolean {
    return expectedEpoch === undefined || this.compactionEpochs.get(sessionId) === expectedEpoch
  }

  private assertCompactionEpochCurrent(sessionId: string, expectedEpoch?: number): void {
    if (!this.isCompactionEpochCurrent(sessionId, expectedEpoch)) {
      throw createAbortError()
    }
  }

  private beginManualCompaction(sessionId: string): { controller: AbortController; epoch: number } {
    this.manualCompactionControllers.get(sessionId)?.abort()
    const epoch = this.ensureCompactionEpoch(sessionId) + 1
    const controller = new AbortController()
    this.compactionEpochs.set(sessionId, epoch)
    this.manualCompactionControllers.set(sessionId, controller)
    return { controller, epoch }
  }

  private isManualCompactionCurrent(
    sessionId: string,
    controller: AbortController,
    epoch: number
  ): boolean {
    return !controller.signal.aborted && this.ownsManualCompaction(sessionId, controller, epoch)
  }

  private ownsManualCompaction(
    sessionId: string,
    controller: AbortController,
    epoch: number
  ): boolean {
    return (
      this.manualCompactionControllers.get(sessionId) === controller &&
      this.compactionEpochs.get(sessionId) === epoch
    )
  }

  private assertManualCompactionCurrent(
    sessionId: string,
    controller: AbortController,
    epoch: number
  ): void {
    if (!this.isManualCompactionCurrent(sessionId, controller, epoch)) {
      throw createAbortError()
    }
  }

  private invalidateManualCompaction(sessionId: string): void {
    const nextEpoch = this.ensureCompactionEpoch(sessionId) + 1
    this.compactionEpochs.set(sessionId, nextEpoch)
    const controller = this.manualCompactionControllers.get(sessionId)
    this.manualCompactionControllers.delete(sessionId)
    controller?.abort()
  }

  private recordMemoryInjectionAccess(
    agentId: string,
    sessionId: string,
    selected: Array<{ id: string }>,
    messageId?: string | null
  ): void {
    const memoryPort = this.dependencies.memoryPort
    if (!memoryPort || selected.length === 0) return
    const selectedIds = [...new Set(selected.map((item) => item.id).filter(Boolean))]
    if (!selectedIds.length) return

    let idsToRecord = selectedIds
    let seen: Set<string> | undefined
    if (messageId) {
      const now = Date.now()
      this.pruneMemoryInjectionAccessForSession(sessionId, now)
      const key = this.memoryInjectionAccessKey(sessionId, messageId)
      let entry = this.memoryInjectionAccessByTurn.get(key)
      if (!entry) {
        entry = { ids: new Set(), touchedAt: now }
        this.memoryInjectionAccessByTurn.set(key, entry)
        this.pruneMemoryInjectionAccessForSession(sessionId, now)
      } else {
        entry.touchedAt = now
      }
      seen = entry.ids
      idsToRecord = selectedIds.filter((id) => !seen?.has(id))
      if (!idsToRecord.length) return
    }

    try {
      memoryPort.recordInjectionAccess(agentId, idsToRecord)
      if (seen) {
        for (const id of idsToRecord) seen.add(id)
      }
    } catch (error) {
      logger.warn(`[DeepChatAgent] memory access accounting skipped: ${String(error)}`)
    }
  }

  private memoryInjectionAccessKey(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`
  }

  private clearMemoryInjectionAccessForSession(sessionId: string): void {
    const prefix = `${sessionId}\u0000`
    for (const key of this.memoryInjectionAccessByTurn.keys()) {
      if (key.startsWith(prefix)) this.memoryInjectionAccessByTurn.delete(key)
    }
  }

  private pruneMemoryInjectionAccessForSession(sessionId: string, now: number = Date.now()): void {
    const prefix = `${sessionId}\u0000`
    const entries: Array<{ key: string; touchedAt: number }> = []
    for (const [key, entry] of this.memoryInjectionAccessByTurn) {
      if (!key.startsWith(prefix)) continue
      if (now - entry.touchedAt > MEMORY_INJECTION_ACCESS_TURN_TTL_MS) {
        this.memoryInjectionAccessByTurn.delete(key)
        continue
      }
      entries.push({ key, touchedAt: entry.touchedAt })
    }
    if (entries.length <= MEMORY_INJECTION_ACCESS_MAX_TURNS_PER_SESSION) return
    entries.sort(
      (left, right) => left.touchedAt - right.touchedAt || left.key.localeCompare(right.key)
    )
    const deleteCount = entries.length - MEMORY_INJECTION_ACCESS_MAX_TURNS_PER_SESSION
    for (const entry of entries.slice(0, deleteCount)) {
      this.memoryInjectionAccessByTurn.delete(entry.key)
    }
  }

  private enqueueSessionExtraction(
    sessionId: string,
    task: (epoch: number) => Promise<void>,
    expectedEpoch?: number
  ): void {
    const queueId = ++this.nextMemoryExtractionQueueId
    this.memoryExtractionQueue.set(queueId, { sessionId, queuedAt: Date.now() })
    this.observeMemoryExtractionQueue()
    const previous = this.memoryExtractionChains.get(sessionId) ?? Promise.resolve()
    const runTask = async () => {
      try {
        const currentEpoch = this.ensureMemoryExtractionEpoch(sessionId)
        if (expectedEpoch !== undefined && currentEpoch !== expectedEpoch) return
        await task(expectedEpoch ?? currentEpoch)
      } finally {
        this.memoryExtractionQueue.delete(queueId)
        this.observeMemoryExtractionQueue()
      }
    }
    const next = previous.then(runTask, runTask).catch((error) => {
      logger.warn(`[DeepChatAgent] memory extraction chain error: ${String(error)}`)
    })
    this.memoryExtractionChains.set(sessionId, next)
    void next.finally(() => {
      if (this.memoryExtractionChains.get(sessionId) === next) {
        this.memoryExtractionChains.delete(sessionId)
        if (!this.dependencies.runtimeSharedState.runtimeState.has(sessionId)) {
          this.memoryExtractionEpochs.delete(sessionId)
        }
      }
    })
  }

  private observeMemoryExtractionQueue(): void {
    const oldestQueuedAt = this.memoryExtractionQueue.values().next().value?.queuedAt ?? null
    this.dependencies.memoryPort?.observeExtractionQueue?.(
      this.memoryExtractionQueue.size,
      oldestQueuedAt
    )
  }

  private async runMemoryExtractionChunks(
    sessionId: string,
    options: {
      chunks: readonly MemoryExtractionChunk[]
      reason: 'compaction' | 'fallback'
    },
    epoch: number
  ): Promise<void> {
    const memoryPort = this.dependencies.memoryPort
    if (!memoryPort) return
    try {
      const agentId = this.host.getSessionAgentId(sessionId) ?? 'deepchat'
      if (!memoryPort.isEnabled(agentId)) return
      const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
      if (!state) return
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return

      const currentTaskChunks = options.chunks.slice(0, MEMORY_EXTRACTION_CHUNKS_PER_QUEUE_TASK)
      for (const chunk of currentTaskChunks) {
        if (!memoryPort.isEnabled(agentId)) return
        if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return
        const cursor =
          this.dependencies.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(
            sessionId
          ) ?? 0
        if (chunk.coveredThroughOrderSeq <= cursor) continue

        const result = await memoryPort.extractAndStore({
          agentId,
          spanText: chunk.text,
          model: { providerId: state.providerId, modelId: state.modelId },
          sourceSession: sessionId,
          sourceEntryIds: chunk.sourceEntryIds
        })
        if (!result.ok || !memoryPort.isEnabled(agentId)) return
        if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return

        if (chunk.cursorCommitOrderSeq !== null) {
          this.dependencies.sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq(
            sessionId,
            chunk.cursorCommitOrderSeq
          )
        }

        if (result.createdIds.length > 0) {
          this.dependencies.sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
            sessionId,
            name: 'memory/extract',
            state: {
              memoryIds: result.createdIds,
              count: result.createdIds.length,
              reason: options.reason,
              sourceEntryIds: chunk.sourceEntryIds,
              coveredThroughOrderSeq: chunk.coveredThroughOrderSeq,
              cursorCommitOrderSeq: chunk.cursorCommitOrderSeq,
              fragments: chunk.fragments
            }
          })
        }
      }

      const remaining = options.chunks.slice(MEMORY_EXTRACTION_CHUNKS_PER_QUEUE_TASK)
      if (
        remaining.length > 0 &&
        memoryPort.isEnabled(agentId) &&
        this.isMemoryExtractionEpochCurrent(sessionId, epoch)
      ) {
        this.enqueueSessionExtraction(
          sessionId,
          async (continuationEpoch) => {
            await this.runMemoryExtractionChunks(
              sessionId,
              { chunks: remaining, reason: options.reason },
              continuationEpoch
            )
          },
          epoch
        )
      }
    } catch (error) {
      logger.warn(`[DeepChatAgent] memory extraction skipped: ${String(error)}`)
    }
  }

  private buildMemoryExtractionWindow(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): MemoryAdmissionWindow | null {
    if (toOrderSeqInclusive <= fromOrderSeqExclusive) return null
    const ingestionRange = this.listMemoryIngestionRange(
      sessionId,
      fromOrderSeqExclusive,
      toOrderSeqInclusive
    )
    if (!ingestionRange) return null

    const selected = ingestionRange.rows.map((row) => ({
      messageId: row.message_id,
      orderSeq: row.order_seq,
      entryId: row.entry_id,
      role: row.role,
      content: row.content
    }))
    const hadToolUse = ingestionRange.rows.some((row) => row.had_tool_use === 1)
    if (selected.length === 0) return null

    const messages: MemoryExtractionMessage[] = []
    for (const entry of selected) {
      const text = this.extractPlainTextFromRecord(entry)
      if (!text) continue
      messages.push({
        orderSeq: entry.orderSeq,
        entryId: entry.entryId,
        role: entry.role,
        text
      })
    }
    const chunks = buildMemoryExtractionChunks(messages)
    const selectedTailOrderSeq = selected.at(-1)?.orderSeq
    const lastChunk = chunks.at(-1)
    if (lastChunk && selectedTailOrderSeq !== undefined && ingestionRange.cursorCommitAllowed) {
      lastChunk.cursorCommitOrderSeq = selectedTailOrderSeq
      lastChunk.coveredThroughOrderSeq = selectedTailOrderSeq
    }
    if (!ingestionRange.cursorCommitAllowed) {
      chunks.forEach((chunk) => {
        chunk.cursorCommitOrderSeq = null
      })
    }
    return {
      chunks,
      hadToolUse,
      visibleTextChars: chunks.reduce((total, chunk) => total + chunk.text.length, 0)
    }
  }

  private listMemoryIngestionRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): { rows: DeepChatMemoryIngestionProjectionRow[]; cursorCommitAllowed: boolean } | null {
    const projectionTable = this.dependencies.sqlitePresenter.deepchatMemoryIngestionProjectionTable
    if (
      !projectionTable ||
      typeof projectionTable.readCurrentRange !== 'function' ||
      typeof projectionTable.replaceSession !== 'function' ||
      typeof projectionTable.invalidateSession !== 'function'
    ) {
      return this.buildFullTapeIngestionRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive,
        false
      )
    }

    if (this.isMemoryIngestionProjectionCoolingDown(sessionId)) return null

    try {
      const current = projectionTable.readCurrentRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive
      )
      if (current.current) {
        this.memoryIngestionProjectionRetryAfter.delete(sessionId)
        return { rows: current.rows, cursorCommitAllowed: true }
      }
      return this.rebuildMemoryIngestionRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive,
        current.maxEntryId
      )
    } catch (error) {
      this.recordMemoryIngestionProjectionFailure(sessionId)
      try {
        projectionTable.invalidateSession(sessionId)
      } catch {}
      logger.warn(
        `[DeepChatAgent] memory ingestion projection unavailable; falling back to Tape: ${String(error)}`
      )
      return this.buildFullTapeIngestionRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive,
        false
      )
    }
  }

  private rebuildMemoryIngestionRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number,
    maxEntryId: number
  ): { rows: DeepChatMemoryIngestionProjectionRow[]; cursorCommitAllowed: boolean } | null {
    const tapeRows =
      this.dependencies.sqlitePresenter.deepchatTapeEntriesTable.getBySession(sessionId)
    const projectionTable = this.dependencies.sqlitePresenter.deepchatMemoryIngestionProjectionTable
    const view = buildEffectiveTapeView(tapeRows)
    const projectionRows = this.projectionRowsFromEffectiveView(sessionId, view)
    try {
      projectionTable.replaceSession(sessionId, projectionRows, maxEntryId)
      this.memoryIngestionProjectionRetryAfter.delete(sessionId)
      return {
        rows: this.filterMemoryIngestionRange(
          projectionRows,
          fromOrderSeqExclusive,
          toOrderSeqInclusive
        ),
        cursorCommitAllowed: true
      }
    } catch (error) {
      this.recordMemoryIngestionProjectionFailure(sessionId)
      try {
        projectionTable.invalidateSession(sessionId)
      } catch {}
      logger.warn(
        `[DeepChatAgent] memory ingestion projection rebuild failed; using Tape without cursor commit: ${String(error)}`
      )
      return {
        rows: this.filterMemoryIngestionRange(
          projectionRows,
          fromOrderSeqExclusive,
          toOrderSeqInclusive
        ),
        cursorCommitAllowed: false
      }
    }
  }

  private isMemoryIngestionProjectionCoolingDown(sessionId: string): boolean {
    const retryAfter = this.memoryIngestionProjectionRetryAfter.get(sessionId)
    if (retryAfter === undefined) return false
    if (Date.now() < retryAfter) return true
    this.memoryIngestionProjectionRetryAfter.delete(sessionId)
    return false
  }

  private recordMemoryIngestionProjectionFailure(sessionId: string): void {
    if (this.memoryIngestionProjectionRetryAfter.has(sessionId)) {
      this.memoryIngestionProjectionRetryAfter.delete(sessionId)
    } else if (
      this.memoryIngestionProjectionRetryAfter.size >=
      MEMORY_INGESTION_PROJECTION_FAILURE_CACHE_LIMIT
    ) {
      const oldestSessionId = this.memoryIngestionProjectionRetryAfter.keys().next().value
      if (oldestSessionId !== undefined) {
        this.memoryIngestionProjectionRetryAfter.delete(oldestSessionId)
      }
    }
    this.memoryIngestionProjectionRetryAfter.set(
      sessionId,
      Date.now() + MEMORY_INGESTION_PROJECTION_RETRY_COOLDOWN_MS
    )
  }

  private buildFullTapeIngestionRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number,
    cursorCommitAllowed: boolean
  ): { rows: DeepChatMemoryIngestionProjectionRow[]; cursorCommitAllowed: boolean } | null {
    try {
      const view = buildEffectiveTapeView(
        this.dependencies.sqlitePresenter.deepchatTapeEntriesTable.getBySession(sessionId)
      )
      const rows = this.projectionRowsFromEffectiveView(sessionId, view)
      return {
        rows: this.filterMemoryIngestionRange(rows, fromOrderSeqExclusive, toOrderSeqInclusive),
        cursorCommitAllowed
      }
    } catch (error) {
      logger.warn(`[DeepChatAgent] authoritative Tape fallback failed: ${String(error)}`)
      return null
    }
  }

  private projectionRowsFromEffectiveView(
    sessionId: string,
    view: ReturnType<typeof buildEffectiveTapeView>
  ): DeepChatMemoryIngestionProjectionInput[] {
    const messageIdsWithToolUse = new Set<string>()
    for (const row of view.rows) {
      const messageId = this.readToolCallMessageId(row)
      if (messageId) messageIdsWithToolUse.add(messageId)
    }
    return view.messageEntries.map((entry) => {
      if (entry.record.status !== 'sent' && entry.record.status !== 'error') {
        throw new Error('Effective Tape view exposed a pending message during rebuild.')
      }
      return {
        sessionId,
        messageId: entry.record.id,
        orderSeq: entry.record.orderSeq,
        entryId: entry.entryId,
        role: entry.record.role,
        content: entry.record.content,
        status: entry.record.status,
        hadToolUse: messageIdsWithToolUse.has(entry.record.id)
      }
    })
  }

  private filterMemoryIngestionRange(
    rows: readonly DeepChatMemoryIngestionProjectionInput[],
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): DeepChatMemoryIngestionProjectionRow[] {
    return rows
      .filter((row) => row.orderSeq > fromOrderSeqExclusive && row.orderSeq <= toOrderSeqInclusive)
      .map((row) => ({
        session_id: row.sessionId,
        message_id: row.messageId,
        order_seq: row.orderSeq,
        entry_id: row.entryId,
        role: row.role,
        content: row.content,
        status: row.status,
        had_tool_use: row.hadToolUse ? 1 : 0
      }))
  }

  private readToolCallMessageId(row: DeepChatTapeEntryRow): string | null {
    if (row.kind !== 'tool_call') return null
    try {
      const payload = JSON.parse(row.payload_json) as { messageId?: unknown }
      return typeof payload.messageId === 'string' && payload.messageId.length > 0
        ? payload.messageId
        : null
    } catch {
      return null
    }
  }

  private extractPlainTextFromRecord(record: Pick<ChatMessageRecord, 'role' | 'content'>): string {
    try {
      const parsed = JSON.parse(record.content) as unknown
      if (record.role === 'user') {
        const text = (parsed as { text?: unknown })?.text
        return typeof text === 'string' ? text.trim() : ''
      }
      if (Array.isArray(parsed)) {
        return parsed
          .map((block) => {
            const candidate = block as { type?: string; content?: unknown }
            if (candidate?.type === 'content' && typeof candidate.content === 'string') {
              return candidate.content
            }
            return ''
          })
          .filter(Boolean)
          .join(' ')
          .trim()
      }
      return ''
    } catch {
      return ''
    }
  }

  private ensureMemoryExtractionEpoch(sessionId: string): number {
    if (!this.memoryExtractionEpochs.has(sessionId)) {
      this.memoryExtractionEpochs.set(sessionId, 0)
    }
    return this.memoryExtractionEpochs.get(sessionId) ?? 0
  }

  private bumpMemoryExtractionEpoch(sessionId: string): void {
    const epoch = this.memoryExtractionEpochs.get(sessionId) ?? 0
    this.memoryExtractionEpochs.set(sessionId, epoch + 1)
  }

  private isMemoryExtractionEpochCurrent(sessionId: string, epoch: number): boolean {
    return this.memoryExtractionEpochs.get(sessionId) === epoch
  }
}
