import { describe, expect, it } from 'vitest'
import {
  intersectSubagentMcpAllowLists,
  mergeSubagentToolRestrictions
} from '@/session/subagentAuthority'

describe('Subagent authority composition', () => {
  it('unions built-in restrictions deterministically', () => {
    expect(mergeSubagentToolRestrictions(['write', 'read'], ['exec', 'write'])).toEqual([
      'exec',
      'read',
      'write'
    ])
  })

  it('treats missing MCP lists as unrestricted and empty lists as deny-all', () => {
    expect(intersectSubagentMcpAllowLists(undefined, ['server-b', 'server-a'])).toEqual([
      'server-a',
      'server-b'
    ])
    expect(intersectSubagentMcpAllowLists(null, undefined)).toBeUndefined()
    expect(intersectSubagentMcpAllowLists(['server-a'], [])).toEqual([])
    expect(
      intersectSubagentMcpAllowLists(['server-a', 'server-b'], ['server-b', 'server-c'])
    ).toEqual(['server-b'])
  })
})
