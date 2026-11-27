import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type {
  PendingSessionInputRecord,
  QueuePendingInputOptions,
  SendMessageInput,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimSessionRuntime } from './sessionRuntime'
import type { DimPreparedInput } from './backend'
import { DimLegacyQueue, isDimLegacyDraft, type DimLegacyDrafts } from './legacyQueue'

interface NativePendingInput {
  inputId: string
  createdAt: number
  applied: boolean
  input: {
    submission_id?: string
    mode?: 'queue' | 'steer' | 'append'
    user?: { content: Array<{ type: string; text?: string }> }
  }
  representation: UserMessageContent | null
}
interface QueueOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  runtime: DimSessionRuntime
  legacyPendingInputs?(sessionId: string): PendingSessionInputRecord[]
  prepareNative(sessionId: string): Promise<void>
  setProjectDir(sessionId: string, directory: string | null): Promise<void>
  prepareInput(
    sessionId: string,
    content: SendMessageInput,
    signal?: AbortSignal
  ): Promise<DimPreparedInput>
}

/** Product queue views and commands. Every admitted item is held and scheduled by dim. */
export class DimQueue {
  private readonly legacy: DimLegacyQueue
  constructor(private readonly options: QueueOptions) {
    this.legacy = new DimLegacyQueue(options)
  }

  readonly listPendingInputs = async (
    sessionId: string,
    admittedInputId?: string
  ): Promise<PendingSessionInputRecord[]> => {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) return this.legacy.passive(sessionId)
    const client = await this.options.host.start()
    const { inputs, drafts } = await client.call<{
      inputs: NativePendingInput[]
      drafts?: DimLegacyDrafts
    }>('session.deepchat_queue.list', {
      sessionId: binding.dimSessionId,
      branchId: binding.branchId
    })
    const desktopPrefix = `desktop:${JSON.stringify(sessionId)}:`
    const native = inputs
      .filter((item) => item.input.user && item.input.mode !== 'append')
      // A direct turn at the head is already going to the transcript. Keep inputs waiting
      // behind other entries visible.
      .filter(
        (item, index) =>
          item.inputId === admittedInputId ||
          !item.input.submission_id?.startsWith(desktopPrefix) ||
          (index > 0 && !item.applied)
      )
      .map((item, index): PendingSessionInputRecord => {
        const representation = item.representation
        const payload: SendMessageInput = representation
          ? {
              text: representation.text,
              files: representation.files,
              search: representation.search,
              activeSkills: representation.activeSkills,
              inlineItems: representation.inlineItems
            }
          : {
              text: item.input
                .user!.content.flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : []))
                .join('\n')
            }
        return {
          id: item.inputId,
          sessionId,
          mode: item.input.mode === 'steer' ? 'steer' : 'queue',
          state: item.applied ? 'claimed' : 'pending',
          payload,
          queueOrder: index,
          messageIds: [],
          assistantMessageId: null,
          blocking: null,
          claimedAt: item.applied ? item.createdAt : null,
          consumedAt: null,
          createdAt: item.createdAt,
          updatedAt: item.createdAt
        }
      })
    return [
      ...native,
      ...this.legacy.project(drafts ?? { revision: null, inputs: [] }, native.length)
    ]
  }

  readonly queuePendingInput = async (
    sessionId: string,
    content: SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord> => {
    options?.signal?.throwIfAborted()
    const prepared = await this.prepare(sessionId, content, options?.signal)
    if (options?.projectDir !== undefined)
      await this.options.setProjectDir(sessionId, options.projectDir)
    await this.options.prepareNative(sessionId)
    options?.signal?.throwIfAborted()
    const receipt = await this.options.runtime.submit(sessionId, prepared.content, {
      ...(options?.source === 'send' || options?.submissionId
        ? {
            submissionId: `desktop:${JSON.stringify(sessionId)}:${options?.submissionId ?? randomUUID()}`
          }
        : {}),
      representation: prepared.representation,
      maxProviderRounds: options?.maxProviderRounds,
      ...(options?.requireIdle ? { requireIdle: true } : {})
    })
    // The owner may consume it before this response. Admission still succeeded.
    return (
      (await this.listPendingInputs(sessionId, receipt.inputId)).find(
        (item) => item.id === receipt.inputId
      ) ?? {
        id: receipt.inputId,
        sessionId,
        mode: 'queue',
        state: 'consumed',
        payload: content,
        messageIds: [],
        assistantMessageId: null,
        blocking: null,
        queueOrder: null,
        claimedAt: null,
        consumedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    )
  }

  readonly updateQueuedInput = async (
    sessionId: string,
    itemId: string,
    content: SendMessageInput
  ): Promise<PendingSessionInputRecord> => {
    if (isDimLegacyDraft(itemId)) {
      const state = await this.legacy.mutate(sessionId, itemId, 'update', {
        payload: content as unknown as JsonValue
      })
      return this.legacy.project(state).find((item) => item.id === itemId)!
    }
    const prepared = await this.prepare(sessionId, content)
    const held = await this.held(sessionId, itemId)
    const tail = held.slice(held.findIndex((item) => item.id === itemId)).map((item) => item.id)
    const receipts = await this.mutate(sessionId, tail, tail, {
      replacement: {
        input: { user: { content: prepared.content } },
        representation: prepared.representation
      }
    })
    const replacement = receipts.find((receipt) => receipt.previousId === itemId)
    const record = (await this.listPendingInputs(sessionId)).find(
      (item) => item.id === replacement?.inputId
    )
    if (!record)
      throw new Error('The updated native input has already started; refresh the conversation')
    return record
  }

  readonly moveQueuedInput = async (
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> => {
    if (!Number.isInteger(toIndex) || toIndex < 0)
      throw new Error('Invalid native queue destination')
    const items = await this.listPendingInputs(sessionId)
    const lane = items.filter((item) => item.mode === 'queue')
    if (toIndex >= lane.length) throw new Error('Invalid native queue destination')
    const beforeDestination = lane.filter((item) => item.id !== itemId).slice(0, toIndex)
    if (isDimLegacyDraft(itemId)) {
      const destination = beforeDestination.filter((item) => isDimLegacyDraft(item.id)).length
      const drafts = items.filter((item) => isDimLegacyDraft(item.id))
      const visible = drafts.filter((item) => item.mode === 'queue')
      if (visible.findIndex((item) => item.id === itemId) === destination) return items
      const next = visible.filter((item) => item.id !== itemId)[destination]
      const remaining = drafts.filter((item) => item.id !== itemId)
      await this.legacy.mutate(sessionId, itemId, 'move', {
        toIndex: next ? remaining.indexOf(next) : remaining.length
      })
      return this.listPendingInputs(sessionId)
    }
    const held = this.heldItems(items, itemId)
    const destination = beforeDestination.filter(
      (item) => !isDimLegacyDraft(item.id) && item.state === 'pending'
    ).length
    const index = held.findIndex((item) => item.id === itemId)
    if (index === destination) return items
    const ids = held.map((item) => item.id)
    const reordered = [...ids]
    reordered.splice(destination, 0, ...reordered.splice(index, 1))
    const start = Math.min(index, destination)
    await this.mutate(sessionId, ids.slice(start), reordered.slice(start))
    return this.listPendingInputs(sessionId)
  }

  readonly deletePendingInput = async (sessionId: string, itemId: string): Promise<void> => {
    if (isDimLegacyDraft(itemId)) {
      await this.legacy.mutate(sessionId, itemId, 'delete')
      return
    }
    await this.held(sessionId, itemId)
    await this.mutate(sessionId, [itemId], [])
  }

  readonly steerPendingInput = async (
    sessionId: string,
    itemId: string
  ): Promise<PendingSessionInputRecord> => {
    if (isDimLegacyDraft(itemId)) {
      const record = (await this.listPendingInputs(sessionId)).find((item) => item.id === itemId)
      if (!record) throw new Error('Legacy draft is absent')
      const admitted = await this.legacy.admit(sessionId, itemId, 'steer')
      if (!admitted.accepted) throw new Error('Resolve legacy draft attachments before steering')
      return { ...record, id: admitted.inputId!, mode: 'steer', state: 'claimed' }
    }
    const record = (await this.held(sessionId, itemId)).find((item) => item.id === itemId)!
    const receipts = await this.mutate(sessionId, [itemId], [itemId], { steer: true })
    return { ...record, id: receipts[0].inputId, mode: 'steer', state: 'claimed' }
  }

  // Native queues recover themselves. Resume only admits unsubmitted legacy drafts.
  readonly isPendingQueueResumeAvailable = (sessionId: string) => this.legacy.available(sessionId)
  readonly resumePendingQueue = (sessionId: string) => this.legacy.resume(sessionId)
  readonly retryPendingQueueInput = (sessionId: string, itemId: string) =>
    isDimLegacyDraft(itemId)
      ? this.legacy.admit(sessionId, itemId)
      : Promise.resolve({ accepted: false, started: false })
  readonly resolveBlockedPendingInput = async (
    sessionId: string,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<PendingSessionInputRecord> => {
    const record = (await this.listPendingInputs(sessionId)).find((item) => item.id === itemId)
    if (!record) throw new Error('Native pending input does not exist')
    return this.updateQueuedInput(sessionId, itemId, {
      ...record.payload,
      ...(action === 'send_without_image_content'
        ? { attachmentFallbackPolicy: 'send_without_image_content' }
        : {})
    })
  }

  private async held(sessionId: string, itemId: string) {
    return this.heldItems(await this.listPendingInputs(sessionId), itemId)
  }
  private heldItems(items: PendingSessionInputRecord[], itemId: string) {
    const held = items.filter(
      (item) => !isDimLegacyDraft(item.id) && item.mode === 'queue' && item.state === 'pending'
    )
    if (!held.some((item) => item.id === itemId))
      throw new Error('Native input has already started or was removed')
    return held
  }
  private async prepare(sessionId: string, content: SendMessageInput, signal?: AbortSignal) {
    const prepared = await this.options.prepareInput(sessionId, content, signal)
    if (prepared.summary.status === 'needs_user_action')
      throw new Error('Resolve the attachment preparation issue before queueing this input')
    return prepared
  }
  private async mutate(
    sessionId: string,
    sources: string[],
    order: string[],
    extra: { [key: string]: JsonValue } = {}
  ) {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) throw new Error('Native session is not initialized')
    const client = await this.options.host.start()
    // A command identity belongs to one invocation. The native journal completes it across
    // disconnection/restart; a lost response must never be retried under a fresh identity.
    const result = await client.call<{
      conflicted: boolean
      receipts: Array<{ previousId: string; inputId: string }>
    }>('session.deepchat_queue.mutate', {
      sessionId: binding.dimSessionId,
      branchId: binding.branchId,
      plan: {
        operationId: randomUUID(),
        sources,
        order,
        replacement: null,
        ...extra
      }
    })
    if (result.conflicted)
      throw new Error('The native queue changed during the edit; refresh the queue')
    return result.receipts
  }
}
