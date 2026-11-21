import { createHash, randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { PendingSessionInputRecord, SendMessageInput } from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimSessionRuntime } from './sessionRuntime'
import type { DimPreparedInput } from './backend'
import { DimContent } from './content'

export interface DimLegacyDrafts {
  revision: string | null
  inputs: PendingSessionInputRecord[]
}
interface Options {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  runtime: DimSessionRuntime
  prepareNative(sessionId: string): Promise<void>
  prepareInput(
    sessionId: string,
    content: SendMessageInput,
    signal?: AbortSignal
  ): Promise<DimPreparedInput>
  legacyPendingInputs?(sessionId: string): PendingSessionInputRecord[]
}

const prefix = 'legacy-queue:'
export const isDimLegacyDraft = (id: string): boolean => id.startsWith(prefix)

/** Explicit conversion/admission of old unsubmitted drafts; this class never waits for or drives turns. */
export class DimLegacyQueue {
  constructor(private readonly options: Options) {}

  project(state: DimLegacyDrafts, offset = 0): PendingSessionInputRecord[] {
    return state.inputs.map((item, index) => ({
      ...item,
      id: prefix + item.id,
      queueOrder: offset + index
    }))
  }
  passive(sessionId: string): PendingSessionInputRecord[] {
    return this.project({
      revision: null,
      inputs: this.options.legacyPendingInputs?.(sessionId) ?? []
    })
  }
  async read(sessionId: string) {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) throw new Error('Native draft history is not initialized')
    const client = await this.options.host.start()
    const result = await client.call<{ drafts: DimLegacyDrafts }>('session.deepchat_queue.list', {
      sessionId: binding.dimSessionId,
      branchId: binding.branchId
    })
    this.current(binding)
    return { binding, client, drafts: result.drafts ?? { revision: null, inputs: [] } }
  }

  async mutate(
    sessionId: string,
    id: string,
    action: string,
    extra: { [key: string]: JsonValue } = {}
  ) {
    await this.options.runtime.open(sessionId)
    const state = await this.read(sessionId)
    const draft = state.drafts.inputs.find((item) => prefix + item.id === id)
    if (!draft || !state.drafts.revision) throw new Error('Legacy draft changed; refresh the queue')
    return state.client.call<DimLegacyDrafts>('session.deepchat_queue.legacy', {
      sessionId: state.binding.dimSessionId,
      branchId: state.binding.branchId,
      operationId: randomUUID(),
      draft: { id: draft.id, revision: state.drafts.revision },
      action,
      ...extra
    })
  }

  async available(sessionId: string): Promise<boolean> {
    if (!this.options.database.dimSessionBindingsTable.get(sessionId))
      return this.passive(sessionId).length > 0
    return (await this.read(sessionId)).drafts.inputs.length > 0
  }
  async resume(sessionId: string): Promise<boolean> {
    await this.options.prepareNative(sessionId)
    const { drafts } = await this.read(sessionId)
    let admitted = false
    // One user command prepares a batch. Native Branch.input queues each accepted item and
    // InputQueue schedules all turns, including when the desktop connection disappears.
    for (const item of drafts.inputs) {
      if (item.state === 'retry_required' || item.state === 'claimed') continue
      const result = await this.admit(sessionId, prefix + item.id)
      admitted ||= result.accepted
      if (!result.accepted) break
    }
    return admitted
  }
  async admit(
    sessionId: string,
    id: string,
    mode?: 'queue' | 'steer'
  ): Promise<{ accepted: boolean; started: boolean; inputId?: string }> {
    await this.options.prepareNative(sessionId)
    const state = await this.read(sessionId)
    const item = state.drafts.inputs.find((item) => prefix + item.id === id)
    if (!item || !state.drafts.revision) return { accepted: false, started: false }
    const prepared = await this.options.prepareInput(sessionId, item.payload)
    this.current(state.binding)
    if (prepared.summary.status === 'needs_user_action') {
      await this.mutate(sessionId, id, 'block', {
        blocking: prepared.summary as unknown as JsonValue
      })
      return { accepted: false, started: false }
    }
    const revision = state.drafts.revision
    const submissionId = `legacy-queue:${createHash('sha256')
      .update(
        JSON.stringify([state.binding.dimSessionId, state.binding.branchId, item.id, revision])
      )
      .digest('hex')}`
    const original = item.messageIds.length
      ? (
          await new DimContent(this.options.host).transcript(
            { sessionId: state.binding.dimSessionId, branchId: state.binding.branchId },
            sessionId
          )
        ).messages.find(
          (message) => message.role === 'user' && item.messageIds.includes(message.id)
        )
      : undefined
    this.current(state.binding)
    // The canonical draft and Branch.lookup are the durable intent. A lost receipt is
    // resolved by the native list/lookup before a repeated admission can run any input twice.
    const receipt = await state.client.call<{ inputId: string }>('session.deepchat_inputs.submit', {
      sessionId: state.binding.dimSessionId,
      branchId: state.binding.branchId,
      input: {
        submission_id: submissionId,
        mode: mode ?? item.mode,
        user: { content: prepared.content },
        blocks: []
      },
      representation: prepared.representation,
      legacyDraft: { id: item.id, revision },
      ...(original
        ? {
            reuseUserMessage: {
              messageId: original.id,
              orderSeq: original.orderSeq,
              createdAt: original.createdAt
            }
          }
        : {})
    })
    return { accepted: true, started: true, inputId: receipt.inputId }
  }

  private current(binding: {
    sessionId: string
    dimSessionId: string
    branchId: string
    generation: number
  }) {
    const active = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
    if (
      active?.dimSessionId !== binding.dimSessionId ||
      active.branchId !== binding.branchId ||
      active.generation !== binding.generation
    )
      throw new Error('Native draft scope changed during preparation')
  }
}
