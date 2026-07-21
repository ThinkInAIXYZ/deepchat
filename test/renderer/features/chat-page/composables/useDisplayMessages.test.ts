import { computed, reactive, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useMessageWindow } from '@/composables/message/useMessageWindow'
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
    assistantRecord('stream', 2, 'first snapshot', 'pending'),
    assistantRecord('later', 3, 'later')
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

  return { display, messageStore, records }
}

describe('useDisplayMessages streaming layout segments', () => {
  it('reuses 200 settled layout entries across folded tail snapshots', () => {
    const history = Array.from({ length: 200 }, (_, index) =>
      assistantRecord(`history-${index}`, index + 1, `settled-${index}`)
    )
    const stream = assistantRecord('stream', 201, 'first snapshot', 'pending', 201)
    const { display, messageStore, records } = createHarness(
      [...history.map((record) => record.id), stream.id],
      [...history, stream]
    )
    const messageWindow = useMessageWindow({
      messages: display.displayMessages,
      layoutSegments: display.layoutSegments
    })
    const initialEntries = messageWindow.entries.value
    const initialStableEntries = initialEntries.slice(0, history.length)

    const nextBlock: AssistantMessageBlock = {
      type: 'content',
      content: 'second snapshot',
      status: 'pending',
      timestamp: 202
    }
    messageStore.streamingBlocks = [nextBlock]
    records.set('stream', assistantRecord('stream', 201, 'second snapshot', 'pending', 202))
    messageStore.streamRevision += 1

    const updatedEntries = messageWindow.entries.value
    expect(updatedEntries).toHaveLength(201)
    expect(updatedEntries.slice(0, history.length)).toEqual(initialStableEntries)
    initialStableEntries.forEach((entry, index) => {
      expect(updatedEntries[index]).toBe(entry)
    })
    expect(updatedEntries[200]).not.toBe(initialEntries[200])
  })

  it('keeps settled history stable for a folded stream at the message tail', () => {
    const { display, messageStore, records } = createHarness(['history', 'stream'])
    const firstSegments = display.layoutSegments.value

    expect(firstSegments).not.toBeNull()
    expect(firstSegments?.stable.map((message) => message.id)).toEqual(['history'])
    expect(firstSegments?.tail.map((message) => message.id)).toEqual(['stream'])
    const stableMessages = firstSegments!.stable
    const settledMessage = stableMessages[0]
    const firstStreamingMessage = firstSegments!.tail[0]

    const nextBlock: AssistantMessageBlock = {
      type: 'content',
      content: 'second snapshot',
      status: 'pending',
      timestamp: 2
    }
    messageStore.streamingBlocks = [nextBlock]
    records.set('stream', assistantRecord('stream', 2, 'second snapshot', 'pending', 3))
    messageStore.streamRevision += 1

    const nextSegments = display.layoutSegments.value
    expect(nextSegments).not.toBeNull()
    expect(nextSegments!.stable).toBe(stableMessages)
    expect(nextSegments!.stable[0]).toBe(settledMessage)
    expect(nextSegments!.tail[0]).not.toBe(firstStreamingMessage)
    expect(nextSegments!.tail[0].content[0]?.content).toBe('second snapshot')
  })

  it('falls back to full ordering when an inline stream is in the middle', () => {
    const { display } = createHarness(['history', 'stream', 'later'])

    expect(display.layoutSegments.value).toBeNull()
    expect(display.displayMessages.value.map((message) => message.id)).toEqual([
      'history',
      'stream',
      'later'
    ])
  })

  it('leaves the tail fast path when a later message appears', () => {
    const { display, messageStore } = createHarness(['history', 'stream'])

    expect(display.layoutSegments.value).not.toBeNull()
    messageStore.messageIds.push('later')

    expect(display.layoutSegments.value).toBeNull()
    expect(display.displayMessages.value.map((message) => message.id)).toEqual([
      'history',
      'stream',
      'later'
    ])
  })
})
