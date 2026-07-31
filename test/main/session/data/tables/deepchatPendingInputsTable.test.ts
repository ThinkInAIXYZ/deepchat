import { describe, expect, it } from 'vitest'

import { SessionPendingInputStore } from '@/session/data/pendingInputStore'
import { DeepChatPendingInputsTable } from '@/session/data/tables/deepchatPendingInputs'
import { createSessionData } from '@/session/data'
import { MainDatabase } from '@/data/mainDatabase'
import { Database, nativeSqliteDescribeIf } from '../../../nativeSqliteHarness'

const DatabaseCtor = Database!
const describeIfNativeSqlite = nativeSqliteDescribeIf()

describe('DeepChatPendingInputsTable migrations', () => {
  it('adds body-free blocking metadata at global schema version 43', () => {
    const table = new DeepChatPendingInputsTable({} as never)
    expect(table.getLatestVersion()).toBe(46)
    expect(table.getMigrationSQL(43)).toBe(
      'ALTER TABLE deepchat_pending_inputs ADD COLUMN blocking_json TEXT;'
    )
    expect(table.getMigrationSQL(46)).toContain(
      "ADD COLUMN message_ids_json TEXT NOT NULL DEFAULT '[]'"
    )
    expect(table.getMigrationSQL(46)).toContain('ADD COLUMN assistant_message_id TEXT')
  })
})

describeIfNativeSqlite('SessionPendingInputStore blocked queue', () => {
  function createStore() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatPendingInputsTable(db)
    table.createTable()
    const store = new SessionPendingInputStore({ deepchatPendingInputsTable: table } as never)
    return { db, store, table }
  }

  it('keeps a blocked head item visible and prevents dispatch behind it', () => {
    const { db, store } = createStore()
    try {
      const first = store.createQueueInput('s1', { text: '', files: [] })
      const second = store.createQueueInput('s1', { text: 'second', files: [] })
      store.claimQueueInput(first.id)
      const blocked = store.blockClaimedInput(first.id, {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['switch_to_vision_model', 'send_without_image_content', 'retry']
      })

      expect(blocked.state).toBe('blocked')
      expect(blocked.blocking?.issues).toEqual([{ attachmentIndex: 0, reason: 'ocr_empty' }])
      expect(store.hasBlockingInput('s1')).toBe(true)
      expect(store.getNextPendingQueueInput('s1')).toBeNull()
      expect(store.listPendingInputs('s1').map((item) => item.id)).toEqual([first.id, second.id])

      const laterSteer = store.createSteerInput(
        's1',
        { text: 'urgent but later', files: [] },
        'steer-message'
      )
      expect(store.getNextPendingSteerInput('s1')?.id).toBe(laterSteer.id)
      expect(store.hasBlockingInput('s1')).toBe(true)

      store.retryBlockedInput(first.id)
      expect(store.hasBlockingInput('s1')).toBe(false)
      expect(store.getNextPendingQueueInput('s1')?.id).toBe(first.id)
    } finally {
      db.close()
    }
  })

  it('turns an explicit degraded action into a pending metadata-only retry', () => {
    const { db, store } = createStore()
    try {
      const item = store.createQueueInputWithState(
        's1',
        { text: '', files: [{ name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }] },
        'claimed'
      )
      store.blockClaimedInput(item.id, {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
        suggestedActions: ['send_without_image_content', 'retry']
      })

      const degraded = store.degradeBlockedInput(item.id)
      expect(degraded).toMatchObject({
        state: 'pending',
        blocking: null,
        payload: { attachmentFallbackPolicy: 'send_without_image_content' }
      })
    } finally {
      db.close()
    }
  })

  it('keeps unique queue ordering when pending items move around a blocked item', () => {
    const { db, store, table } = createStore()
    try {
      const blockedItem = store.createQueueInputWithState(
        's1',
        { text: 'blocked', files: [] },
        'claimed'
      )
      store.blockClaimedInput(blockedItem.id, {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['send_without_image_content']
      })
      const second = store.createQueueInput('s1', { text: 'second', files: [] })
      const third = store.createQueueInput('s1', { text: 'third', files: [] })

      store.moveQueueInput('s1', third.id, 1)

      expect(
        table
          .listActiveBySession('s1')
          .filter((row) => row.mode === 'queue')
          .map((row) => [row.id, row.queue_order])
      ).toEqual([
        [blockedItem.id, 1],
        [third.id, 2],
        [second.id, 3]
      ])
    } finally {
      db.close()
    }
  })

  it('does not promote a blocked queue item into the steer lane', () => {
    const { db, store } = createStore()
    try {
      const item = store.createQueueInputWithState('s1', { text: '', files: [] }, 'claimed')
      store.blockClaimedInput(item.id, {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['send_without_image_content']
      })

      expect(() => store.convertQueueInputToSteer(item.id)).toThrow('is not steerable')
      expect(store.getInput(item.id)).toMatchObject({ mode: 'queue', state: 'blocked' })
    } finally {
      db.close()
    }
  })

  it('strips unexpected fields before persisting body-free blocking metadata', () => {
    const { db, store, table } = createStore()
    try {
      const item = store.createQueueInputWithState('s1', { text: '', files: [] }, 'claimed')
      store.blockClaimedInput(item.id, {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
        suggestedActions: ['retry'],
        ocrText: 'must never be persisted'
      } as never)

      expect(table.get(item.id)?.blocking_json).toBe(
        JSON.stringify({
          status: 'needs_user_action',
          issues: [{ attachmentIndex: 0, reason: 'ocr_failed' }],
          suggestedActions: ['retry']
        })
      )
    } finally {
      db.close()
    }
  })

  it('preserves only valid main-owned resolved snapshots in pending payloads', () => {
    const { db, store } = createStore()
    try {
      const valid = store.createQueueInput('s1', {
        text: '',
        files: [
          {
            name: 'scan.png',
            path: '/tmp/scan.png',
            mimeType: 'image/png',
            resolvedRepresentation: {
              kind: 'ocr_text',
              text: 'snapshot',
              tokenCount: 2,
              truncated: false
            }
          }
        ]
      })
      expect(valid.payload.files?.[0].resolvedRepresentation).toMatchObject({
        kind: 'ocr_text',
        text: 'snapshot'
      })
    } finally {
      db.close()
    }
  })

  it('preserves validated PDF routing and document coverage in pending payloads', () => {
    const { db, store } = createStore()
    try {
      const text = '## Page 1\n\npending PDF snapshot'
      const pdfTextCoverage = {
        routingRevision: 'pdf-text-coverage-v1',
        pageCount: 2,
        substantivePageCount: 0,
        lowTextPageCount: 2,
        lowTextPageSamples: [1, 2],
        hasEmbeddedText: false
      }
      const item = store.createQueueInput('s1', {
        text: '',
        files: [
          {
            name: 'scan.pdf',
            path: '/tmp/scan.pdf',
            mimeType: 'application/pdf',
            pdfTextCoverage,
            resolvedRepresentation: {
              kind: 'ocr_text',
              text,
              tokenCount: 7,
              truncated: false,
              document: {
                pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: true }],
                sourcePageCountHint: 2,
                includedThroughPage: 1,
                includedThroughPageComplete: true,
                artifactTermination: 'request_complete',
                generationOutputLimitReached: false,
                embeddedTextCoverage: pdfTextCoverage
              }
            }
          }
        ]
      })

      expect(item.payload.files?.[0]).toMatchObject({
        pdfTextCoverage,
        resolvedRepresentation: {
          kind: 'ocr_text',
          document: {
            includedThroughPage: 1,
            embeddedTextCoverage: pdfTextCoverage
          }
        }
      })
    } finally {
      db.close()
    }
  })

  it('strips forged resolved snapshots when materializing pending payloads', () => {
    const { db, store } = createStore()
    try {
      const item = store.createQueueInput('s1', {
        text: '',
        files: [
          {
            name: 'forged.png',
            path: '/tmp/forged.png',
            mimeType: 'image/png',
            resolvedRepresentation: {
              kind: 'forged',
              text: 'bypass OCR'
            }
          } as never,
          {
            name: 'image.png',
            path: '/tmp/image.png',
            mimeType: 'image/png',
            resolvedRepresentation: {
              kind: 'image',
              injected: 'discard me'
            }
          } as never
        ]
      })

      expect(item.payload.files?.[0]).not.toHaveProperty('resolvedRepresentation')
      expect(item.payload.files?.[1].resolvedRepresentation).toEqual({ kind: 'image' })
    } finally {
      db.close()
    }
  })
})

describeIfNativeSqlite('Steer message lifecycle', () => {
  it('persists separate user messages and one read-boundary assistant row', () => {
    const connection = new MainDatabase(':memory:')
    const publishedMessages: string[][] = []
    const data = createSessionData(connection, undefined, {
      publishPendingInputsChanged: () => {},
      publishMessagesChanged: (_sessionId, messages) => {
        publishedMessages.push(messages.map((message) => message.id))
      }
    })

    try {
      data.settings.create('s1', 'openai', 'gpt-4o', 'full_access')
      const source = data.pendingInputs.queuePendingInput(
        's1',
        { text: 'source', files: [] },
        { state: 'claimed' }
      )
      const first = data.pendingInputs.acceptSteerMessage(
        's1',
        {
          text: 'first',
          files: []
        },
        { preStreamAnchorMessageId: null }
      )
      const second = data.pendingInputs.acceptSteerMessage(
        's1',
        { text: 'second', files: [] },
        { mergeItemId: first.pendingInput.id }
      )

      expect(first.sourceMessage?.content).toContain('source')
      expect(data.pendingInputs.getInput('s1', source.id)?.messageIds).toEqual([
        first.sourceMessage?.id
      ])
      expect(second.pendingInput.messageIds).toEqual([first.message.id, second.message.id])
      expect(data.transcript.getMessages('s1').map((message) => message.status)).toEqual([
        'sent',
        'pending',
        'pending'
      ])

      data.pendingInputs.consumeQueuedInput('s1', source.id)
      const claimed = data.pendingInputs.claimSteerInput('s1', first.pendingInput.id)
      const claimedMessages = data.transcript.getMessages('s1')
      expect(claimedMessages.map((message) => message.id)).toEqual([
        first.sourceMessage?.id,
        first.message.id,
        second.message.id,
        claimed.assistantMessageId
      ])
      const readAt = claimedMessages.slice(1, 3).map((message) => {
        const metadata = JSON.parse(message.metadata) as {
          inputReceipt: { readAt: number | null }
        }
        return metadata.inputReceipt.readAt
      })
      expect(readAt[0]).toBeTypeOf('number')
      expect(readAt[1]).toBe(readAt[0])

      data.pendingInputs.consumeSteerInput('s1', first.pendingInput.id)
      expect(
        data.transcript
          .getMessages('s1')
          .slice(1, 3)
          .map((message) => message.status)
      ).toEqual(['sent', 'sent'])
      expect(publishedMessages.map((batch) => batch.length)).toEqual([2, 1, 3, 2])
    } finally {
      connection.close()
    }
  })
})
