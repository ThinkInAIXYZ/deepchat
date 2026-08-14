import type {
  GetTapeInspectorRecordDetailOutput,
  ListTapeInspectorPageInput,
  ListTapeInspectorPageOutput,
  TapeInspectorFactRecord
} from '@shared/types/tape-inspector'
import type { TapeApplicationProviders, TapeInspectorTraceBinding } from '../ports/application'
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

function normalizedLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_PAGE_LIMIT), 1), MAX_PAGE_LIMIT)
}

export class TapeTraceInspectorService {
  constructor(private readonly providers: TraceInspectorProviders) {}

  listPage(input: ListTapeInspectorPageInput): ListTapeInspectorPageOutput {
    if ((input.mode === 'tail') === Boolean(input.cursor)) {
      throw new Error('Tail pages must omit a cursor; older and newer pages require one.')
    }
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = table.getBootstrapIncarnation(input.sessionId)
      if (!tapeIncarnationId) {
        throw new Error('Session Tape bootstrap is missing or invalid.')
      }
      const snapshotMaxEntryId = table.getMaxEntryId(input.sessionId)
      if (
        input.expectedTapeIncarnationId !== undefined &&
        input.expectedTapeIncarnationId !== tapeIncarnationId
      ) {
        return { status: 'reset', tapeIncarnationId, snapshotMaxEntryId }
      }

      const limit = normalizedLimit(input.limit)
      const records: TapeInspectorFactRecord[] = []
      let cursorEntryId = input.cursor?.entryId
      let lastScannedEntryId: number | undefined
      let rowsRemaining = input.filters ? MAX_FILTER_SCAN_ROWS : limit
      let hasContinuation = false
      let done = false

      while (!done && rowsRemaining > 0) {
        const page = table.listInspectorRows({
          sessionId: input.sessionId,
          mode: input.mode,
          cursorEntryId,
          snapshotMaxEntryId,
          limit: Math.min(STORAGE_SCAN_CHUNK, rowsRemaining)
        })
        if (page.rows.length === 0) break

        for (let index = 0; index < page.rows.length; index += 1) {
          const row = page.rows[index]
          lastScannedEntryId = row.entry_id
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
        cursorEntryId = lastScannedEntryId
        hasContinuation = true
      }

      this.attachEvidenceCounts(input.sessionId, records)
      if (input.mode !== 'newer') records.sort((left, right) => left.entryId - right.entryId)
      return {
        status: 'ok',
        tapeIncarnationId,
        snapshotMaxEntryId,
        records,
        nextCursor:
          hasContinuation && lastScannedEntryId !== undefined
            ? { sort: 'entryId', entryId: lastScannedEntryId }
            : null
      }
    })
  }

  getDetail(input: {
    sessionId: string
    expectedTapeIncarnationId: string
    entryId: number
  }): GetTapeInspectorRecordDetailOutput {
    const table = this.providers.getEntryStore()
    return table.runInTransaction(() => {
      const tapeIncarnationId = table.getBootstrapIncarnation(input.sessionId)
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
