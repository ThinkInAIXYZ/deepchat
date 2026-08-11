import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { SessionPendingInputStore } from '@/session/data/pendingInputStore'
import {
  DeepChatPendingInputsTable,
  PENDING_INPUT_RETRY_SCHEMA_VERSION
} from '@/session/data/tables/deepchatPendingInputs'
import { createSessionData } from '@/session/data'
import { MainDatabase } from '@/data/mainDatabase'
import { Database, nativeSqliteDescribeIf } from '../../../nativeSqliteHarness'

const DatabaseCtor = Database!
const describeIfNativeSqlite = nativeSqliteDescribeIf()

describe('DeepChatPendingInputsTable migrations', () => {
  it('declares attachment and retry recovery migrations', () => {
    const table = new DeepChatPendingInputsTable({} as never)
    expect(table.getLatestVersion()).toBe(PENDING_INPUT_RETRY_SCHEMA_VERSION)
    expect(table.getMigrationSQL(43)).toBe(
      'ALTER TABLE deepchat_pending_inputs ADD COLUMN blocking_json TEXT;'
    )
    expect(table.getMigrationSQL(46)).toContain(
      "ADD COLUMN message_ids_json TEXT NOT NULL DEFAULT '[]'"
    )
    expect(table.getMigrationSQL(46)).toContain('ADD COLUMN assistant_message_id TEXT')
    expect(table.getMigrationSQL(PENDING_INPUT_RETRY_SCHEMA_VERSION)).toContain(
      'ADD COLUMN retry_required_at INTEGER'
    )
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

  it('persists explicit retry state across store reconstruction without dispatching past it', () => {
    const { db, store, table } = createStore()
    try {
      const first = store.createQueueInputWithState(
        's1',
        { text: 'retry me', files: [] },
        'claimed'
      )
      const second = store.createQueueInput('s1', { text: 'later', files: [] })

      store.releaseClaimedQueueInputForRetry(first.id)
      const reconstructed = new SessionPendingInputStore({
        deepchatPendingInputsTable: table
      } as never)

      expect(reconstructed.getInput(first.id)?.state).toBe('retry_required')
      expect(reconstructed.getNextPendingQueueInput('s1')).toBeNull()
      expect(reconstructed.listPendingInputs('s1').map((item) => item.id)).toEqual([
        first.id,
        second.id
      ])

      expect(reconstructed.retryReleasedQueueInput(first.id).state).toBe('pending')
      expect(reconstructed.getNextPendingQueueInput('s1')?.id).toBe(first.id)
      expect(() => reconstructed.retryReleasedQueueInput(first.id)).toThrow(
        `Pending queue item ${first.id} does not require retry.`
      )
    } finally {
      db.close()
    }
  })

  it('migrates raw retry states to a downgrade-safe blocked marker', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatPendingInputsTable(db)
    try {
      const legacySchema = table
        .getCreateTableSQL()
        .replace('        retry_required_at INTEGER,\n', '')
      db.exec(legacySchema)
      db.prepare(
        `INSERT INTO deepchat_pending_inputs (
          id, session_id, mode, state, payload_json, message_ids_json, blocking_json,
          queue_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'released',
        's1',
        'queue',
        'retry_required',
        '{"text":"retry","files":[]}',
        '[]',
        null,
        1,
        10,
        11
      )

      db.exec(table.getMigrationSQL(PENDING_INPUT_RETRY_SCHEMA_VERSION)!)
      table.finalizeMigration(PENDING_INPUT_RETRY_SCHEMA_VERSION)

      expect(table.get('released')).toMatchObject({
        state: 'blocked',
        retry_required_at: 11,
        blocking_json: null
      })
      const reconstructed = new SessionPendingInputStore({
        deepchatPendingInputsTable: table
      } as never)
      expect(reconstructed.getInput('released')?.state).toBe('retry_required')

      db.prepare("UPDATE deepchat_pending_inputs SET state = 'pending' WHERE id = ?").run(
        'released'
      )
      expect(reconstructed.getInput('released')?.state).toBe('pending')

      db.prepare("UPDATE deepchat_pending_inputs SET state = 'blocked' WHERE id = ?").run(
        'released'
      )
      expect(reconstructed.retryReleasedQueueInput('released').state).toBe('pending')
      expect(table.get('released')).toMatchObject({
        state: 'pending',
        retry_required_at: null
      })
    } finally {
      db.close()
    }
  })

  it('runs retry-state normalization through MainDatabase v67 migration', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-pending-retry-'))
    const databasePath = path.join(directory, 'agent.db')
    try {
      const current = new MainDatabase(databasePath)
      current.close()

      const bootstrap = new DatabaseCtor(databasePath)
      bootstrap.exec(`
        ALTER TABLE deepchat_pending_inputs DROP COLUMN retry_required_at;
        DELETE FROM schema_versions;
        INSERT INTO schema_versions (version, applied_at) VALUES (66, 1);
        INSERT INTO deepchat_pending_inputs (
          id, session_id, mode, state, payload_json, message_ids_json, blocking_json,
          queue_order, created_at, updated_at
        ) VALUES (
          'released', 's1', 'queue', 'retry_required', '{"text":"retry","files":[]}',
          '[]', NULL, 1, 10, 11
        );
      `)
      bootstrap.close()

      const migrated = new MainDatabase(databasePath)
      expect(migrated.getLatestSchemaVersion()).toBe(PENDING_INPUT_RETRY_SCHEMA_VERSION)
      expect(migrated.deepchatPendingInputsTable.get('released')).toMatchObject({
        state: 'blocked',
        retry_required_at: 11
      })
      migrated.close()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
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

  it('rolls back every order update when claimed-slot resequencing fails', () => {
    const connection = new MainDatabase(':memory:')
    const data = createSessionData(connection, undefined, {
      publishPendingInputsChanged: () => {},
      publishMessagesChanged: () => {}
    })
    const originalUpdate = DeepChatPendingInputsTable.prototype.update
    let queueOrderUpdates = 0
    const update = vi
      .spyOn(DeepChatPendingInputsTable.prototype, 'update')
      .mockImplementation(function (itemId, fields) {
        if (fields.queue_order !== undefined && ++queueOrderUpdates === 3) {
          throw new Error('resequence failed')
        }
        return originalUpdate.call(this, itemId, fields)
      })

    try {
      const claimed = data.pendingInputs.queuePendingInput(
        's1',
        { text: 'claimed', files: [] },
        { state: 'claimed' }
      )
      const second = data.pendingInputs.queuePendingInput('s1', { text: 'second', files: [] })
      const third = data.pendingInputs.queuePendingInput('s1', { text: 'third', files: [] })

      expect(() => data.pendingInputs.moveQueuedInput('s1', third.id, 0)).toThrow(
        'resequence failed'
      )

      expect(
        connection.deepchatPendingInputsTable
          .listActiveBySession('s1')
          .filter((row) => row.mode === 'queue')
          .map((row) => [row.id, row.queue_order])
      ).toEqual([
        [claimed.id, 1],
        [second.id, 2],
        [third.id, 3]
      ])
    } finally {
      update.mockRestore()
      connection.close()
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
  it('rolls back claimed Queue message materialization when linking fails', () => {
    const connection = new MainDatabase(':memory:')
    const data = createSessionData(connection, undefined, {
      publishPendingInputsChanged: () => {},
      publishMessagesChanged: () => {}
    })

    try {
      data.settings.create('s1', 'openai', 'gpt-4o', 'full_access')
      const queue = data.pendingInputs.queuePendingInput(
        's1',
        { text: 'atomic queue', files: [] },
        { state: 'claimed' }
      )
      const originalUpdate = connection.deepchatPendingInputsTable.update.bind(
        connection.deepchatPendingInputsTable
      )
      const update = vi
        .spyOn(connection.deepchatPendingInputsTable, 'update')
        .mockImplementation((itemId, fields) => {
          if (fields.message_ids_json) {
            throw new Error('link failed')
          }
          return originalUpdate(itemId, fields)
        })

      expect(() =>
        data.pendingInputs.createClaimedQueueUserMessage('s1', queue.id, {
          text: 'atomic queue',
          files: [],
          links: [],
          search: false,
          think: false
        })
      ).toThrow('link failed')
      expect(data.transcript.getMessages('s1')).toEqual([])
      expect(data.pendingInputs.getInput('s1', queue.id)?.messageIds).toEqual([])

      update.mockRestore()
      const messageId = data.pendingInputs.createClaimedQueueUserMessage('s1', queue.id, {
        text: 'atomic queue',
        files: [],
        links: [],
        search: false,
        think: false
      })
      expect(data.pendingInputs.getInput('s1', queue.id)?.messageIds).toEqual([messageId])
      expect(data.transcript.getMessages('s1').map((message) => message.id)).toEqual([messageId])
    } finally {
      connection.close()
    }
  })

  it('rolls back every unread Steer transition when terminalization fails', () => {
    const connection = new MainDatabase(':memory:')
    const data = createSessionData(connection, undefined, {
      publishPendingInputsChanged: () => {},
      publishMessagesChanged: () => {}
    })

    try {
      data.settings.create('s1', 'openai', 'gpt-4o', 'full_access')
      const first = data.pendingInputs.acceptSteerMessage('s1', {
        text: 'first',
        files: []
      })
      const second = data.pendingInputs.acceptSteerMessage(
        's1',
        { text: 'second', files: [] },
        { mergeItemId: first.pendingInput.id }
      )
      const tapeCountBeforeRecovery = connection.deepchatTapeEntriesTable.getBySession('s1').length
      const originalUpdateStatus = connection.deepchatMessagesTable.updateStatus.bind(
        connection.deepchatMessagesTable
      )
      let failedStatusUpdates = 0
      const updateStatus = vi
        .spyOn(connection.deepchatMessagesTable, 'updateStatus')
        .mockImplementation((messageId, status) => {
          originalUpdateStatus(messageId, status)
          if (status === 'error' && ++failedStatusUpdates === 1) {
            throw new Error('terminalization failed')
          }
        })

      expect(() => data.pendingInputs.recoverInputsAfterRestart()).toThrow('terminalization failed')
      expect(data.transcript.getMessages('s1').map((message) => message.status)).toEqual([
        'pending',
        'pending'
      ])
      expect(data.pendingInputs.getInput('s1', first.pendingInput.id)?.state).toBe('pending')
      expect(data.pendingInputs.listPendingInputs('s1')).toHaveLength(1)
      expect(connection.deepchatTapeEntriesTable.getBySession('s1')).toHaveLength(
        tapeCountBeforeRecovery
      )

      updateStatus.mockRestore()
      data.pendingInputs.recoverInputsAfterRestart()
      expect(data.transcript.getMessages('s1').map((message) => message.status)).toEqual([
        'error',
        'error'
      ])
      expect(data.pendingInputs.getInput('s1', first.pendingInput.id)?.state).toBe('consumed')
      expect(data.pendingInputs.listPendingInputs('s1')).toEqual([])
      expect(connection.deepchatTapeEntriesTable.getBySession('s1')).toHaveLength(
        tapeCountBeforeRecovery + 2
      )
      expect(second.pendingInput.messageIds).toEqual([first.message.id, second.message.id])
    } finally {
      connection.close()
    }
  })

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
