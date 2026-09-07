import { computed, nextTick, reactive, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useDisplayMessages } from '@/features/chat-page/composables/useDisplayMessages'
import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'

type DisplayMessageOptions = Parameters<typeof useDisplayMessages>[0]

function assistantRecord(
  id: string,
  orderSeq: number,
  content: string,
  status: ChatMessageRecord['status'] = 'sent',
  updatedAt = orderSeq
): ChatMessageRecord {
  return {
    id,
    sessionId: 's1',
    orderSeq,
    role: 'assistant',
    content: JSON.stringify([
      {
        type: 'content',
        content,
        status: status === 'pending' ? 'pending' : 'success',
        timestamp: orderSeq
      }
    ]),
    status,
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: orderSeq,
    updatedAt
  }
}

function createHarness(
  messageOrder: string[],
  seededRecords: ChatMessageRecord[] = [
    assistantRecord('history', 1, 'settled'),
    assistantRecord('stream', 2, 'first snapshot', 'pending')
  ]
) {
  const streaming = reactive({ active: true })
  const initialBlock: AssistantMessageBlock = {
    type: 'content',
    content: 'first snapshot',
    status: 'pending',
    timestamp: 2
  }
  const records = reactive(
    new Map<string, ChatMessageRecord>(seededRecords.map((record) => [record.id, record]))
  )
  const messageStore = reactive({
    lastPersistedRevision: 1,
    streamRevision: 1,
    currentStreamMessageId: 'stream' as string | null,
    streamingBlocks: [initialBlock] as AssistantMessageBlock[],
    messageIds: [...messageOrder],
    messageCache: records,
    get messages() {
      return this.messageIds
        .map((id) => this.messageCache.get(id))
        .filter((record): record is ChatMessageRecord => Boolean(record))
    },
    getAssistantMessageBlocks(record: ChatMessageRecord) {
      return JSON.parse(record.content)
    },
    getUserMessageContent() {
      return {
        text: '',
        files: [],
        links: [],
        search: false,
        think: false
      }
    },
    getMessageMetadata() {
      return {}
    }
  })
  const sessionStore = reactive({
    activeSession: {
      id: 's1',
      modelId: 'model-1',
      providerId: 'provider-1'
    }
  })
  const modelStore = {
    findModelByIdOrName: () => ({ model: { name: 'Model 1' } })
  }
  const display = useDisplayMessages({
    sessionId: () => 's1',
    messageStore: messageStore as unknown as DisplayMessageOptions['messageStore'],
    sessionStore: sessionStore as unknown as DisplayMessageOptions['sessionStore'],
    modelStore: modelStore as unknown as DisplayMessageOptions['modelStore'],
    isGenerating: ref(false),
    isSessionViewCommitted: computed(() => true),
    isCurrentSessionStreaming: computed(() => streaming.active)
  })

  return { display, messageStore, records, streaming }
}

describe('useDisplayMessages', () => {
  it('ignores a non-string persisted runStopReason without failing the session list', () => {
    const record = assistantRecord('history', 1, 'settled')
    record.metadata = JSON.stringify({ runStopReason: 123 })
    const { display, messageStore } = createHarness(['history'], [record])
    messageStore.getMessageMetadata = (entry: ChatMessageRecord) => JSON.parse(entry.metadata)

    expect(() => display.displayMessages.value).not.toThrow()
    const history = display.displayMessages.value.find((message) => message.id === 'history')
    expect(history).toBeDefined()
    expect(history).not.toHaveProperty('runStopReason')
  })

  it('keeps ordered history and a folded streaming record in one display list', () => {
    const history = Array.from({ length: 200 }, (_, index) =>
      assistantRecord(`history-${index}`, index + 1, `settled-${index}`)
    )
    const stream = assistantRecord('stream', 201, 'first snapshot', 'pending', 201)
    const { display, messageStore, records } = createHarness(
      [...history.map((record) => record.id), stream.id],
      [...history, stream]
    )

    expect(display.displayMessages.value).toHaveLength(201)
    expect(display.displayMessages.value.map((message) => message.id)).toEqual([
      ...history.map((record) => record.id),
      'stream'
    ])

    const nextBlock: AssistantMessageBlock = {
      type: 'content',
      content: 'second snapshot',
      status: 'pending',
      timestamp: 202
    }
    messageStore.streamingBlocks = [nextBlock]
    records.set('stream', assistantRecord('stream', 201, 'second snapshot', 'pending', 202))
    messageStore.streamRevision += 1

    const messages = display.displayMessages.value
    expect(messages).toHaveLength(201)
    expect(messages.at(-1)?.id).toBe('stream')
    expect(messages.at(-1)?.content[0]?.content).toBe('second snapshot')
  })

  it('keeps an inline stream visible while its record reaches the cache before messageIds', () => {
    const { display, messageStore, records } = createHarness(
      ['history'],
      [assistantRecord('history', 1, 'settled')]
    )
    records.set('stream', assistantRecord('stream', 2, 'persisted response', 'pending', 3))
    messageStore.streamRevision += 1

    expect(display.displayMessages.value.map((message) => message.id)).toEqual([
      'history',
      'stream'
    ])
    expect(display.displayMessages.value.at(-1)?.content[0]?.content).toBe('persisted response')

    messageStore.messageIds.push('stream')
    messageStore.lastPersistedRevision += 1

    expect(display.displayMessages.value.map((message) => message.id)).toEqual([
      'history',
      'stream'
    ])
  })

  it('preserves a middle stream order and hands the pending row render key to it', async () => {
    const user = {
      ...assistantRecord('user', 1, 'prompt'),
      role: 'user' as const
    }
    const middleStream = assistantRecord('stream', 2, 'first snapshot', 'pending')
    const later = assistantRecord('later', 3, 'settled')
    const { display, messageStore, records } = createHarness(
      ['user', 'stream', 'later'],
      [user, middleStream, later]
    )
    messageStore.currentStreamMessageId = null
    messageStore.streamingBlocks = []
    const placeholderId = display.createPendingAssistantPlaceholder('s1')

    await nextTick()
    expect(display.pendingAssistantPlaceholder.value?.id).toBe(placeholderId)

    records.set('stream', assistantRecord('stream', 2, 'second snapshot', 'pending', 4))
    messageStore.currentStreamMessageId = 'stream'
    messageStore.streamingBlocks = [
      { type: 'content', content: 'second snapshot', status: 'pending', timestamp: 4 }
    ]
    messageStore.streamRevision += 1
    await nextTick()

    expect(display.displayMessages.value.map((message) => message.id)).toEqual([
      'user',
      'stream',
      'later'
    ])
    expect(display.displayMessages.value[1]?.renderKey).toBe(placeholderId)
  })
})
