import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { JsonValue } from '@shared/contracts/json'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimHistoryChange, DimScopeChange } from '@/session/data/tables/dimScopeChanges'
import { DimContent } from './content'
import { DimLegacyMigration } from './legacyMigration'
import type { DimHistorySnapshot } from './historyImport'
import { DimProjectionStore } from './projectionStore'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import { DimSessionControls } from './sessionControls'
import type { DimSessionRuntime } from './sessionRuntime'
import { DimMethodError } from './pluginClient'

export interface DimScopeCreation {
  cwd: string
  agent?: string
  tools?: string[]
  policy?: JsonValue
}
interface TransitionOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  runtime: DimSessionRuntime
  installed(binding: DimSessionBinding, messages: ChatMessageRecord[]): void
}

/** Product lifecycle only: dim imports context, owns content and executes all subsequent turns. */
export class DimScopeTransitions {
  private readonly lanes = new Map<string, Promise<unknown>>()
  private readonly content: DimContent
  private readonly controls: DimSessionControls
  private readonly migration: DimLegacyMigration
  private readonly projection: DimProjectionStore

  constructor(private readonly options: TransitionOptions) {
    this.content = new DimContent(options.host)
    this.controls = new DimSessionControls(options.host)
    this.projection = new DimProjectionStore(options.database)
    this.migration = new DimLegacyMigration({
      database: options.database,
      host: options.host,
      snapshot: (binding) => this.snapshot(binding),
      isCurrentScope: (binding) => this.isStagingScope(binding)
    })
  }

  recover(sessionId: string): Promise<DimSessionBinding | null> {
    return this.run(sessionId, async () => {
      const pending = this.options.database.dimScopeChangesTable.get(sessionId)
      return pending
        ? this.complete(pending)
        : this.options.database.dimSessionBindingsTable.get(sessionId)
    })
  }

  replace(
    sessionId: string,
    creation: DimScopeCreation,
    change: DimHistoryChange
  ): Promise<DimSessionBinding> {
    return this.run(sessionId, async () => {
      const table = this.options.database.dimScopeChangesTable
      const pending = table.get(sessionId)
      if (pending) {
        const recovered = await this.complete(pending)
        if (
          JSON.stringify(pending.change) === JSON.stringify(change) &&
          JSON.stringify(pending.creation) === JSON.stringify(creation)
        )
          return recovered
      }
      const source = this.binding(sessionId)
      await this.validate(source, creation, change)
      const record: DimScopeChange = {
        sessionId,
        operationId: randomUUID(),
        source,
        creation: creation as unknown as JsonValue,
        change,
        through: null,
        targetSessionId: null
      }
      table.begin(record)
      return this.complete(record)
    })
  }

  ensureCreation(sessionId: string, creation: DimScopeCreation): Promise<DimSessionBinding> {
    return this.run(sessionId, async () => {
      const table = this.options.database.dimScopeChangesTable
      const pending = table.get(sessionId)
      if (pending) await this.complete(pending)
      const source = this.binding(sessionId)
      const identity = await this.controls.call<{ cwd: string; tools: string[] | null }>(
        'native_identity',
        { sessionId: source.dimSessionId, branchId: source.branchId }
      )
      const tools = (value: string[] | null | undefined) =>
        value ? JSON.stringify([...new Set(value)].sort()) : 'null'
      if (
        (await realpath(creation.cwd)) === identity.cwd &&
        tools(creation.tools) === tools(identity.tools)
      )
        return source
      const record: DimScopeChange = {
        sessionId,
        operationId: randomUUID(),
        source,
        creation: creation as unknown as JsonValue,
        change: { kind: 'retain' },
        through: null,
        targetSessionId: null
      }
      table.begin(record)
      return this.complete(record)
    })
  }

  private async complete(record: DimScopeChange): Promise<DimSessionBinding> {
    const { database, runtime } = this.options
    const table = database.dimScopeChangesTable
    const active = this.binding(record.sessionId)
    if (
      active.dimSessionId === record.targetSessionId &&
      active.generation === record.source.generation + 1
    ) {
      table.finish(record)
      return active
    }
    if (
      active.dimSessionId !== record.source.dimSessionId ||
      active.branchId !== record.source.branchId ||
      active.generation !== record.source.generation
    )
      throw new Error('Native transition belongs to another generation')

    if (!record.targetSessionId) {
      // The queue guard and retirement fact share the same native admission lane. A late accepted
      // input therefore blocks this change, rather than being lost between the two generations.
      try {
        await runtime.retire(record.sessionId, record.operationId, true)
      } catch (error) {
        if (
          error instanceof DimMethodError &&
          error.data &&
          typeof error.data === 'object' &&
          !Array.isArray(error.data) &&
          error.data.appError === 'input_blocked'
        )
          table.finish(record)
        throw error
      }
      const client = await this.options.host.start()
      await client.call('deepchat.host.stop', {
        sessionId: record.source.dimSessionId,
        branchId: record.source.branchId
      })
      const creation = record.creation
      if (!creation || typeof creation !== 'object' || Array.isArray(creation))
        throw new Error('Invalid native transition creation intent')
      const target = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        ...creation,
        modelFromSession: record.source.dimSessionId
      })
      // No input or imported content may be sent to a target until it has a durable owner.
      table.target(record, target.sessionId)
      record.targetSessionId = target.sessionId
    }

    // Close the execution instance before freezing its history. The storage plugin reads its
    // content afterwards without restoring an agent, including on process-restart recovery.
    await runtime.close(record.sessionId)
    await this.controls.call('close', {
      sessionId: record.source.dimSessionId,
      branchId: record.source.branchId
    })
    if (record.through === null) {
      const frozen = await this.content.transcript(
        { sessionId: record.source.dimSessionId, branchId: record.source.branchId },
        record.sessionId
      )
      table.freeze(record, frozen.through)
      record.through = frozen.through
    }

    const staging: DimSessionBinding = {
      ...active,
      dimSessionId: record.targetSessionId,
      branchId: 'main',
      generation: record.source.generation + 1,
      cursor: '0',
      nextOrderSeq: 1,
      activeTurnId: null,
      assistantMessageId: null,
      status: 'idle'
    }
    await this.migration.prepare(staging)
    const view = await this.content.transcript(
      { sessionId: staging.dimSessionId, branchId: staging.branchId },
      record.sessionId
    )
    const installed: DimSessionBinding = {
      ...staging,
      cursor: view.through,
      nextOrderSeq: view.messages.reduce((last, message) => Math.max(last, message.orderSeq), 0) + 1
    }
    this.projection.installGeneration(active, installed, view.messages)
    // The native import is sealed before this atomic read-model/binding switch. If this callback
    // fails or the process exits, recovery sees the installed target and never imports twice.
    this.options.installed(installed, view.messages)
    table.finish(record)
    return installed
  }

  private isStagingScope(binding: DimSessionBinding): boolean {
    const record = this.options.database.dimScopeChangesTable.get(binding.sessionId)
    const active = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
    return !!(
      record &&
      active &&
      record.targetSessionId === binding.dimSessionId &&
      binding.branchId === 'main' &&
      binding.generation === record.source.generation + 1 &&
      active.dimSessionId === record.source.dimSessionId &&
      active.branchId === record.source.branchId &&
      active.generation === record.source.generation
    )
  }

  private async snapshot(binding: DimSessionBinding): Promise<DimHistorySnapshot> {
    const record = this.options.database.dimScopeChangesTable.get(binding.sessionId)
    if (!record?.through || !this.isStagingScope(binding))
      throw new Error('Native transition has no frozen source')
    const source = await this.content.transcript(
      { sessionId: record.source.dimSessionId, branchId: record.source.branchId },
      binding.sessionId,
      record.through
    )
    let messages = source.messages
    const change = record.change
    if (change.kind === 'clear') messages = []
    else if (change.kind === 'truncate')
      messages = messages.filter((message) => message.orderSeq < change.fromOrderSeq)
    else if (change.kind === 'edit') {
      const target = messages.find((message) => message.id === change.messageId)
      if (!target || target.role !== 'user' || target.content !== change.expectedContent)
        throw new Error('Message changed before the native edit was frozen')
      messages = messages.map((message) =>
        message.id === target.id ? { ...message, content: change.content } : message
      )
    }
    const retained = new Set(messages.map((message) => message.id))
    return {
      formatVersion: 1,
      productSessionId: binding.sessionId,
      messages,
      summary: change.kind === 'retain' ? source.summary : null,
      contextFromOrderSeq: change.kind === 'retain' ? source.contextFromOrderSeq : 1,
      pendingInputs: change.kind === 'clear' ? [] : source.pendingInputs,
      images: Object.fromEntries(Object.entries(source.images).filter(([id]) => retained.has(id))),
      source: {
        kind: 'native-transition',
        operationId: record.operationId,
        sessionId: record.source.dimSessionId,
        branchId: record.source.branchId,
        through: record.through
      }
    }
  }

  private binding(sessionId: string): DimSessionBinding {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) throw new Error('Native session is not initialized')
    return binding
  }
  private async validate(
    binding: DimSessionBinding,
    creation: DimScopeCreation,
    change: DimHistoryChange
  ): Promise<void> {
    await realpath(creation.cwd)
    if (creation.tools?.some((tool) => !tool.trim()))
      throw new Error('Native tool names cannot be empty')
    if (
      change.kind === 'truncate' &&
      (!Number.isSafeInteger(change.fromOrderSeq) || change.fromOrderSeq < 1)
    )
      throw new Error('Invalid native transcript truncation')
    if (change.kind !== 'edit') return
    const view = await this.content.transcript(
      { sessionId: binding.dimSessionId, branchId: binding.branchId },
      binding.sessionId
    )
    const target = view.messages.find((message) => message.id === change.messageId)
    if (!target || target.role !== 'user' || target.content !== change.expectedContent)
      throw new Error('Message changed before the native edit was requested')
  }
  private run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.lanes.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.lanes.set(sessionId, task)
    void task
      .finally(() => {
        if (this.lanes.get(sessionId) === task) this.lanes.delete(sessionId)
      })
      .catch(() => {})
    return task
  }
}
