import { nanoid } from 'nanoid'
import logger from 'electron-log'
import type { DeepChatTapeEntryRow } from '../domain/entry'
import type { TapeApplicationProviders } from '../ports/application'
import { deleteTapeGeneration } from './generationLifecycle'
import { parseJsonObject } from './common'
import type { TapeForkHandle } from './contracts'

type TapeForkProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getEntryLifecycleStore' | 'getSearchProjectionStore'
>

function readForkMergeReceiptCount(
  row: DeepChatTapeEntryRow,
  parentSessionId: string,
  forkId: string,
  forkSessionIdValue: string
): number {
  const payload = parseJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {}
  const mergedCount = data.mergedCount
  const forkHeadEntryId = data.forkHeadEntryId
  const hasValidLegacyOrCurrentHead =
    forkHeadEntryId === undefined ||
    (typeof forkHeadEntryId === 'number' &&
      Number.isSafeInteger(forkHeadEntryId) &&
      forkHeadEntryId >= 0)
  if (
    row.session_id !== parentSessionId ||
    row.kind !== 'event' ||
    row.name !== 'fork/merge' ||
    row.source_type !== 'fork' ||
    row.source_id !== forkId ||
    row.source_seq !== 0 ||
    row.provenance_key !== `fork:${parentSessionId}:${forkId}:merge:event` ||
    data.forkId !== forkId ||
    data.forkSessionId !== forkSessionIdValue ||
    typeof mergedCount !== 'number' ||
    !Number.isSafeInteger(mergedCount) ||
    mergedCount < 0 ||
    !hasValidLegacyOrCurrentHead ||
    (typeof forkHeadEntryId === 'number' && mergedCount > forkHeadEntryId)
  ) {
    throw new Error(`Stored fork merge receipt is malformed: ${row.entry_id}`)
  }
  return mergedCount
}

function assertValidForkStart(
  row: DeepChatTapeEntryRow | undefined,
  parentSessionId: string,
  forkId: string,
  forkSessionIdValue: string
): void {
  if (!row) {
    throw new Error(`Fork ${forkId} does not exist or has been discarded.`)
  }
  const payload = parseJsonObject(row.payload_json)
  const state =
    payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
      ? (payload.state as Record<string, unknown>)
      : {}
  const parentHeadEntryId = state.parentHeadEntryId
  const hasValidLegacyOrCurrentHead =
    parentHeadEntryId === undefined ||
    (typeof parentHeadEntryId === 'number' &&
      Number.isSafeInteger(parentHeadEntryId) &&
      parentHeadEntryId >= 0)
  if (
    row.session_id !== forkSessionIdValue ||
    row.kind !== 'anchor' ||
    row.name !== 'fork/start' ||
    row.source_type !== 'fork' ||
    row.source_id !== forkId ||
    row.source_seq !== 0 ||
    row.provenance_key !== `fork:${parentSessionId}:${forkId}:start` ||
    state.parentSessionId !== parentSessionId ||
    !hasValidLegacyOrCurrentHead
  ) {
    throw new Error(`Stored fork start is malformed: ${row.entry_id}`)
  }
}

function forkSessionId(parentSessionId: string, forkId: string): string {
  return `${parentSessionId}::fork::${forkId}`
}

function forkDiscardProvenanceKey(parentSessionId: string, forkId: string): string {
  return `fork:${parentSessionId}:${forkId}:discard:event`
}

function forkMergeProvenanceKey(parentSessionId: string, forkId: string): string {
  return `fork:${parentSessionId}:${forkId}:merge:event`
}

export class TapeForkService {
  constructor(private readonly providers: TapeForkProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  createFork(parentSessionId: string, forkId: string = nanoid()): TapeForkHandle {
    const table = this.table
    const forkIdValue = forkId.trim() || nanoid()
    if (
      table.getByProvenanceKey(
        parentSessionId,
        forkMergeProvenanceKey(parentSessionId, forkIdValue)
      )
    ) {
      throw new Error(`Fork ${forkIdValue} has already been merged and cannot be reused.`)
    }
    if (
      table.getByProvenanceKey(
        parentSessionId,
        forkDiscardProvenanceKey(parentSessionId, forkIdValue)
      )
    ) {
      throw new Error(`Fork ${forkIdValue} has been discarded and cannot be reused.`)
    }
    const forkSessionIdValue = forkSessionId(parentSessionId, forkIdValue)
    const parentHeadEntryId = table.getMaxEntryId(parentSessionId)
    table.ensureBootstrapAnchor(forkSessionIdValue)
    const parentAnchor = table.getLatestAnchor(parentSessionId)
    const forkStart = table.appendAnchor({
      sessionId: forkSessionIdValue,
      name: 'fork/start',
      source: {
        type: 'fork',
        id: forkIdValue,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkIdValue}:start`,
      state: {
        parentSessionId,
        parentHeadEntryId,
        parentLastAnchorEntryId: parentAnchor?.entry_id ?? null,
        parentLastAnchorName: parentAnchor?.name ?? null
      },
      idempotent: true
    })
    const forkStartPayload = parseJsonObject(forkStart.payload_json)
    const persistedState =
      forkStartPayload.state &&
      typeof forkStartPayload.state === 'object' &&
      !Array.isArray(forkStartPayload.state)
        ? (forkStartPayload.state as Record<string, unknown>)
        : {}
    const persistedParentHeadEntryId = persistedState.parentHeadEntryId
    return {
      parentSessionId,
      forkId: forkIdValue,
      forkSessionId: forkSessionIdValue,
      parentHeadEntryId:
        typeof persistedParentHeadEntryId === 'number' &&
        Number.isSafeInteger(persistedParentHeadEntryId) &&
        persistedParentHeadEntryId >= 0
          ? persistedParentHeadEntryId
          : parentHeadEntryId
    }
  }

  mergeFork(parentSessionId: string, forkId: string): number {
    const table = this.table
    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    const mergeProvenanceKey = forkMergeProvenanceKey(parentSessionId, forkId)

    return table.runInTransaction(() => {
      const existingReceipt = table.getByProvenanceKey(parentSessionId, mergeProvenanceKey)
      if (existingReceipt) {
        return readForkMergeReceiptCount(
          existingReceipt,
          parentSessionId,
          forkId,
          forkSessionIdValue
        )
      }

      if (
        table.getByProvenanceKey(parentSessionId, forkDiscardProvenanceKey(parentSessionId, forkId))
      ) {
        throw new Error(`Fork ${forkId} does not exist or has been discarded.`)
      }

      assertValidForkStart(
        table.getByProvenanceKey(forkSessionIdValue, `fork:${parentSessionId}:${forkId}:start`),
        parentSessionId,
        forkId,
        forkSessionIdValue
      )

      const forkHeadEntryId = table.getMaxEntryId(forkSessionIdValue)
      const forkEntries = table
        .getBySessionUpToEntryId(forkSessionIdValue, forkHeadEntryId)
        .filter(
          (entry) =>
            !(
              entry.kind === 'anchor' &&
              (entry.name === 'session/start' || entry.name === 'fork/start')
            )
        )

      for (const entry of forkEntries) {
        table.append({
          sessionId: parentSessionId,
          kind: entry.kind,
          name: entry.name,
          source: {
            type: 'fork',
            id: forkId,
            seq: entry.entry_id
          },
          provenanceKey: `fork:${parentSessionId}:${forkId}:merge:${entry.entry_id}`,
          payload: parseJsonObject(entry.payload_json),
          meta: {
            ...parseJsonObject(entry.meta_json),
            forkId,
            forkSessionId: forkSessionIdValue,
            mergedFromEntryId: entry.entry_id
          },
          createdAt: entry.created_at,
          idempotent: true
        })
      }

      table.appendEvent({
        sessionId: parentSessionId,
        name: 'fork/merge',
        source: {
          type: 'fork',
          id: forkId,
          seq: 0
        },
        provenanceKey: mergeProvenanceKey,
        data: {
          forkId,
          forkSessionId: forkSessionIdValue,
          forkHeadEntryId,
          mergedCount: forkEntries.length
        },
        idempotent: true
      })

      return forkEntries.length
    })
  }

  discardFork(parentSessionId: string, forkId: string): void {
    const table = this.table
    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    let cleanupError: unknown
    table.runInTransaction(() => {
      try {
        deleteTapeGeneration(this.providers, forkSessionIdValue)
      } catch (error) {
        cleanupError = error
      }
      table.appendEvent({
        sessionId: parentSessionId,
        name: 'fork/discard',
        source: {
          type: 'fork',
          id: forkId,
          seq: 0
        },
        provenanceKey: forkDiscardProvenanceKey(parentSessionId, forkId),
        data: {
          forkId,
          forkSessionId: forkSessionIdValue
        },
        idempotent: true
      })
    })
    if (cleanupError) {
      logger.warn(`[Tape] failed to delete fork Tape generation: ${String(cleanupError)}`)
    }
  }

  recordExternalForkMerge(
    parentSessionId: string,
    forkSessionIdValue: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    const referencedEntryCount = table.countBySession(forkSessionIdValue)
    return table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/merge',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:external-merge:event`,
      data: {
        ...meta,
        forkId,
        forkSessionId: forkSessionIdValue,
        referencedEntryCount
      },
      idempotent: true
    })
  }

  recordExternalForkDiscard(
    parentSessionId: string,
    forkSessionIdValue: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    return table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/discard',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:external-discard:event`,
      data: {
        ...meta,
        forkId,
        forkSessionId: forkSessionIdValue
      },
      idempotent: true
    })
  }
}
