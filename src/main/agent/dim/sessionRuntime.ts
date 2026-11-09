import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimInputIntent } from '@/session/data/tables/dimInputIntents'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import { DimConnectionError, DimMethodError } from './pluginClient'
import { DimSessionConnection, type DimInputReceipt } from './sessionConnection'
import { DimProjectionStore } from './projectionStore'
import type { DimProjection } from './messageProjection'

export interface DimSessionRuntimeOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  launch(sessionId: string): Promise<JsonValue>
  prepare?(binding: DimSessionBinding): Promise<void>
  projected(sessionId: string, projection: DimProjection): void
  failed(sessionId: string, error: unknown): void
}
interface OpenSession {
  scope: object
  reader: DimSessionConnection
  binding: DimSessionBinding
}

export class DimSubmissionUnknownError extends Error {
  constructor(readonly submissionId: string) {
    super('dim submission outcome is unknown; reconcile it before retrying')
  }
}

/** Desktop admission and projection. dim owns the agent, queue and every model/tool step. */
export class DimSessionRuntime {
  private readonly readers = new Map<string, Promise<OpenSession>>()
  private readonly scopes = new Map<string, object>()
  private readonly projection: DimProjectionStore
  constructor(private readonly options: DimSessionRuntimeOptions) {
    this.projection = new DimProjectionStore(options.database)
  }

  async open(sessionId: string): Promise<OpenSession> {
    const existing = this.readers.get(sessionId)
    if (existing) return existing
    const scope = {}
    this.scopes.set(sessionId, scope)
    const opening = this.openReader(sessionId, scope)
    this.readers.set(sessionId, opening)
    try {
      return await opening
    } catch (error) {
      if (this.scopes.get(sessionId) === scope) {
        this.scopes.delete(sessionId)
        this.readers.delete(sessionId)
      }
      throw error
    }
  }

  async submit(
    sessionId: string,
    content: JsonValue[],
    options: {
      mode?: 'queue' | 'steer' | 'append'
      submissionId?: string
      rawBlocks?: JsonValue[]
    } = {}
  ): Promise<DimInputReceipt> {
    const { binding, scope } = await this.open(sessionId)
    const submissionId = options.submissionId ?? randomUUID()
    const payload: JsonValue = {
      sessionId: binding.dimSessionId,
      branchId: binding.branchId,
      submissionId,
      mode: options.mode ?? 'queue',
      rawBlocks: options.rawBlocks ?? [],
      content
    }
    if (this.scopes.get(sessionId) !== scope)
      throw new DimConnectionError('dim session was closed before admission', 'not-sent')
    const stored = this.options.database.dimInputIntentsTable.begin({
      submissionId,
      sessionId,
      dimSessionId: binding.dimSessionId,
      branchId: binding.branchId,
      payload
    })
    if (!stored.created && stored.intent.state !== 'rejected') {
      if (stored.intent.state === 'accepted') return stored.intent.receipt!
      const reconciled = await this.reconcile(stored.intent)
      if (reconciled) return reconciled
      throw new DimSubmissionUnknownError(submissionId)
    }
    try {
      const client = await this.options.host.start()
      if (this.scopes.get(sessionId) !== scope)
        throw new DimConnectionError('dim session was replaced before submission', 'not-sent')
      const receipt = await client.call<DimInputReceipt>('deepchat.host.input', payload)
      this.options.database.dimInputIntentsTable.settle(submissionId, 'accepted', receipt)
      return receipt
    } catch (error) {
      const confirmed = this.options.database.dimInputIntentsTable.get(submissionId)
      if (confirmed?.state === 'accepted' && confirmed.receipt) return confirmed.receipt
      const appError =
        error instanceof DimMethodError &&
        error.data &&
        typeof error.data === 'object' &&
        !Array.isArray(error.data)
          ? error.data.appError
          : null
      const rejected =
        (error instanceof DimConnectionError && error.outcome === 'not-sent') ||
        [
          'invalid_params',
          'rejected',
          'session_closed',
          'branch_missing',
          'branch_ended',
          'agent_unknown'
        ].includes(String(appError))
      this.options.database.dimInputIntentsTable.settle(
        submissionId,
        rejected ? 'rejected' : 'unknown'
      )
      if (!rejected) throw new DimSubmissionUnknownError(submissionId)
      throw error
    }
  }

  async reconcile(intent: DimInputIntent): Promise<DimInputReceipt | null> {
    const client = await this.options.host.start()
    const result = await client.call<{
      status: 'accepted' | 'unknown'
      inputId?: string
      sequence?: number | string
    }>('deepchat.host.lookup', {
      sessionId: intent.dimSessionId,
      branchId: intent.branchId,
      submissionId: intent.submissionId
    })
    if (result.status !== 'accepted' || !result.inputId || result.sequence == null) return null
    const receipt = { inputId: result.inputId, sequence: result.sequence }
    this.options.database.dimInputIntentsTable.settle(intent.submissionId, 'accepted', receipt)
    return receipt
  }

  async waitIdle(sessionId: string): Promise<void> {
    await (await this.open(sessionId)).reader.waitIdle()
  }
  async cancel(sessionId: string): Promise<void> {
    await (await this.open(sessionId)).reader.stopGeneration()
  }
  async close(sessionId: string): Promise<void> {
    const reader = this.readers.get(sessionId)
    this.readers.delete(sessionId)
    this.scopes.delete(sessionId)
    if (reader) await (await reader.catch(() => null))?.reader.close()
  }
  async stop(): Promise<void> {
    for (const id of this.readers.keys()) await this.close(id)
    await this.options.host.stop()
  }

  private async openReader(sessionId: string, scope: object): Promise<OpenSession> {
    const client = await this.options.host.start()
    if (this.scopes.get(sessionId) !== scope) throw new Error('dim session closed before hydration')
    let binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) {
      const config = await this.options.launch(sessionId)
      if (this.scopes.get(sessionId) !== scope)
        throw new Error('dim session closed before native launch')
      const created = await client.call<{ sessionId: string }>('deepchat.host.launch', config)
      // No input is sent until the product-to-native identity is durably recorded.
      if (this.scopes.get(sessionId) !== scope) {
        await client.call('deepchat.host.delete', { sessionId: created.sessionId }).catch(() => {})
        throw new Error('dim session closed during native launch')
      }
      const nextOrder = this.options.database.deepchatMessagesTable.getMaxOrderSeq(sessionId) + 1
      binding = this.options.database.dimSessionBindingsTable.bind(
        sessionId,
        created.sessionId,
        'main',
        nextOrder
      )
    }
    const captured = binding
    await this.options.prepare?.(captured)
    if (this.scopes.get(sessionId) !== scope)
      throw new Error('dim session closed during preparation')
    const reader = new DimSessionConnection(
      client,
      { sessionId: binding.dimSessionId, branchId: binding.branchId },
      (event) => {
        if (this.scopes.get(sessionId) !== scope) throw new Error('dim desktop reader was replaced')
        const projected = this.projection.apply(captured, event)
        this.options.projected(sessionId, projected)
      },
      (error) => {
        if (this.scopes.get(sessionId) !== scope) return
        this.readers.delete(sessionId)
        this.scopes.delete(sessionId)
        this.options.failed(sessionId, error)
      },
      binding.cursor
    )
    try {
      await reader.start()
      if (this.scopes.get(sessionId) !== scope)
        throw new Error('dim desktop session closed during hydration')
      for (const intent of this.options.database.dimInputIntentsTable.pending(sessionId))
        await this.reconcile(intent)
      return { reader, binding: captured, scope }
    } catch (error) {
      await reader.close()
      throw error
    }
  }
}
