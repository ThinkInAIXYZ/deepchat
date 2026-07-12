import { estimateTokens, estimateTokenWeight } from '@/presenter/memoryPresenter/core/injectionPort'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

export const MEMORY_EXTRACTION_CHUNK_TOKEN_LIMIT = 4_000
export const MEMORY_EXTRACTION_CHUNK_CHAR_LIMIT = 12_000
export const MEMORY_EXTRACTION_CHUNKS_PER_QUEUE_TASK = 4

export interface MemoryExtractionMessage {
  orderSeq: number
  entryId: number
  role: 'user' | 'assistant'
  text: string
}

export interface MemoryExtractionFragment {
  orderSeq: number
  entryId: number
  fragmentIndex: number
  isFinalFragment: boolean
}

export interface MemoryExtractionChunk {
  text: string
  sourceEntryIds: number[]
  cursorCommitOrderSeq: number | null
  coveredThroughOrderSeq: number
  fragments: MemoryExtractionFragment[]
}

type RenderedFragment = MemoryExtractionFragment & { text: string }

function fitsBudget(value: string): boolean {
  return (
    unicodeCodePointLength(value) <= MEMORY_EXTRACTION_CHUNK_CHAR_LIMIT &&
    estimateTokens(value) <= MEMORY_EXTRACTION_CHUNK_TOKEN_LIMIT
  )
}

function fragmentPrefix(role: MemoryExtractionMessage['role'], fragmentIndex?: number): string {
  const label = role === 'user' ? 'User' : 'Assistant'
  return fragmentIndex === undefined ? `${label}: ` : `${label} [fragment ${fragmentIndex + 1}]: `
}

function* segmentText(value: string): Iterable<string> {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const segment of segmenter.segment(value)) yield segment.segment
    return
  }
  for (const codePoint of value) yield codePoint
}

function renderMessageFragments(message: MemoryExtractionMessage): RenderedFragment[] {
  const whole = `${fragmentPrefix(message.role)}${message.text}`
  if (fitsBudget(whole)) {
    return [
      {
        orderSeq: message.orderSeq,
        entryId: message.entryId,
        fragmentIndex: 0,
        isFinalFragment: true,
        text: whole
      }
    ]
  }

  const fragments: RenderedFragment[] = []
  let parts: string[] = []
  let contentCodePoints = 0
  let contentTokenWeight = 0

  const flush = (): void => {
    if (parts.length === 0) return
    const fragmentIndex = fragments.length
    const prefix = fragmentPrefix(message.role, fragmentIndex)
    fragments.push({
      orderSeq: message.orderSeq,
      entryId: message.entryId,
      fragmentIndex,
      isFinalFragment: false,
      text: `${prefix}${parts.join('')}`
    })
    parts = []
    contentCodePoints = 0
    contentTokenWeight = 0
  }

  const appendUnit = (unit: string): void => {
    const fragmentIndex = fragments.length
    const prefix = fragmentPrefix(message.role, fragmentIndex)
    const prefixCodePoints = unicodeCodePointLength(prefix)
    const prefixTokenWeight = estimateTokenWeight(prefix)
    const unitCodePoints = unicodeCodePointLength(unit)
    const unitTokenWeight = estimateTokenWeight(unit)
    const fits =
      prefixCodePoints + contentCodePoints + unitCodePoints <= MEMORY_EXTRACTION_CHUNK_CHAR_LIMIT &&
      Math.ceil(prefixTokenWeight + contentTokenWeight + unitTokenWeight) <=
        MEMORY_EXTRACTION_CHUNK_TOKEN_LIMIT

    if (fits) {
      parts.push(unit)
      contentCodePoints += unitCodePoints
      contentTokenWeight += unitTokenWeight
      return
    }
    if (parts.length > 0) {
      flush()
      appendUnit(unit)
      return
    }

    const codePoints = Array.from(unit)
    if (codePoints.length === 1) {
      throw new Error('[Memory] extraction fragment label exceeds the configured chunk budget')
    }
    for (const codePoint of codePoints) appendUnit(codePoint)
  }

  for (const segment of segmentText(message.text)) appendUnit(segment)
  flush()
  if (fragments.length > 0) fragments[fragments.length - 1].isFinalFragment = true
  return fragments
}

function buildChunk(fragments: readonly RenderedFragment[]): MemoryExtractionChunk {
  const finalFragments = fragments.filter((fragment) => fragment.isFinalFragment)
  return {
    text: fragments.map((fragment) => fragment.text).join('\n'),
    sourceEntryIds: [...new Set(fragments.map((fragment) => fragment.entryId))],
    cursorCommitOrderSeq: finalFragments.length
      ? Math.max(...finalFragments.map((fragment) => fragment.orderSeq))
      : null,
    coveredThroughOrderSeq: Math.max(...fragments.map((fragment) => fragment.orderSeq)),
    fragments: fragments.map(({ text: _text, ...fragment }) => fragment)
  }
}

export function buildMemoryExtractionChunks(
  messages: readonly MemoryExtractionMessage[]
): MemoryExtractionChunk[] {
  const chunks: MemoryExtractionChunk[] = []
  let pending: RenderedFragment[] = []

  const flush = () => {
    if (pending.length === 0) return
    chunks.push(buildChunk(pending))
    pending = []
  }

  for (const message of messages) {
    for (const fragment of renderMessageFragments(message)) {
      const candidate = [...pending, fragment].map((item) => item.text).join('\n')
      if (pending.length > 0 && !fitsBudget(candidate)) flush()
      pending.push(fragment)
      if (!fitsBudget(pending.map((item) => item.text).join('\n'))) {
        throw new Error('[Memory] extraction fragment exceeds the configured chunk budget')
      }
    }
  }
  flush()
  const lastChunkByOrderSeq = new Map<number, number>()
  chunks.forEach((chunk, chunkIndex) => {
    chunk.fragments.forEach((fragment) => lastChunkByOrderSeq.set(fragment.orderSeq, chunkIndex))
  })
  chunks.forEach((chunk, chunkIndex) => {
    const completedOrderSeqs = [
      ...new Set(
        chunk.fragments
          .filter((fragment) => lastChunkByOrderSeq.get(fragment.orderSeq) === chunkIndex)
          .map((fragment) => fragment.orderSeq)
      )
    ]
    chunk.cursorCommitOrderSeq = completedOrderSeqs.length ? Math.max(...completedOrderSeqs) : null
  })
  return chunks
}
