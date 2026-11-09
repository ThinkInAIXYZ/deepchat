import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimEvent, DimSessionRef } from './sessionConnection'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { dimProjectionInputKey, projectDimEvent } from './messageProjection'
import { dimSequence } from './sessionConnection'

/** All native content reads cross the injected storage plugin; no desktop SQLite reader. */
export class DimContent {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  /** An isolated read-model replay for conversion/edit/fork. It cannot admit or execute input. */
  async transcript(
    ref: DimSessionRef,
    productSessionId: string,
    through?: string
  ): Promise<{ messages: ChatMessageRecord[]; through: string }> {
    const client = await this.host.start()
    let binding: DimSessionBinding = {
      sessionId: productSessionId,
      dimSessionId: ref.sessionId,
      branchId: ref.branchId,
      generation: 1,
      cursor: '0',
      nextOrderSeq: 1,
      status: 'idle',
      activeTurnId: null,
      assistantMessageId: null
    }
    const messages = new Map<string, ChatMessageRecord>()
    const inputs = new Map<string, DimEvent>()
    let fixed = through
    while (true) {
      const page = await client.call<{ through: number | string; events: DimEvent[] }>(
        'deepchat.storage.history',
        { ...ref, after: binding.cursor, limit: 200, ...(fixed ? { through: fixed } : {}) }
      )
      fixed ??= String(page.through)
      for (const event of page.events) {
        const projection = projectDimEvent(
          binding,
          event,
          (id) => messages.get(id) ?? null,
          (id) => inputs.get(id) ?? null
        )
        for (const input of projection.inputEvents ?? [])
          inputs.set(dimProjectionInputKey(input), input)
        for (const key of projection.consumedInputs ?? []) inputs.delete(key)
        if (projection.resetTranscript) messages.clear()
        for (const id of projection.retractions ?? []) messages.delete(id)
        for (const message of projection.messages) messages.set(message.id, message)
        binding = projection.binding
      }
      if (dimSequence(binding.cursor) >= dimSequence(fixed) || page.events.length === 0) break
    }
    return {
      messages: [...messages.values()].sort((left, right) => left.orderSeq - right.orderSeq),
      through: fixed!
    }
  }

  async latest(
    ref: DimSessionRef,
    kinds: string[],
    extra?: JsonValue,
    through?: string
  ): Promise<{ event: DimEvent | null; through: string }> {
    const client = await this.host.start()
    const kind: JsonValue = { op: 'in', value: { kind: 'field', path: 'kind' }, values: kinds }
    const page = await client.call<{
      through: string | number
      result: { events: Array<{ event: DimEvent }> }
    }>('session.deepchat_storage.query', {
      ...ref,
      query: {
        scope: 'branch',
        ...(through ? { through } : {}),
        query: {
          filter: extra ? { op: 'and', conditions: [kind, extra] } : kind,
          select: { kind: 'events' },
          order_by: [{ key: { kind: 'position' }, direction: 'descending' }]
        },
        page: { limit: 1 }
      }
    })
    return { event: page.result.events[0]?.event ?? null, through: String(page.through) }
  }
}
