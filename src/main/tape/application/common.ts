import { createHash } from 'crypto'
import type { DeepChatTapeReplaySlice } from '@shared/types/tape-replay'

export function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

export function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function collectEntryIds(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number'))].sort(
    (left, right) => left - right
  )
}

export function isEntryIdPrefix(prefix: number[], values: number[]): boolean {
  if (prefix.length > values.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== values[index]) return false
  }
  return true
}

export function migrationProvenanceKey(sessionId: string): string {
  return `migration:${sessionId}:message-backfill:v1`
}

export function withReplaySliceHash(
  slice: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
    hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
  },
  hashJson: (value: unknown) => string
): DeepChatTapeReplaySlice {
  const sliceForHash = { ...slice } as Partial<DeepChatTapeReplaySlice>
  delete sliceForHash.createdAt
  delete sliceForHash.integrity
  return {
    ...slice,
    hashes: {
      ...slice.hashes,
      sliceHash: hashJson(sliceForHash)
    }
  }
}
