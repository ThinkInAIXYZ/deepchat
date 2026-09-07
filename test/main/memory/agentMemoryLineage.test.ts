import { describe, expect, it } from 'vitest'

import {
  parseAgentMemorySourceEntryIds,
  serializeAgentMemorySourceEntryIds
} from '@shared/lib/agentMemoryLineage'

describe('agent memory lineage codec', () => {
  it('filters invalid values and preserves stable unique order', () => {
    const raw = JSON.stringify([3, -1, 2, 3, '4', Number.MAX_SAFE_INTEGER + 1, 0])

    expect(parseAgentMemorySourceEntryIds(raw)).toEqual([3, 2, 0])
    expect(serializeAgentMemorySourceEntryIds([3, -1, 2, 3, '4', 0])).toBe('[3,2,0]')
  })

  it('returns null for malformed or empty lineage', () => {
    expect(parseAgentMemorySourceEntryIds(null)).toBeNull()
    expect(parseAgentMemorySourceEntryIds('not-json')).toBeNull()
    expect(parseAgentMemorySourceEntryIds('{}')).toBeNull()
    expect(parseAgentMemorySourceEntryIds('[-1,"x"]')).toBeNull()
    expect(serializeAgentMemorySourceEntryIds([])).toBeNull()
  })
})
