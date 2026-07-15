import { describe, expect, it } from 'vitest'

import {
  MEMORY_EXTRACTION_CHUNK_CHAR_LIMIT,
  MEMORY_EXTRACTION_CHUNK_TOKEN_LIMIT,
  buildMemoryExtractionChunks
} from '@/agent/deepchat/memory/memoryExtractionChunks'
import { estimateTokens } from '@/memory/core/injectionPort'

describe('buildMemoryExtractionChunks', () => {
  it('packs complete messages in order with exact lineage', () => {
    const chunks = buildMemoryExtractionChunks([
      { orderSeq: 1, entryId: 11, role: 'user', text: 'Prefer concise answers.' },
      { orderSeq: 2, entryId: 12, role: 'assistant', text: 'Understood.' }
    ])

    expect(chunks).toEqual([
      {
        text: 'User: Prefer concise answers.\nAssistant: Understood.',
        sourceEntryIds: [11, 12],
        cursorCommitOrderSeq: 2,
        coveredThroughOrderSeq: 2,
        fragments: [
          { orderSeq: 1, entryId: 11, fragmentIndex: 0, isFinalFragment: true },
          { orderSeq: 2, entryId: 12, fragmentIndex: 0, isFinalFragment: true }
        ]
      }
    ])
  })

  it('uses the CJK-aware token budget before the character hard limit', () => {
    const chunks = buildMemoryExtractionChunks([
      { orderSeq: 1, entryId: 1, role: 'user', text: '记'.repeat(8_000) }
    ])

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(MEMORY_EXTRACTION_CHUNK_TOKEN_LIMIT)
      expect(Array.from(chunk.text).length).toBeLessThanOrEqual(MEMORY_EXTRACTION_CHUNK_CHAR_LIMIT)
    }
  })

  it('does not commit an oversized message until its final Unicode-safe fragment', () => {
    const content = `${'😀'.repeat(15_000)}e\u0301`
    const chunks = buildMemoryExtractionChunks([
      { orderSeq: 7, entryId: 70, role: 'assistant', text: content }
    ])

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.slice(0, -1).every((chunk) => chunk.cursorCommitOrderSeq === null)).toBe(true)
    expect(chunks.at(-1)?.cursorCommitOrderSeq).toBe(7)
    expect(chunks.flatMap((chunk) => chunk.sourceEntryIds)).toEqual(
      Array.from({ length: chunks.length }, () => 70)
    )
    expect(chunks.map((chunk) => chunk.text).join('')).not.toContain('\ud83d\n')
  })

  it('treats every message sharing an order sequence as one cursor commit group', () => {
    const chunks = buildMemoryExtractionChunks([
      { orderSeq: 7, entryId: 70, role: 'user', text: '记'.repeat(8_000) },
      { orderSeq: 7, entryId: 71, role: 'assistant', text: '忆'.repeat(8_000) }
    ])

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.slice(0, -1).every((chunk) => chunk.cursorCommitOrderSeq === null)).toBe(true)
    expect(chunks.at(-1)?.cursorCommitOrderSeq).toBe(7)
  })

  it('flushes on message boundaries when the next complete message does not fit', () => {
    const chunks = buildMemoryExtractionChunks([
      { orderSeq: 1, entryId: 1, role: 'user', text: 'a'.repeat(11_500) },
      { orderSeq: 2, entryId: 2, role: 'assistant', text: 'b'.repeat(1_000) }
    ])

    expect(chunks).toHaveLength(2)
    expect(chunks[0].sourceEntryIds).toEqual([1])
    expect(chunks[1].sourceEntryIds).toEqual([2])
  })

  it('splits a one-megabyte mixed Unicode message without losing code points or lineage', () => {
    const content = `${'a'.repeat(300_000)}${'记'.repeat(100_000)}${'😀'.repeat(100_000)}`
    const startedAt = performance.now()
    const chunks = buildMemoryExtractionChunks([
      { orderSeq: 9, entryId: 90, role: 'user', text: content }
    ])
    const restored = chunks
      .map((chunk) => chunk.text.replace(/^User(?: \[fragment \d+\])?: /u, ''))
      .join('')

    expect(Buffer.byteLength(content, 'utf8')).toBe(1_000_000)
    expect(restored).toBe(content)
    expect(chunks.every((chunk) => chunk.sourceEntryIds.length === 1)).toBe(true)
    expect(chunks.at(-1)?.cursorCommitOrderSeq).toBe(9)
    expect(performance.now() - startedAt).toBeLessThan(10_000)
  }, 15_000)
})
