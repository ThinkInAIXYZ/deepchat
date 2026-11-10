import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimEvent, DimSessionRef } from './sessionConnection'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { ChatMessageRecord, PendingSessionInputRecord } from '@shared/types/agent-interface'
import { dimProjectionInputKey, projectDimEvent } from './messageProjection'
import { dimSequence } from './sessionConnection'
import { readDimImportedSnapshot } from './historyImport'
import type { DimHistorySnapshot } from './historyImport'

/** All native content reads cross the injected storage plugin; no desktop SQLite reader. */
export class DimContent {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  /** An isolated read-model replay for conversion/edit/fork. It cannot admit or execute input. */
  async transcript(
    ref: DimSessionRef,
    productSessionId: string,
    through?: string
  ): Promise<{
    messages: ChatMessageRecord[]
    through: string
    summary: string | null
    contextFromOrderSeq: number
    pendingInputs: PendingSessionInputRecord[]
    excludedContextMessageIds: string[]
    images: Record<string, JsonValue[]>
    pluginHookState: NonNullable<DimHistorySnapshot['pluginHookState']>
  }> {
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
    const images = new Map<string, JsonValue[]>()
    let summary: string | null = null
    let contextFromOrderSeq = 1
    let pendingInputs: PendingSessionInputRecord[] = []
    const legacyAdmissions = new Map<string, string>()
    const excluded = new Set<string>()
    const pluginHookState = new Map<
      string,
      NonNullable<DimHistorySnapshot['pluginHookState']>[number]
    >()
    let fixed = through
    while (true) {
      const page = await client.call<{ through: number | string; events: DimEvent[] }>(
        'deepchat.storage.history',
        { ...ref, after: binding.cursor, limit: 200, ...(fixed ? { through: fixed } : {}) }
      )
      fixed ??= String(page.through)
      for (const event of page.events) {
        if (
          event.type === 'deepchat' &&
          (event.name === 'plugin-hook' || event.name === 'plugin-hook-session') &&
          typeof event.data.pluginId === 'string' &&
          typeof event.data.digest === 'string'
        ) {
          const key = `${event.name}:${event.data.invocationId ?? event.data.observationId}`
          pluginHookState.delete(key)
          pluginHookState.set(key, { name: event.name, data: event.data })
        }
        if (event.type === 'deepchat' && event.name === 'legacy-queue-state') {
          if (!Array.isArray(event.data.inputs))
            throw new Error('Invalid native legacy draft state')
          pendingInputs = event.data.inputs as unknown as PendingSessionInputRecord[]
        }
        if (event.type === 'deepchat' && event.name === 'input-representation') {
          const draft = event.data.legacyDraft
          if (
            draft &&
            typeof draft === 'object' &&
            !Array.isArray(draft) &&
            typeof draft.id === 'string'
          )
            legacyAdmissions.set(String(event.data.submissionId), draft.id)
        }
        if (event.type === 'input' && event.name === 'message') {
          const id = legacyAdmissions.get(String(event.data.submission_id))
          if (id) pendingInputs = pendingInputs.filter((item) => item.id !== id)
        }
        if (event.type === 'deepchat' && event.name === 'history-sealed') {
          const imported = readDimImportedSnapshot(binding, event, (id) => inputs.get(id) ?? null)
          summary = imported.snapshot.summary
          contextFromOrderSeq = imported.snapshot.contextFromOrderSeq ?? 1
          pendingInputs = imported.snapshot.pendingInputs ?? []
          excluded.clear()
          for (const id of imported.snapshot.excludedContextMessageIds ?? []) excluded.add(id)
          images.clear()
          for (const [key, blocks] of Object.entries(imported.snapshot.images ?? {}))
            images.set(key, blocks)
        }
        const projection = projectDimEvent(
          binding,
          event,
          (id) => messages.get(id) ?? null,
          (id) => inputs.get(id) ?? null
        )
        if (event.type === 'deepchat' && event.name === 'context-restored')
          excluded.delete(String(event.data.messageId))
        if (event.type === 'input' && event.name === 'applied') {
          const input = inputs.get(String(event.data.input_id))
          const user = input?.data.user
          if (user && typeof user === 'object' && !Array.isArray(user)) {
            const blocks = Array.isArray(user.content)
              ? user.content.filter(
                  (block) =>
                    block &&
                    typeof block === 'object' &&
                    !Array.isArray(block) &&
                    block.type === 'image'
                )
              : []
            const message = projection.messages.find((message) => message.role === 'user')
            if (message && blocks.length) images.set(message.id, blocks)
          }
          for (const message of projection.messages)
            if (message.role === 'user') excluded.delete(message.id)
        }
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
      through: fixed!,
      summary,
      contextFromOrderSeq,
      pendingInputs,
      pluginHookState: [...pluginHookState.values()],
      excludedContextMessageIds: [...excluded],
      images: Object.fromEntries(images)
    }
  }

  async latest(
    ref: DimSessionRef,
    kinds: string[],
    extra?: JsonValue,
    through?: string
  ): Promise<{ event: DimEvent | null; through: string }> {
    const page = await this.events(ref, kinds, 1, extra, through)
    return { event: page.events[0]?.event ?? null, through: page.through }
  }

  async events(
    ref: DimSessionRef,
    kinds: string[],
    limit: number,
    extra?: JsonValue,
    through?: string
  ): Promise<{
    events: Array<{ event: DimEvent; position: { branch_id: string; sequence: string | number } }>
    through: string
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new Error('Native event queries require a limit between 1 and 200')
    const client = await this.host.start()
    const kind: JsonValue = { op: 'in', value: { kind: 'field', path: 'kind' }, values: kinds }
    const page = await client.call<{
      through: string | number
      result: {
        events: Array<{
          event: DimEvent
          position: { branch_id: string; sequence: string | number }
        }>
      }
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
        page: { limit }
      }
    })
    return { events: page.result.events, through: String(page.through) }
  }
}
