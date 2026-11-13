import { Buffer } from 'node:buffer'
import type { JsonValue } from '@shared/contracts/json'
import type {
  ExportTapeInspectorSupportFactsInput,
  ExportTapeInspectorSupportFactsOutput,
  GetTapeInspectorRecordDetailInput,
  GetTapeInspectorRecordDetailOutput,
  ListTapeInspectorPageInput,
  ListTapeInspectorPageOutput,
  TapeInspectorEntryCursor,
  TapeInspectorFactRecord,
  TapeInspectorHead,
  TapeInspectorRecordDetail,
  TapeInspectorSort,
  ResolveTapeInspectorEvidenceEntriesInput,
  ResolveTapeInspectorEvidenceEntriesOutput
} from '@shared/types/tape-inspector'
import {
  TAPE_INSPECTOR_SUPPORT_DETAIL_DATA_BYTES,
  TAPE_INSPECTOR_SUPPORT_FACT_LIMIT
} from '@shared/types/tape-inspector'
import type { SessionDatabase } from '@/session/data/database'
import type { DimInspectorHead } from '@/session/data/tables/dimTimelineInspector'
import { matchesTapeInspectorFilters } from '@/tape/application/traceInspectorProjection'
import { hashString } from '@/tape/domain/replay'
import { redactBody } from '@/lib/redact'
import type { DimContent } from './content'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import { dimSequence, type DimEvent } from './sessionConnection'
import { indexDimInspectorEvent } from './timelineInspectorProjection'

const canonical: TapeInspectorSort = { column: 'entryId', direction: 'asc' }
const cursorFor = (
  record: TapeInspectorFactRecord,
  sort: TapeInspectorSort,
  snapshot: number
): TapeInspectorEntryCursor =>
  sort.column === 'entryId'
    ? { sort: 'entryId', entryId: record.entryId }
    : sort.column === 'name'
      ? {
          sort: 'name',
          direction: sort.direction,
          entryId: record.entryId,
          snapshotMaxEntryId: snapshot,
          nameHash: hashString(record.name ?? '')
        }
      : sort.column === 'kind'
        ? {
            sort: 'kind',
            direction: sort.direction,
            entryId: record.entryId,
            snapshotMaxEntryId: snapshot,
            kind: record.kind
          }
        : {
            sort: 'createdAt',
            direction: sort.direction,
            entryId: record.entryId,
            snapshotMaxEntryId: snapshot,
            createdAt: record.createdAt
          }

/** Read-only native facts behind the existing inspector UI; the SQL index is disposable metadata. */
export class DimTimelineInspector {
  private readonly lanes = new Map<string, Promise<DimInspectorHead | null>>()
  constructor(
    private readonly options: {
      database: SessionDatabase
      host: DimRuntimeSupervisor
      content: Pick<DimContent, 'latest'>
    }
  ) {}

  owns(sessionId: string): boolean {
    return this.options.database.dimSessionBindingsTable.get(sessionId) !== null
  }
  getHead(sessionId: string): TapeInspectorHead | null {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) return null
    const head = this.options.database.dimTimelineInspectorTable.head(binding)
    return {
      tapeIncarnationId: head.id,
      maxEntryId: this.options.database.dimTimelineInspectorTable.max(head)
    }
  }

  private synchronize(sessionId: string): Promise<DimInspectorHead | null> {
    const previous = this.lanes.get(sessionId) ?? Promise.resolve(null)
    const work = previous
      .catch(() => null)
      .then(async () => {
        const database = this.options.database
        const binding = database.dimSessionBindingsTable.get(sessionId)
        if (!binding) return null
        const current = () => {
          const now = database.dimSessionBindingsTable.get(sessionId)
          return (
            now?.dimSessionId === binding.dimSessionId &&
            now.branchId === binding.branchId &&
            now.generation === binding.generation
          )
        }
        const client = await this.options.host.start()
        if (!current()) return null
        let head = database.dimTimelineInspectorTable.head(binding)
        let through: string | undefined
        for (;;) {
          const page = await client.call<{ through: string | number; events: DimEvent[] }>(
            'deepchat.storage.history',
            {
              sessionId: binding.dimSessionId,
              branchId: binding.branchId,
              after: head.cursor,
              limit: 100,
              ...(through ? { through } : {})
            }
          )
          if (!current()) return null
          const cache = database.dimTimelineInspectorTable.head(binding)
          if (cache.id !== head.id) {
            head = cache
            through = undefined
            continue
          }
          through ??= dimSequence(page.through).toString()
          database.getDatabase().transaction(() => {
            for (const event of page.events) indexDimInspectorEvent(database, binding, event)
          })()
          head = database.dimTimelineInspectorTable.head(binding)
          if (dimSequence(head.cursor) >= dimSequence(through)) return head
          if (!page.events.length) {
            if (dimSequence(through) === 0n) return head
            throw new Error('Native inspector history ended before its fixed cutoff')
          }
        }
      })
    this.lanes.set(sessionId, work)
    void work
      .finally(() => {
        if (this.lanes.get(sessionId) === work) this.lanes.delete(sessionId)
      })
      .catch(() => {})
    return work
  }

  async listPage(input: ListTapeInspectorPageInput): Promise<ListTapeInspectorPageOutput> {
    const head = await this.synchronize(input.sessionId)
    const now = this.getHead(input.sessionId)
    if (!now) throw new Error('Native inspector session is unavailable')
    const reset = {
      status: 'reset' as const,
      tapeIncarnationId: now.tapeIncarnationId,
      snapshotMaxEntryId: now.maxEntryId
    }
    if (
      !head ||
      now.tapeIncarnationId !== head.id ||
      (input.expectedTapeIncarnationId !== undefined && input.expectedTapeIncarnationId !== head.id)
    )
      return reset
    const sort = input.sort ?? canonical
    if ((input.mode === 'tail') === Boolean(input.cursor))
      throw new Error('Inspector page mode does not match its cursor')
    if (
      input.cursor &&
      (input.cursor.sort !== sort.column ||
        (input.cursor.sort !== 'entryId' && input.cursor.direction !== sort.direction))
    )
      throw new Error('Inspector cursor does not match its sort')
    const table = this.options.database.dimTimelineInspectorTable
    const snapshot =
      input.cursor && input.cursor.sort !== 'entryId'
        ? input.cursor.snapshotMaxEntryId
        : now.maxEntryId
    let row = input.cursor ? table.get(head, input.cursor.entryId) : null
    if (
      input.cursor &&
      (!row ||
        row.entryId > snapshot ||
        snapshot > now.maxEntryId ||
        Object.entries(cursorFor(row, sort, snapshot)).some(
          ([key, value]) => value !== (input.cursor as unknown as Record<string, unknown>)[key]
        ))
    )
      throw new Error('Inspector cursor does not identify its snapshot row')
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 100)))
    const records: TapeInspectorFactRecord[] = []
    let remaining = input.filters ? 8_000 : limit
    let last: TapeInspectorFactRecord | undefined
    let more = false
    while (remaining > 0 && records.length < limit) {
      const page = table.scan(head, {
        sort,
        mode: input.mode,
        cursor: row ?? undefined,
        snapshot,
        limit: Math.min(remaining, 200)
      })
      more = page.hasMore
      if (!page.records.length) break
      for (let index = 0; index < page.records.length; index++) {
        last = page.records[index]
        remaining--
        if (matchesTapeInspectorFilters(last, input.filters)) records.push(last)
        if (records.length === limit || remaining === 0) {
          more ||= index < page.records.length - 1
          break
        }
      }
      if (!more) break
      row = last ?? null
    }
    if (sort.column === 'entryId' && input.mode !== 'newer')
      records.sort((a, b) => a.entryId - b.entryId)
    return {
      status: 'ok',
      tapeIncarnationId: head.id,
      snapshotMaxEntryId: snapshot,
      records,
      nextCursor: more && last ? cursorFor(last, sort, snapshot) : null
    }
  }

  async resolveEvidence(
    input: ResolveTapeInspectorEvidenceEntriesInput
  ): Promise<ResolveTapeInspectorEvidenceEntriesOutput> {
    const head = this.getHead(input.sessionId)
    if (!head) throw new Error('Native inspector session is unavailable')
    if (head.tapeIncarnationId !== input.expectedTapeIncarnationId)
      return { status: 'reset', tapeIncarnationId: head.tapeIncarnationId }
    // Old product HTTP traces remain a separate evidence lane. Native requests use native identities.
    return {
      status: 'ok',
      tapeIncarnationId: head.tapeIncarnationId,
      resolutions: input.identities.map((identity) => ({ ...identity, entryId: null }))
    }
  }

  private async detail(
    head: DimInspectorHead,
    record: TapeInspectorFactRecord
  ): Promise<TapeInspectorRecordDetail> {
    const pointer = record.dim
    if (
      !pointer ||
      pointer.sessionId !== head.nativeSessionId ||
      pointer.branchId !== head.branchId ||
      dimSequence(pointer.sequence) > dimSequence(head.cursor)
    )
      throw new Error('Inspector detail has a different native owner')
    const result = await this.options.content.latest(
      { sessionId: head.nativeSessionId, branchId: head.branchId },
      [record.name!],
      {
        op: 'compare',
        left: { kind: 'field', path: 'id' },
        comparison: 'eq',
        right: { kind: 'value', value: pointer.eventId }
      },
      head.cursor
    )
    if (
      !result.event ||
      result.event.id !== pointer.eventId ||
      dimSequence(result.event.sequence) !== dimSequence(pointer.sequence)
    )
      throw new Error('Native inspector fact is absent from its source')
    const payload = JSON.stringify(result.event.data)
    const metadata = JSON.stringify(pointer)
    const data = bounded(redactBody(result.event.data))
    return {
      record,
      disclosure: 'structured',
      provenance: {
        sourceType: 'runtime_event',
        sourceId: pointer.eventId,
        provenanceKey: JSON.stringify(pointer)
      },
      hashes: { payloadHash: hashString(payload), metaHash: hashString(metadata) },
      sizes: { payloadBytes: Buffer.byteLength(payload), metaBytes: Buffer.byteLength(metadata) },
      data
    }
  }

  async getDetail(
    input: GetTapeInspectorRecordDetailInput
  ): Promise<GetTapeInspectorRecordDetailOutput> {
    const head = await this.synchronize(input.sessionId)
    const now = this.getHead(input.sessionId)
    if (!now) throw new Error('Native inspector session is unavailable')
    if (!head || head.id !== input.expectedTapeIncarnationId || head.id !== now.tapeIncarnationId)
      return { status: 'reset', tapeIncarnationId: now.tapeIncarnationId }
    const record = this.options.database.dimTimelineInspectorTable.get(head, input.entryId)
    if (!record) return { status: 'not_found', tapeIncarnationId: head.id }
    const detail = await this.detail(head, record)
    const after = this.getHead(input.sessionId)
    if (after?.tapeIncarnationId !== head.id)
      return { status: 'reset', tapeIncarnationId: after?.tapeIncarnationId ?? head.id }
    return { status: 'ok', tapeIncarnationId: head.id, detail }
  }

  async exportFacts(
    input: ExportTapeInspectorSupportFactsInput
  ): Promise<ExportTapeInspectorSupportFactsOutput> {
    const page = await this.listPage({
      ...input,
      mode: 'tail',
      limit: TAPE_INSPECTOR_SUPPORT_FACT_LIMIT
    })
    if (page.status === 'reset') return page
    const binding = this.options.database.dimSessionBindingsTable.get(input.sessionId)
    if (!binding) throw new Error('Native inspector session is unavailable')
    const head = this.options.database.dimTimelineInspectorTable.head(binding)
    if (head.id !== page.tapeIncarnationId)
      return {
        status: 'reset',
        tapeIncarnationId: head.id,
        snapshotMaxEntryId: this.options.database.dimTimelineInspectorTable.max(head)
      }
    const facts: TapeInspectorRecordDetail[] = []
    let remaining = TAPE_INSPECTOR_SUPPORT_DETAIL_DATA_BYTES
    let truncated = false
    for (const record of page.records) {
      const detail = await this.detail(head, record)
      const bytes = Buffer.byteLength(JSON.stringify(detail.data))
      if (bytes > remaining) {
        delete detail.data
        detail.disclosure = 'metadata_only'
        truncated = true
      } else remaining -= bytes
      facts.push(detail)
    }
    const after = this.getHead(input.sessionId)
    if (after?.tapeIncarnationId !== head.id)
      return {
        status: 'reset',
        tapeIncarnationId: after?.tapeIncarnationId ?? head.id,
        snapshotMaxEntryId: after?.maxEntryId ?? 0
      }
    return {
      status: 'ok',
      tapeIncarnationId: head.id,
      snapshotMaxEntryId: page.snapshotMaxEntryId,
      facts,
      factsTruncated: page.nextCursor !== null,
      detailDataTruncated: truncated
    }
  }
}

function bounded(value: unknown, depth = 0, budget = { remaining: 256 * 1024 }): JsonValue {
  if (depth > 16 || budget.remaining < 32) return '[truncated]'
  budget.remaining -= 16
  if (typeof value === 'string') {
    const bytes = Buffer.from(value)
    const length = Math.min(bytes.length, 16 * 1024, budget.remaining)
    budget.remaining -= length
    return bytes.length <= length
      ? value
      : bytes.subarray(0, Math.max(0, length - 16)).toString('utf8') + '[truncated]'
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    const result: JsonValue[] = []
    for (const item of value.slice(0, 256)) {
      if (budget.remaining < 32) break
      result.push(bounded(item, depth + 1, budget))
    }
    if (result.length < value.length) result.push('[truncated]')
    return result
  }
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {}
    const entries = Object.entries(value)
    for (const [key, item] of entries.slice(0, 256)) {
      if (budget.remaining < 32) break
      const name = Buffer.from(key)
        .subarray(0, Math.min(1024, budget.remaining - 16))
        .toString('utf8')
      budget.remaining -= Buffer.byteLength(name)
      result[name] = bounded(item, depth + 1, budget)
    }
    if (Object.keys(result).length < entries.length) result['[truncated]'] = true
    return result
  }
  return null
}
