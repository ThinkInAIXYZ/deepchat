import logger from '@shared/logger'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatMemorySessionHandle } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { appendMemorySectionWithManifest } from '@/presenter/memoryPresenter/injection'
import type { MemoryRuntimePort } from '@/presenter/memoryPresenter/injection'
import { buildEffectiveTapeView } from '@/presenter/agentRuntimePresenter/tapeEffectiveView'
import type { CompactionIntent } from '@/presenter/agentRuntimePresenter/compactionService'
import type {
  DeepChatMemoryIngestionCurrentRange,
  DeepChatMemoryIngestionProjectionInput,
  DeepChatMemoryIngestionProjectionRow
} from '@/presenter/sqlitePresenter/tables/deepchatMemoryIngestionProjection'
import type { DeepChatTapeEntryRow } from '@/presenter/sqlitePresenter/tables/deepchatTapeEntries'
import {
  MEMORY_EXTRACTION_CHUNKS_PER_QUEUE_TASK,
  buildMemoryExtractionChunks,
  type MemoryExtractionChunk,
  type MemoryExtractionMessage
} from './memoryExtractionChunks'

const MEMORY_INJECTION_ACCESS_TURN_TTL_MS = 30 * 60 * 1000
const MEMORY_INJECTION_ACCESS_MAX_TURNS_PER_SESSION = 128
const MEMORY_INGESTION_PROJECTION_RETRY_COOLDOWN_MS = 30_000
const MEMORY_INGESTION_PROJECTION_FAILURE_CACHE_LIMIT = 256
const MEMORY_FALLBACK_MIN_DELTA = 6
const MEMORY_MIN_AGENTIC_TEXT_CHARS = 160

interface MemoryInjectionAccessTurnEntry {
  ids: Set<string>
  touchedAt: number
}

interface MemoryAdmissionWindow {
  chunks: MemoryExtractionChunk[]
  hadToolUse: boolean
  visibleTextChars: number
}

interface MemoryIngestionProjection {
  readCurrentRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): DeepChatMemoryIngestionCurrentRange
  replaceSession(
    sessionId: string,
    rows: readonly DeepChatMemoryIngestionProjectionInput[],
    maxEntryId: number
  ): void
  invalidateSession(sessionId: string): void
}

export interface MemoryRuntimeCoordinatorDependencies {
  memoryPort?: MemoryRuntimePort
  getSessionAgentId(sessionId: string): string | undefined
  getSessionRuntimeState(sessionId: string): { providerId: string; modelId: string } | undefined
  hasSessionRuntimeState(sessionId: string): boolean
  assertCurrentSessionHandle(handle: DeepChatMemorySessionHandle): void
  getNextMessageOrderSeq(sessionId: string): number
  getMessagesUpToOrderSeq(sessionId: string, orderSeq: number): ChatMessageRecord[]
  getMemoryCursorOrderSeq(sessionId: string): number | null
  updateMemoryCursorOrderSeq(sessionId: string, orderSeq: number): void
  rewindMemoryCursorOrderSeq(sessionId: string, orderSeq: number): void
  getTapeRows(sessionId: string): DeepChatTapeEntryRow[]
  appendTapeAnchor(input: {
    sessionId: string
    name: string
    state: Record<string, unknown>
    meta?: Record<string, unknown>
  }): void
  getIngestionProjection(): MemoryIngestionProjection | undefined
}

export class MemoryRuntimeCoordinator {
  private memoryPort?: MemoryRuntimePort
  private readonly extractionChains = new Map<string, Promise<void>>()
  private readonly extractionQueue = new Map<number, { sessionId: string; queuedAt: number }>()
  private nextExtractionQueueId = 0
  private readonly extractionEpochs = new Map<string, number>()
  private readonly ingestionProjectionRetryAfter = new Map<string, number>()
  private readonly injectionAccessByTurn = new Map<string, MemoryInjectionAccessTurnEntry>()

  constructor(private readonly deps: MemoryRuntimeCoordinatorDependencies) {
    this.memoryPort = deps.memoryPort
  }

  setPort(memoryPort?: MemoryRuntimePort): void {
    this.memoryPort = memoryPort
  }

  initializeSession(sessionId: string): void {
    this.clearProjectionRetry(sessionId)
  }

  beginSessionDestroy(sessionId: string): void {
    this.bumpSessionEpoch(sessionId)
    for (const [queueId, entry] of this.extractionQueue) {
      if (entry.sessionId === sessionId) this.extractionQueue.delete(queueId)
    }
    this.observeExtractionQueue()
  }

  finishSessionDestroy(sessionId: string): void {
    this.clearProjectionRetry(sessionId)
    this.clearInjectionAccessForSession(sessionId)
  }

  clearProjectionRetry(sessionId: string): void {
    this.ingestionProjectionRetryAfter.delete(sessionId)
  }

  resetExtractionCursor(sessionId: string): void {
    this.bumpSessionEpoch(sessionId)
    this.deps.rewindMemoryCursorOrderSeq(sessionId, 0)
  }

  invalidateFromOrderSeq(sessionId: string, orderSeq: number): void {
    this.bumpSessionEpoch(sessionId)
    const memoryCursor = this.deps.getMemoryCursorOrderSeq(sessionId) ?? 0
    if (orderSeq <= memoryCursor) {
      this.deps.rewindMemoryCursorOrderSeq(sessionId, Math.max(0, Math.floor(orderSeq) - 1))
    }
  }

  async appendPrompt(
    sessionId: string,
    systemPrompt: string,
    query: string,
    messageId?: string | null
  ): Promise<string> {
    if (!this.memoryPort) return systemPrompt
    try {
      const agentId = this.deps.getSessionAgentId(sessionId) ?? 'deepchat'
      if (!this.memoryPort.isEnabled(agentId)) return systemPrompt
      const injection = await this.memoryPort.buildInjection(agentId, query)
      if (!this.memoryPort.isEnabled(agentId)) return systemPrompt
      const assembled = appendMemorySectionWithManifest(systemPrompt, injection)
      if (assembled.manifest) {
        if (this.memoryPort.isEnabled(agentId)) {
          this.recordInjectionAccess(agentId, sessionId, assembled.manifest.selected, messageId)
        }
        if (this.memoryPort.isEnabled(agentId)) {
          try {
            this.deps.appendTapeAnchor({
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
      logger.warn(`[DeepChatAgent] memory injection skipped: ${String(error)}`)
      return systemPrompt
    }
  }

  recordInjectionAccess(
    agentId: string,
    sessionId: string,
    selected: Array<{ id: string }>,
    messageId?: string | null
  ): void {
    if (!this.memoryPort || selected.length === 0) return
    const selectedIds = [...new Set(selected.map((item) => item.id).filter(Boolean))]
    if (!selectedIds.length) return

    let idsToRecord = selectedIds
    let seen: Set<string> | undefined
    if (messageId) {
      const now = Date.now()
      this.pruneInjectionAccessForSession(sessionId, now)
      const key = this.injectionAccessKey(sessionId, messageId)
      let entry = this.injectionAccessByTurn.get(key)
      if (!entry) {
        entry = { ids: new Set(), touchedAt: now }
        this.injectionAccessByTurn.set(key, entry)
        this.pruneInjectionAccessForSession(sessionId, now)
      } else {
        entry.touchedAt = now
      }
      seen = entry.ids
      idsToRecord = selectedIds.filter((id) => !seen?.has(id))
      if (!idsToRecord.length) return
    }

    try {
      this.memoryPort.recordInjectionAccess(agentId, idsToRecord)
      if (seen) {
        for (const id of idsToRecord) seen.add(id)
      }
    } catch (error) {
      logger.warn(`[DeepChatAgent] memory access accounting skipped: ${String(error)}`)
    }
  }

  triggerExtractionFromCompaction(
    memorySession: DeepChatMemorySessionHandle,
    intent: CompactionIntent
  ): void {
    this.deps.assertCurrentSessionHandle(memorySession)
    const sessionId = memorySession.sessionId
    if (!this.memoryPort) return
    const agentId = this.deps.getSessionAgentId(sessionId) ?? 'deepchat'
    if (!this.memoryPort.isEnabled(agentId)) return
    const toOrderSeq = Math.max(1, intent.targetCursorOrderSeq)
    this.enqueueSessionExtraction(sessionId, async (epoch) => {
      if (!this.isSessionEpochCurrent(sessionId, epoch)) return
      const cursor = this.deps.getMemoryCursorOrderSeq(sessionId) ?? 0
      const window = this.buildExtractionWindow(sessionId, cursor, toOrderSeq)
      if (!window || window.visibleTextChars <= 0) return
      await this.runExtractionChunks(
        sessionId,
        { chunks: window.chunks, reason: 'compaction' },
        epoch
      )
    })
  }

  triggerExtractionFallback(sessionId: string): void {
    if (!this.memoryPort) return
    const agentId = this.deps.getSessionAgentId(sessionId) ?? 'deepchat'
    if (!this.memoryPort.isEnabled(agentId)) return

    this.enqueueSessionExtraction(sessionId, async (epoch) => {
      if (!this.isSessionEpochCurrent(sessionId, epoch)) return
      const tailOrderSeq = this.deps.getNextMessageOrderSeq(sessionId) - 1
      const cursor = this.deps.getMemoryCursorOrderSeq(sessionId) ?? 0
      if (tailOrderSeq <= cursor) return
      const window = this.buildExtractionWindow(sessionId, cursor, tailOrderSeq)
      if (!window || window.visibleTextChars <= 0) return
      const delta = tailOrderSeq - cursor
      const admit =
        window.hadToolUse ||
        delta >= MEMORY_FALLBACK_MIN_DELTA ||
        (delta >= 2 && window.visibleTextChars >= MEMORY_MIN_AGENTIC_TEXT_CHARS)
      if (!admit) return
      await this.runExtractionChunks(
        sessionId,
        { chunks: window.chunks, reason: 'fallback' },
        epoch
      )
    })
  }

  enqueueSessionExtraction(
    sessionId: string,
    task: (epoch: number) => Promise<void>,
    expectedEpoch?: number
  ): void {
    const queueId = ++this.nextExtractionQueueId
    this.extractionQueue.set(queueId, { sessionId, queuedAt: Date.now() })
    this.observeExtractionQueue()
    const previous = this.extractionChains.get(sessionId) ?? Promise.resolve()
    const runTask = async () => {
      try {
        const currentEpoch = this.ensureSessionEpoch(sessionId)
        if (expectedEpoch !== undefined && currentEpoch !== expectedEpoch) return
        await task(expectedEpoch ?? currentEpoch)
      } finally {
        this.extractionQueue.delete(queueId)
        this.observeExtractionQueue()
      }
    }
    const next = previous.then(runTask, runTask).catch((error) => {
      logger.warn(`[DeepChatAgent] memory extraction chain error: ${String(error)}`)
    })
    this.extractionChains.set(sessionId, next)
    void next.finally(() => {
      if (this.extractionChains.get(sessionId) === next) {
        this.extractionChains.delete(sessionId)
        if (!this.deps.hasSessionRuntimeState(sessionId)) {
          this.extractionEpochs.delete(sessionId)
        }
      }
    })
  }

  async waitForSession(sessionId: string): Promise<void> {
    while (true) {
      const chain = this.extractionChains.get(sessionId)
      if (!chain) return
      await chain
      await Promise.resolve()
    }
  }

  async runExtractionChunks(
    sessionId: string,
    options: {
      chunks: readonly MemoryExtractionChunk[]
      reason: 'compaction' | 'fallback'
    },
    epoch: number
  ): Promise<void> {
    if (!this.memoryPort) return
    try {
      const agentId = this.deps.getSessionAgentId(sessionId) ?? 'deepchat'
      if (!this.memoryPort.isEnabled(agentId)) return
      const state = this.deps.getSessionRuntimeState(sessionId)
      if (!state || !this.isSessionEpochCurrent(sessionId, epoch)) return

      const currentTaskChunks = options.chunks.slice(0, MEMORY_EXTRACTION_CHUNKS_PER_QUEUE_TASK)
      for (const chunk of currentTaskChunks) {
        if (!this.memoryPort.isEnabled(agentId)) return
        if (!this.isSessionEpochCurrent(sessionId, epoch)) return
        const cursor = this.deps.getMemoryCursorOrderSeq(sessionId) ?? 0
        if (chunk.coveredThroughOrderSeq <= cursor) continue

        const result = await this.memoryPort.extractAndStore({
          agentId,
          spanText: chunk.text,
          model: { providerId: state.providerId, modelId: state.modelId },
          sourceSession: sessionId,
          sourceEntryIds: chunk.sourceEntryIds
        })
        if (!result.ok || !this.memoryPort.isEnabled(agentId)) return
        if (!this.isSessionEpochCurrent(sessionId, epoch)) return

        if (chunk.cursorCommitOrderSeq !== null) {
          this.deps.updateMemoryCursorOrderSeq(sessionId, chunk.cursorCommitOrderSeq)
        }
        if (result.createdIds.length > 0) {
          this.deps.appendTapeAnchor({
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
        this.memoryPort.isEnabled(agentId) &&
        this.isSessionEpochCurrent(sessionId, epoch)
      ) {
        this.enqueueSessionExtraction(
          sessionId,
          async (continuationEpoch) => {
            await this.runExtractionChunks(
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

  buildExtractionWindow(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): MemoryAdmissionWindow | null {
    if (toOrderSeqInclusive <= fromOrderSeqExclusive) return null
    const ingestionRange = this.listIngestionRange(
      sessionId,
      fromOrderSeqExclusive,
      toOrderSeqInclusive
    )
    if (!ingestionRange || ingestionRange.rows.length === 0) return null

    const selected = ingestionRange.rows.map((row) => ({
      orderSeq: row.order_seq,
      entryId: row.entry_id,
      role: row.role,
      content: row.content
    }))
    const messages: MemoryExtractionMessage[] = []
    for (const entry of selected) {
      const text = this.extractPlainText(entry)
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
      hadToolUse: ingestionRange.rows.some((row) => row.had_tool_use === 1),
      visibleTextChars: chunks.reduce((total, chunk) => total + chunk.text.length, 0)
    }
  }

  getLatestUserQuery(sessionId: string): string {
    const tailOrderSeq = this.deps.getNextMessageOrderSeq(sessionId) - 1
    if (tailOrderSeq < 0) return ''
    const records = this.deps.getMessagesUpToOrderSeq(sessionId, tailOrderSeq)
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index].role === 'user') return this.extractPlainText(records[index])
    }
    return ''
  }

  ensureSessionEpoch(sessionId: string): number {
    if (!this.extractionEpochs.has(sessionId)) this.extractionEpochs.set(sessionId, 0)
    return this.extractionEpochs.get(sessionId) ?? 0
  }

  bumpSessionEpoch(sessionId: string): void {
    this.extractionEpochs.set(sessionId, (this.extractionEpochs.get(sessionId) ?? 0) + 1)
  }

  isSessionEpochCurrent(sessionId: string, epoch: number): boolean {
    return this.extractionEpochs.get(sessionId) === epoch
  }

  private observeExtractionQueue(): void {
    const oldestQueuedAt = this.extractionQueue.values().next().value?.queuedAt ?? null
    this.memoryPort?.observeExtractionQueue?.(this.extractionQueue.size, oldestQueuedAt)
  }

  private injectionAccessKey(sessionId: string, messageId: string): string {
    return `${sessionId}\u0000${messageId}`
  }

  private clearInjectionAccessForSession(sessionId: string): void {
    const prefix = `${sessionId}\u0000`
    for (const key of this.injectionAccessByTurn.keys()) {
      if (key.startsWith(prefix)) this.injectionAccessByTurn.delete(key)
    }
  }

  private pruneInjectionAccessForSession(sessionId: string, now: number = Date.now()): void {
    const prefix = `${sessionId}\u0000`
    const entries: Array<{ key: string; touchedAt: number }> = []
    for (const [key, entry] of this.injectionAccessByTurn) {
      if (!key.startsWith(prefix)) continue
      if (now - entry.touchedAt > MEMORY_INJECTION_ACCESS_TURN_TTL_MS) {
        this.injectionAccessByTurn.delete(key)
        continue
      }
      entries.push({ key, touchedAt: entry.touchedAt })
    }
    if (entries.length <= MEMORY_INJECTION_ACCESS_MAX_TURNS_PER_SESSION) return
    entries.sort(
      (left, right) => left.touchedAt - right.touchedAt || left.key.localeCompare(right.key)
    )
    for (const entry of entries.slice(
      0,
      entries.length - MEMORY_INJECTION_ACCESS_MAX_TURNS_PER_SESSION
    )) {
      this.injectionAccessByTurn.delete(entry.key)
    }
  }

  private listIngestionRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): { rows: DeepChatMemoryIngestionProjectionRow[]; cursorCommitAllowed: boolean } | null {
    const projection = this.deps.getIngestionProjection()
    if (
      !projection ||
      typeof projection.readCurrentRange !== 'function' ||
      typeof projection.replaceSession !== 'function' ||
      typeof projection.invalidateSession !== 'function'
    ) {
      return this.buildFullTapeIngestionRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive,
        false
      )
    }
    if (this.isIngestionProjectionCoolingDown(sessionId)) return null

    try {
      const current = projection.readCurrentRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive
      )
      if (current.current) {
        this.ingestionProjectionRetryAfter.delete(sessionId)
        return { rows: current.rows, cursorCommitAllowed: true }
      }
      return this.rebuildIngestionRange(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive,
        current.maxEntryId,
        projection
      )
    } catch (error) {
      this.recordIngestionProjectionFailure(sessionId)
      try {
        projection.invalidateSession(sessionId)
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

  private rebuildIngestionRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number,
    maxEntryId: number,
    projection: MemoryIngestionProjection
  ): { rows: DeepChatMemoryIngestionProjectionRow[]; cursorCommitAllowed: boolean } {
    const view = buildEffectiveTapeView(this.deps.getTapeRows(sessionId))
    const projectionRows = this.projectionRowsFromEffectiveView(sessionId, view)
    try {
      projection.replaceSession(sessionId, projectionRows, maxEntryId)
      this.ingestionProjectionRetryAfter.delete(sessionId)
      return {
        rows: this.filterIngestionRange(projectionRows, fromOrderSeqExclusive, toOrderSeqInclusive),
        cursorCommitAllowed: true
      }
    } catch (error) {
      this.recordIngestionProjectionFailure(sessionId)
      try {
        projection.invalidateSession(sessionId)
      } catch {}
      logger.warn(
        `[DeepChatAgent] memory ingestion projection rebuild failed; using Tape without cursor commit: ${String(error)}`
      )
      return {
        rows: this.filterIngestionRange(projectionRows, fromOrderSeqExclusive, toOrderSeqInclusive),
        cursorCommitAllowed: false
      }
    }
  }

  private isIngestionProjectionCoolingDown(sessionId: string): boolean {
    const retryAfter = this.ingestionProjectionRetryAfter.get(sessionId)
    if (retryAfter === undefined) return false
    if (Date.now() < retryAfter) return true
    this.ingestionProjectionRetryAfter.delete(sessionId)
    return false
  }

  private recordIngestionProjectionFailure(sessionId: string): void {
    if (this.ingestionProjectionRetryAfter.has(sessionId)) {
      this.ingestionProjectionRetryAfter.delete(sessionId)
    } else if (
      this.ingestionProjectionRetryAfter.size >= MEMORY_INGESTION_PROJECTION_FAILURE_CACHE_LIMIT
    ) {
      const oldestSessionId = this.ingestionProjectionRetryAfter.keys().next().value
      if (oldestSessionId !== undefined) this.ingestionProjectionRetryAfter.delete(oldestSessionId)
    }
    this.ingestionProjectionRetryAfter.set(
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
      const view = buildEffectiveTapeView(this.deps.getTapeRows(sessionId))
      const rows = this.projectionRowsFromEffectiveView(sessionId, view)
      return {
        rows: this.filterIngestionRange(rows, fromOrderSeqExclusive, toOrderSeqInclusive),
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

  private filterIngestionRange(
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

  private extractPlainText(record: Pick<ChatMessageRecord, 'role' | 'content'>): string {
    try {
      const parsed = JSON.parse(record.content) as unknown
      if (record.role === 'user') {
        const text = (parsed as { text?: unknown })?.text
        return typeof text === 'string' ? text.trim() : ''
      }
      if (Array.isArray(parsed)) {
        return parsed
          .map((block) => {
            const value = block as { type?: string; content?: unknown }
            return value?.type === 'content' && typeof value.content === 'string'
              ? value.content
              : ''
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
}
