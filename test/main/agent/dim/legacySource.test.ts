import { expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { DimLegacySource, legacyImageBlocks } from '@/agent/dim/legacySource'
import { dimHistoryPlan } from '@/agent/dim/historyImport'
import { TranscriptProjectionApplier } from '@/session/data/transcriptProjection'
import { dimDatabase } from './fixtures/database'
import { readLegacyPluginHooks } from '@/agent/dim/legacyPluginHooks'
import { createHash } from 'node:crypto'

it('converts legacy image files into native image blocks for migration', () => {
  const message: ChatMessageRecord = {
    id: 'image-message',
    sessionId: 'legacy',
    orderSeq: 1,
    role: 'user',
    content: JSON.stringify({
      text: 'Describe this',
      files: [
        {
          name: 'old.png',
          path: '/old.png',
          mimeType: 'image/png',
          content: 'data:image/png;base64,cG5n'
        }
      ],
      links: [],
      search: false,
      think: false
    }),
    status: 'sent',
    metadata: '{}',
    isContextEdge: 0,
    createdAt: 1,
    updatedAt: 1
  }

  expect(legacyImageBlocks([message])).toEqual({
    'image-message': [
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'cG5n' } }
    ]
  })
})

it('converts canonical edits and retractions without resurrecting stale transcript rows or writing Tape', async () => {
  const { data, sqlite } = dimDatabase()
  try {
    const tape = data.deepchatTapeEntriesTable
    sqlite.exec(tape.getCreateTableSQL())
    const record = (id: string, orderSeq: number, text: string): ChatMessageRecord => ({
      id,
      sessionId: 'legacy',
      orderSeq,
      role: 'user',
      content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
      status: 'sent',
      metadata: '{}',
      isContextEdge: 0,
      createdAt: 1,
      updatedAt: 1
    })
    const stale = record('edited', 1, 'stale cached content')
    const removed = record('removed', 2, 'removed content')
    const oldSqlOnly = record('sql-only', 3, 'before Tape existed')
    const pending = {
      ...record('interrupted', 4, ''),
      role: 'assistant' as const,
      content: '[]',
      status: 'pending' as const
    }
    const applier = new TranscriptProjectionApplier(data)
    for (const message of [stale, removed, oldSqlOnly, pending]) applier.applyRecord(message)
    for (const message of [
      stale,
      removed,
      { ...stale, content: record('edited', 1, 'canonical edit').content, updatedAt: 2 }
    ])
      tape.append({
        sessionId: 'legacy',
        kind: 'message',
        payload: { record: message },
        createdAt: message.updatedAt
      })
    tape.appendEvent({
      sessionId: 'legacy',
      name: 'message/retracted',
      data: { messageId: removed.id },
      createdAt: 3
    })
    const head = tape.getMaxEntryId('legacy')
    const draft = {
      id: 'retry',
      sessionId: 'legacy',
      mode: 'queue' as const,
      state: 'retry_required' as const,
      payload: { text: 'before Tape existed' },
      messageIds: ['sql-only'],
      assistantMessageId: null,
      queueOrder: 0,
      blocking: null,
      claimedAt: null,
      consumedAt: null,
      createdAt: 1,
      updatedAt: 1
    }
    const source = new DimLegacySource({
      database: data,
      tape,
      transcript: { getMessages: () => [stale, removed, oldSqlOnly, pending] },
      summary: {
        getSummaryState: () => ({
          summaryText: 'Retained summary',
          summaryCursorOrderSeq: 3,
          summaryUpdatedAt: 3
        })
      },
      pending: { listPendingInputs: () => [], listMigrationInputs: () => [draft] }
    })
    const snapshot = await source.snapshot('legacy')
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      'edited',
      'sql-only',
      'interrupted'
    ])
    expect(JSON.parse(snapshot.messages[0].content).text).toBe('canonical edit')
    expect(snapshot).toMatchObject({ summary: 'Retained summary', contextFromOrderSeq: 3 })
    expect(snapshot.pendingInputs).toEqual([draft])
    expect(snapshot.excludedContextMessageIds).toEqual(['sql-only'])
    expect(dimHistoryPlan(await source.snapshot('legacy')).digest).toBe(
      dimHistoryPlan(snapshot).digest
    )
    expect(tape.getMaxEntryId('legacy')).toBe(head)
    expect(data.dimSessionBindingsTable.get('legacy')).toBeNull()
  } finally {
    sqlite.close()
  }
})

it('projects selected attachment text and historical tool pairs without changing archived payloads', async () => {
  const { data, sqlite } = dimDatabase()
  try {
    const record = (
      id: string,
      orderSeq: number,
      role: ChatMessageRecord['role'],
      content: unknown
    ): ChatMessageRecord => ({
      id,
      sessionId: 'legacy',
      orderSeq,
      role,
      content: JSON.stringify(content),
      status: 'sent',
      metadata: '{}',
      isContextEdge: 0,
      createdAt: 1,
      updatedAt: 1
    })
    const image = (name: string, resolvedRepresentation?: unknown) => ({
      name,
      path: `/${name}`,
      mimeType: 'image/png',
      content: 'data:image/png;base64,IMAGE_PAYLOAD',
      thumbnail: 'data:image/png;base64,THUMBNAIL_PAYLOAD',
      resolvedRepresentation
    })
    const messages = [
      record('attachments', 1, 'user', {
        text: 'Review attachments',
        files: [
          image('selected.png', { kind: 'image' }),
          image('skipped.png', {
            kind: 'unavailable',
            reason: 'user_skipped_attachment_content'
          }),
          image('ocr.png', {
            kind: 'ocr_text',
            text: 'Selected OCR <text>',
            tokenCount: 4,
            truncated: false
          }),
          { name: 'path-only.png', path: '/never-read.png', mimeType: 'image/png' },
          {
            name: 'embedded.pdf',
            path: '/embedded.pdf',
            mimeType: 'application/pdf',
            content: 'Selected PDF <text>',
            resolvedRepresentation: { kind: 'embedded_text' }
          },
          {
            name: 'skipped.pdf',
            path: '/skipped.pdf',
            mimeType: 'application/pdf',
            content: 'SKIPPED_PDF_TEXT',
            resolvedRepresentation: {
              kind: 'unavailable',
              reason: 'user_skipped_attachment_content'
            }
          },
          {
            name: 'ocr.pdf',
            path: '/ocr.pdf',
            mimeType: 'application/pdf',
            content: 'UNSELECTED_PDF_TEXT',
            resolvedRepresentation: {
              kind: 'ocr_text',
              text: 'Selected PDF OCR',
              tokenCount: 4,
              truncated: false
            }
          },
          { name: 'raw.wav', path: '/raw.wav', mimeType: 'audio/wav', content: 'RAW_AUDIO' },
          {
            name: 'inline.wav',
            path: '/inline.wav',
            mimeType: 'audio/wav',
            content: 'data:audio/wav;base64,INLINE_AUDIO'
          },
          { name: 'file.txt', path: '/file.txt', content: 'OMITTED_FILE_CONTENT' }
        ]
      }),
      record('assistant', 2, 'assistant', [
        {
          type: 'reasoning_content',
          content: 'Historical reasoning',
          status: 'success',
          timestamp: 1
        },
        { type: 'content', content: 'Historical answer', status: 'success', timestamp: 1 },
        { type: 'error', content: 'Historical error', status: 'error', timestamp: 1 },
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 1,
          content: 'Duplicated result text',
          tool_call: {
            name: 'old_tool',
            id: 'call-123',
            params: '{"path":"old-file"}',
            response: 'Historical result',
            imagePreviews: [{ data: 'TOOL_IMAGE_PAYLOAD' }]
          },
          image_data: { data: 'BLOCK_IMAGE_PAYLOAD', mimeType: 'image/png' }
        },
        {
          type: 'action',
          content: 'ACTIVE_APPROVAL',
          status: 'pending',
          timestamp: 1,
          extra: { needsUserAction: true }
        }
      ]),
      { ...record('plain', 3, 'user', ''), content: 'Legacy plain text' },
      { ...record('plain-assistant', 4, 'assistant', ''), content: 'Legacy assistant text' }
    ]
    const originals = messages.map((message) => message.content)
    const source = new DimLegacySource({
      database: data,
      tape: { getEffectiveViewInputRows: () => [] },
      transcript: { getMessages: () => messages },
      summary: {
        getSummaryState: () => ({
          summaryText: null,
          summaryCursorOrderSeq: 0,
          summaryUpdatedAt: null
        })
      },
      pending: { listPendingInputs: () => [] }
    })
    const snapshot = await source.snapshot('legacy')
    const text = snapshot.contextText!.attachments
    for (const expected of [
      'Review attachments',
      'Selected OCR &lt;text&gt;',
      'Selected PDF &lt;text&gt;',
      'Selected PDF OCR',
      'user_skipped_attachment_content',
      'name: raw.wav',
      'name: path-only.png'
    ])
      expect(text).toContain(expected)
    const context = JSON.stringify(snapshot.contextText)
    for (const excluded of [
      'IMAGE_PAYLOAD',
      'THUMBNAIL_PAYLOAD',
      'SKIPPED_PDF_TEXT',
      'UNSELECTED_PDF_TEXT',
      'RAW_AUDIO',
      'INLINE_AUDIO',
      'OMITTED_FILE_CONTENT',
      'TOOL_IMAGE_PAYLOAD',
      'BLOCK_IMAGE_PAYLOAD',
      'ACTIVE_APPROVAL',
      'Duplicated result text',
      'imagePreviews',
      'image_data'
    ])
      expect(context).not.toContain(excluded)
    expect(snapshot.contextText!.assistant).toBe(
      'reasoning_content: Historical reasoning\n\ncontent: Historical answer\n\nerror: Historical error\n\n' +
        'Historical tool call/result (not executable):\nname: old_tool\nid: call-123\n' +
        'params: {"path":"old-file"}\nresponse: Historical result'
    )
    expect(snapshot.contextText!.plain).toBe('Legacy plain text')
    expect(snapshot.contextText!['plain-assistant']).toBe('content: Legacy assistant text')
    expect(snapshot.images).toBeUndefined()
    expect(legacyImageBlocks(messages)).toEqual({
      attachments: [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'IMAGE_PAYLOAD' } }
      ]
    })
    expect(snapshot.messages.map((message) => message.content)).toEqual(originals)
    expect(messages.map((message) => message.content)).toEqual(originals)
    expect(dimHistoryPlan(await source.snapshot('legacy')).digest).toBe(
      dimHistoryPlan(snapshot).digest
    )
    const withImages = await new DimLegacySource({
      database: data,
      tape: { getEffectiveViewInputRows: () => [] },
      transcript: { getMessages: () => messages },
      summary: {
        getSummaryState: () => ({
          summaryText: null,
          summaryCursorOrderSeq: 0,
          summaryUpdatedAt: null
        })
      },
      pending: { listPendingInputs: () => [] },
      images: async (records) => legacyImageBlocks(records)
    }).snapshot('legacy')
    expect(withImages.contextText).toEqual(snapshot.contextText)
    expect(withImages.messages.map((message) => message.content)).toEqual(originals)
    expect(withImages.images).toEqual(legacyImageBlocks(messages))
  } finally {
    sqlite.close()
  }
})

it('reads valid archived hook states without creating Tape and rejects forged retry identities', () => {
  const { data, sqlite } = dimDatabase()
  try {
    expect(readLegacyPluginHooks(data, 'legacy')).toEqual([])
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tape%'").all()).toEqual(
      []
    )
    const tape = data.deepchatTapeEntriesTable
    sqlite.exec(tape.getCreateTableSQL())
    const identity = ['plugin', 'digest', 'legacy', 'prompt', 'input:old']
    const invocationId = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
    const invocation = {
      invocationId,
      pluginId: 'plugin',
      digest: 'digest',
      sessionId: 'legacy',
      hookId: 'prompt',
      boundaryId: 'input:old',
      messageId: 'old',
      event: 'UserPromptSubmit',
      status: 'started',
      at: 1,
      source: 'old-launch',
      input: {
        sessionId: 'legacy',
        messageId: 'old',
        prompt: 'retry input',
        cwd: null,
        model: 'model'
      }
    }
    tape.appendAnchor({ sessionId: 'legacy', name: 'plugin/context-hook', state: invocation })
    tape.appendAnchor({
      sessionId: 'legacy',
      name: 'plugin/context-hook',
      state: {
        ...invocation,
        invocationId: 'forged',
        input: { ...invocation.input, prompt: 'forged' }
      }
    })
    expect(readLegacyPluginHooks(data, 'legacy')).toEqual([
      expect.objectContaining({
        invocationId,
        status: 'uncertain',
        payload: expect.objectContaining({ prompt: 'retry input' })
      })
    ])
    tape.appendAnchor({
      sessionId: 'legacy',
      name: 'plugin/context-hook',
      state: { ...invocation, status: 'completed', content: 'retained context' }
    })
    const before = tape.getMaxEntryId('legacy')
    expect(readLegacyPluginHooks(data, 'legacy')).toEqual([
      expect.objectContaining({ invocationId, status: 'completed', content: 'retained context' })
    ])
    expect(readLegacyPluginHooks(data, 'legacy')[0].payload).toBeUndefined()
    expect(tape.getMaxEntryId('legacy')).toBe(before)
  } finally {
    sqlite.close()
  }
})
