import { expect, it, vi } from 'vitest'
import type { DimContent } from '@/agent/dim/content'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { DimMemoryEvidence } from '@/agent/dim/memoryEvidence'
import { dimDatabase } from './fixtures/database'

it('reads an owned closed generation at its immutable cutoff and rejects another session', async () => {
  const database = dimDatabase()
  const old = database.data.dimSessionBindingsTable.bind('product', 'old-native')
  database.data.dimSessionBindingsTable.replace(old, {
    ...old,
    dimSessionId: 'current-native',
    generation: 2
  })
  const source = {
    kind: 'dim' as const,
    sessionId: 'old-native',
    branchId: 'main',
    through: '9007199254740993',
    messageId: 'message'
  }
  const record: ChatMessageRecord = {
    id: 'message',
    sessionId: 'product',
    orderSeq: 1,
    role: 'user',
    content: '{"text":"immutable evidence"}',
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: 1,
    updatedAt: 1
  }
  const transcript = vi.fn<DimContent['transcript']>(async () => ({
    messages: [record],
    through: source.through,
    summary: null,
    contextFromOrderSeq: 1,
    pendingInputs: [],
    excludedContextMessageIds: [],
    images: {}
  }))
  const evidence = new DimMemoryEvidence({ database: database.data, content: { transcript } })
  try {
    await expect(evidence.read('other-product', [source])).rejects.toThrow(
      'another desktop session'
    )
    expect(transcript).not.toHaveBeenCalled()
    expect(await evidence.read('product', [source, { ...source }])).toEqual([
      { timeline: source, record }
    ])
    expect(transcript).toHaveBeenCalledTimes(1)
    expect(transcript).toHaveBeenCalledWith(
      { sessionId: 'old-native', branchId: 'main' },
      'product',
      '9007199254740993'
    )
  } finally {
    database.sqlite.close()
  }
})
