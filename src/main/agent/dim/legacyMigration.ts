import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import {
  dimHistoryHash,
  dimHistoryPlan,
  normalizeDimImportedMessage,
  type DimHistorySnapshot
} from './historyImport'

interface MigrationOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  // The effective legacy view, or the view selected by an explicit edit/retry/fork.
  snapshot(binding: DimSessionBinding): Promise<DimHistorySnapshot>
}
interface Status {
  sealed: boolean
  uploaded?: number[]
  sequence?: number | string
  eventId?: string
}
export class DimMigrationSourceChangedError extends Error {
  constructor() {
    super(
      'The legacy source changed during import; preserve this native generation and retry in a fresh one'
    )
  }
}

/** Runs only at a continuation/mutation boundary, never during legacy browsing or startup. */
export class DimLegacyMigration {
  private readonly lanes = new Map<string, Promise<void>>()
  constructor(private readonly options: MigrationOptions) {}

  prepare(binding: DimSessionBinding): Promise<void> {
    const key = `${binding.dimSessionId}:${binding.branchId}`
    const existing = this.lanes.get(key)
    if (existing) return existing
    const task = this.import(binding)
    this.lanes.set(key, task)
    void task
      .finally(() => {
        if (this.lanes.get(key) === task) this.lanes.delete(key)
      })
      .catch(() => {})
    return task
  }
  private async import(binding: DimSessionBinding): Promise<void> {
    const table = this.options.database.dimSessionImportsTable
    let record = table.get(binding)
    if (record?.sealed) return
    const client = await this.options.host.start()
    const current = () => {
      const active = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
      if (
        !active ||
        active.dimSessionId !== binding.dimSessionId ||
        active.branchId !== binding.branchId ||
        active.generation !== binding.generation
      )
        throw new Error('History conversion belongs to a replaced session scope')
    }
    current()
    const ref = { sessionId: binding.dimSessionId, branchId: binding.branchId }
    let status: Status | undefined
    if (record) {
      status = await client.call<Status>('session.deepchat_migration.status', {
        ...ref,
        migrationId: record.migrationId
      })
      current()
      if (status.sealed) {
        if (status.sequence == null)
          throw new Error('Native import receipt is missing its Timeline position')
        table.seal(record, String(status.sequence))
        return
      }
      if (status.uploaded?.length === record.chunks) {
        const committed = await client.call<Status>(
          'session.deepchat_migration.commit',
          { ...ref, migrationId: record.migrationId },
          30 * 60 * 1000
        )
        current()
        if (!committed.sealed || committed.sequence == null)
          throw new Error('Native history conversion did not seal')
        table.seal(record, String(committed.sequence))
        return
      }
    }
    const snapshot = await this.options.snapshot(binding)
    if (
      snapshot.productSessionId !== binding.sessionId ||
      snapshot.messages.some((message) => message.sessionId !== binding.sessionId)
    )
      throw new Error('Legacy history belongs to another product session')
    snapshot.messages = snapshot.messages.map(normalizeDimImportedMessage)
    const plan = dimHistoryPlan(snapshot)
    current()
    if (record && (record.digest !== plan.digest || record.chunks !== plan.chunks.length))
      throw new DimMigrationSourceChangedError()
    record = table.begin(binding, plan)
    status = await client.call<Status>('session.deepchat_migration.begin', {
      ...ref,
      migrationId: record.migrationId,
      manifest: {
        migrationId: record.migrationId,
        productSessionId: binding.sessionId,
        digest: record.digest,
        chunks: record.chunks
      }
    })
    if (!status.sealed) {
      const uploaded = new Set(status.uploaded ?? [])
      for (const [index, payload] of plan.chunks.entries()) {
        current()
        if (uploaded.has(index)) continue
        await client.call('session.deepchat_migration.chunk', {
          ...ref,
          migrationId: record.migrationId,
          index,
          payload,
          checksum: dimHistoryHash(payload)
        })
      }
      current()
      status = await client.call<Status>(
        'session.deepchat_migration.commit',
        { ...ref, migrationId: record.migrationId },
        30 * 60 * 1000
      )
    }
    current()
    if (!status.sealed || status.sequence == null)
      throw new Error('Native history conversion did not seal')
    table.seal(record, String(status.sequence))
  }
}

export function dimLegacySnapshot(
  sessionId: string,
  messages: ChatMessageRecord[],
  summary: string | null
): DimHistorySnapshot {
  return {
    formatVersion: 1,
    productSessionId: sessionId,
    messages,
    summary,
    source: { kind: 'legacy' }
  }
}
