import { Buffer } from 'node:buffer'
import type {
  ExportTapeInspectorSupportFactsInput,
  ExportTapeInspectorSupportFactsOutput,
  GetTapeInspectorRecordDetailInput,
  GetTapeInspectorRecordDetailOutput,
  ListTapeInspectorPageInput,
  ListTapeInspectorPageOutput,
  ResolveTapeInspectorEvidenceEntriesInput,
  ResolveTapeInspectorEvidenceEntriesOutput,
  TapeInspectorEntryCursor,
  TapeInspectorEvidenceEntryIdentity,
  TapeInspectorFactRecord,
  TapeInspectorHead,
  TapeInspectorRecordDetail,
  TapeInspectorSort
} from '@shared/types/tape-inspector'
import {
  TAPE_INSPECTOR_SUPPORT_DETAIL_DATA_BYTES,
  TAPE_INSPECTOR_SUPPORT_FACT_LIMIT
} from '@shared/types/tape-inspector'
import type { DeepChatTapeEntryRow } from '../domain/entry'
import { hashString } from '../domain/replay'
import type { TapeApplicationProviders, TapeInspectorTraceBinding } from '../ports/application'
import type { TapeInspectorEntryScanInput } from '../ports/storage'
import { buildTapeProviderAttemptProvenanceKey } from '../domain/providerAttempt'
import { readCanonicalTapeIncarnationId } from './common'
import {
  getTapeInspectorTraceBinding,
  matchesTapeInspectorFilters,
  projectTapeInspectorDetail,
  projectTapeInspectorFact
} from './traceInspectorProjection'

const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 200
const MAX_FILTER_SCAN_ROWS = 2_000
const STORAGE_SCAN_CHUNK = 200
const CANONICAL_SORT = { column: 'entryId', direction: 'asc' } as const

type TraceInspectorProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getMessageTraceReader'
>

function bindingKey(binding: TapeInspectorTraceBinding): string {
  return JSON.stringify([
    binding.scope,
    binding.messageId,
    binding.requestSeq,
    binding.scope === 'attempt' ? binding.physicalAttempt : '*'
  ])
}

function evidenceIdentityKey(identity: TapeInspectorEvidenceEntryIdentity): string {
  return JSON.stringify([identity.messageId, identity.requestSeq, identity.physicalAttempt])
}

function normalizedLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_PAGE_LIMIT), 1), MAX_PAGE_LIMIT)
}

function cursorForRow(
  row: DeepChatTapeEntryRow,
  sort: TapeInspectorSort,
  snapshotMaxEntryId: number
): TapeInspectorEntryCursor {
  if (sort.column === 'entryId') return { sort: 'entryId', entryId: row.entry_id }
  if (sort.column === 'name') {
    return {
      sort: 'name',
      direction: sort.direction,
      nameHash: hashName(row.name),
      entryId: row.entry_id,
      snapshotMaxEntryId
    }
  }
  if (sort.column === 'kind') {
    return {
      sort: 'kind',
      direction: sort.direction,
      kind: row.kind,
      entryId: row.entry_id,
      snapshotMaxEntryId
    }
  }
  return {
    sort: 'createdAt',
    direction: sort.direction,
    createdAt: row.created_at,
    entryId: row.entry_id,
    snapshotMaxEntryId
  }
}

function hashName(name: string | null): string {
  return hashString(JSON.stringify(name))
}

function storageCursorForRow(
  row: DeepChatTapeEntryRow,
  sort: TapeInspectorSort,
  snapshotMaxEntryId: number
): NonNullable<TapeInspectorEntryScanInput['cursor']> {
  if (sort.column === 'name') {
    return {
      sort: 'name',
      direction: sort.direction,
      name: row.name,
      entryId: row.entry_id,
      snapshotMaxEntryId
    }
  }
  if (sort.column === 'entryId') return { sort: 'entryId', entryId: row.entry_id }
  if (sort.column === 'kind') {
    return {
      sort: 'kind',
      direction: sort.direction,
      kind: row.kind,
      entryId: row.entry_id,
      snapshotMaxEntryId
    }
  }
  return {
    sort: 'createdAt',
    direction: sort.direction,
    createdAt: row.created_at,
    entryId: row.entry_id,
    snapshotMaxEntryId
  }
}

function cursorMatchesRow(cursor: TapeInspectorEntryCursor, row: DeepChatTapeEntryRow): boolean {
  if (cursor.entryId !== row.entry_id) return false
  if (cursor.sort === 'entryId') return true
  if (cursor.sort === 'name') return cursor.nameHash === hashName(row.name)
  if (cursor.sort === 'kind') return cursor.kind === row.kind
  return cursor.createdAt === row.created_at
}

function canonicalTapeIncarnationId(
  table: ReturnType<TraceInspectorProviders['getEntryStore']>,
  sessionId: string
): string | null {
  const firstEntry = table.getFirstEntriesBySessions([sessionId])[0]
  return firstEntry ? readCanonicalTapeIncarnationId(firstEntry) : null
}

function withoutDetailData(detail: TapeInspectorRecordDetail): TapeInspectorRecordDetail {
  return {
    record: detail.record,
    disclosure: detail.disclosure,
    provenance: detail.provenance,
    hashes: detail.hashes,
    sizes: detail.sizes
  }
}

export class TapeTraceInspectorService {
  constructor(private readonly providers: TraceInspectorProviders) {}

  getHead(sessionId: string): TapeInspectorHead | null {
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = canonicalTapeIncarnationId(table, sessionId)
      if (!tapeIncarnationId) return null
      return {
        tapeIncarnationId,
        maxEntryId: table.getMaxEntryId(sessionId)
      }
    })
  }

  listPage(input: ListTapeInspectorPageInput): ListTapeInspectorPageOutput {
    if ((input.mode === 'tail') === Boolean(input.cursor)) {
      throw new Error('Tail pages must omit a cursor; older and newer pages require one.')
    }
    const sort = input.sort ?? CANONICAL_SORT
    if (input.cursor && input.cursor.sort !== sort.column) {
      throw new Error('Tape Inspector cursor does not match the requested sort.')
    }
    if (
      input.cursor &&
      input.cursor.sort !== 'entryId' &&
      input.cursor.direction !== sort.direction
    ) {
      throw new Error('Tape Inspector cursor does not match the requested sort direction.')
    }
    if (sort.column !== 'entryId' && input.mode === 'newer') {
      throw new Error('Live newer pages require canonical entryId ordering.')
    }
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = canonicalTapeIncarnationId(table, input.sessionId)
      if (!tapeIncarnationId) {
        throw new Error('Session Tape bootstrap is missing or invalid.')
      }
      const currentMaxEntryId = table.getMaxEntryId(input.sessionId)
      if (
        input.expectedTapeIncarnationId !== undefined &&
        input.expectedTapeIncarnationId !== tapeIncarnationId
      ) {
        return { status: 'reset', tapeIncarnationId, snapshotMaxEntryId: currentMaxEntryId }
      }
      const snapshotMaxEntryId =
        input.cursor && input.cursor.sort !== 'entryId'
          ? input.cursor.snapshotMaxEntryId
          : currentMaxEntryId
      let cursorRow: DeepChatTapeEntryRow | undefined
      if (input.cursor) {
        cursorRow = table.getByEntryId(input.sessionId, input.cursor.entryId)
        if (
          input.cursor.entryId > snapshotMaxEntryId ||
          snapshotMaxEntryId > currentMaxEntryId ||
          !cursorRow ||
          !cursorMatchesRow(input.cursor, cursorRow)
        ) {
          throw new Error('Tape Inspector cursor does not identify its durable snapshot row.')
        }
      }

      const limit = normalizedLimit(input.limit)
      const records: TapeInspectorFactRecord[] = []
      let scanCursor = input.cursor
        ? storageCursorForRow(cursorRow!, sort, snapshotMaxEntryId)
        : undefined
      let lastScannedCursor: TapeInspectorEntryCursor | undefined
      let rowsRemaining = input.filters ? MAX_FILTER_SCAN_ROWS : limit
      let hasContinuation = false
      let done = false

      while (!done && rowsRemaining > 0) {
        const page = table.listInspectorRows({
          sessionId: input.sessionId,
          mode: input.mode,
          cursor: scanCursor,
          sort,
          snapshotMaxEntryId,
          limit: Math.min(STORAGE_SCAN_CHUNK, rowsRemaining)
        })
        if (page.rows.length === 0) break

        for (let index = 0; index < page.rows.length; index += 1) {
          const row = page.rows[index]
          lastScannedCursor = cursorForRow(row, sort, snapshotMaxEntryId)
          rowsRemaining -= 1
          const record = projectTapeInspectorFact(row)
          if (matchesTapeInspectorFilters(record, input.filters)) records.push(record)
          if (records.length >= limit) {
            hasContinuation = index < page.rows.length - 1 || page.hasMore
            done = true
            break
          }
          if (rowsRemaining === 0) {
            hasContinuation = index < page.rows.length - 1 || page.hasMore
            done = true
            break
          }
        }

        if (done || !page.hasMore) break
        scanCursor = storageCursorForRow(page.rows.at(-1)!, sort, snapshotMaxEntryId)
        hasContinuation = true
      }

      this.attachEvidenceCounts(input.sessionId, records)
      if (sort.column === 'entryId' && input.mode !== 'newer') {
        records.sort((left, right) => left.entryId - right.entryId)
      }
      return {
        status: 'ok',
        tapeIncarnationId,
        snapshotMaxEntryId,
        records,
        nextCursor: hasContinuation && lastScannedCursor !== undefined ? lastScannedCursor : null
      }
    })
  }

  getDetail(input: GetTapeInspectorRecordDetailInput): GetTapeInspectorRecordDetailOutput {
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = canonicalTapeIncarnationId(table, input.sessionId)
      if (!tapeIncarnationId) {
        throw new Error('Session Tape bootstrap is missing or invalid.')
      }
      if (tapeIncarnationId !== input.expectedTapeIncarnationId) {
        return { status: 'reset', tapeIncarnationId }
      }
      const row = table.getByEntryId(input.sessionId, input.entryId)
      if (!row) return { status: 'not_found', tapeIncarnationId }
      return {
        status: 'ok',
        tapeIncarnationId,
        detail: projectTapeInspectorDetail(row)
      }
    })
  }

  resolveEvidenceEntries(
    input: ResolveTapeInspectorEvidenceEntriesInput
  ): ResolveTapeInspectorEvidenceEntriesOutput {
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = canonicalTapeIncarnationId(table, input.sessionId)
      if (!tapeIncarnationId) {
        throw new Error('Session Tape bootstrap is missing or invalid.')
      }
      if (tapeIncarnationId !== input.expectedTapeIncarnationId) {
        return { status: 'reset', tapeIncarnationId }
      }

      const identities = [
        ...new Map(
          input.identities.map((identity) => [evidenceIdentityKey(identity), identity])
        ).values()
      ]
      const provenanceKeys = identities.map((identity) =>
        buildTapeProviderAttemptProvenanceKey({ sessionId: input.sessionId, ...identity })
      )
      const rowsByProvenance = new Map(
        table
          .getEntryRefsByProvenanceKeys(input.sessionId, provenanceKeys)
          .map((row) => [row.provenanceKey, row.entryId] as const)
      )

      return {
        status: 'ok',
        tapeIncarnationId,
        resolutions: identities.map((identity, index) => {
          return {
            ...identity,
            entryId: rowsByProvenance.get(provenanceKeys[index]) ?? null
          }
        })
      }
    })
  }

  exportSupportFacts(
    input: ExportTapeInspectorSupportFactsInput
  ): ExportTapeInspectorSupportFactsOutput {
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = canonicalTapeIncarnationId(table, input.sessionId)
      if (!tapeIncarnationId) {
        throw new Error('Session Tape bootstrap is missing or invalid.')
      }
      const snapshotMaxEntryId = table.getMaxEntryId(input.sessionId)
      if (tapeIncarnationId !== input.expectedTapeIncarnationId) {
        return { status: 'reset', tapeIncarnationId, snapshotMaxEntryId }
      }
      const page = table.listInspectorRows({
        sessionId: input.sessionId,
        mode: 'tail',
        sort: CANONICAL_SORT,
        snapshotMaxEntryId,
        limit: TAPE_INSPECTOR_SUPPORT_FACT_LIMIT
      })
      const facts: TapeInspectorRecordDetail[] = []
      let remainingDetailDataBytes = TAPE_INSPECTOR_SUPPORT_DETAIL_DATA_BYTES
      let detailDataTruncated = false
      for (let index = 0; index < page.rows.length; index += 1) {
        const detail = projectTapeInspectorDetail(page.rows[index])
        if (detail.data !== undefined) {
          const bytes = Buffer.byteLength(JSON.stringify(detail.data), 'utf8')
          if (bytes <= remainingDetailDataBytes) {
            remainingDetailDataBytes -= bytes
          } else {
            facts.push(withoutDetailData(detail))
            detailDataTruncated = true
            continue
          }
        }
        facts.push(detail)
      }
      facts.reverse()
      this.attachEvidenceCounts(
        input.sessionId,
        facts.map((detail) => detail.record)
      )
      return {
        status: 'ok',
        tapeIncarnationId,
        snapshotMaxEntryId,
        facts,
        factsTruncated: page.hasMore,
        detailDataTruncated
      }
    })
  }

  private attachEvidenceCounts(sessionId: string, records: TapeInspectorFactRecord[]): void {
    const bindings = records.flatMap((record) => {
      const binding = getTapeInspectorTraceBinding(record)
      return binding ? [binding] : []
    })
    if (bindings.length === 0) return
    const counts = new Map(
      this.providers
        .getMessageTraceReader()
        .countInspectorBindings(sessionId, bindings)
        .map((binding) => [bindingKey(binding), binding.count])
    )
    for (const record of records) {
      const binding = getTapeInspectorTraceBinding(record)
      if (!binding) continue
      const count = counts.get(bindingKey(binding)) ?? 0
      if (count > 0) record.traceEvidenceCount = count
    }
  }
}
