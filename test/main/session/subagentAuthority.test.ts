import { describe, expect, it } from 'vitest'
import { composeSubagentAuthority } from '@/session/subagentAuthority'

describe('Subagent authority composition', () => {
  it('unions built-in restrictions and intersects MCP allowlists deterministically', () => {
    expect(
      composeSubagentAuthority(
        {
          disabledAgentTools: ['write', 'read'],
          enabledMcpServerIds: ['server-b', 'server-a']
        },
        {
          disabledAgentTools: ['exec', 'write'],
          enabledMcpServerIds: ['server-b', 'server-c']
        }
      )
    ).toEqual({
      disabledAgentTools: ['exec', 'read', 'write'],
      enabledMcpServerIds: ['server-b']
    })
  })

  it('treats missing MCP lists as unrestricted and empty lists as deny-all', () => {
    expect(
      composeSubagentAuthority(
        { enabledMcpServerIds: undefined },
        { enabledMcpServerIds: ['server-b', 'server-a'] }
      ).enabledMcpServerIds
    ).toEqual(['server-a', 'server-b'])
    expect(
      composeSubagentAuthority({ enabledMcpServerIds: null }, { enabledMcpServerIds: undefined })
        .enabledMcpServerIds
    ).toBeUndefined()
    expect(
      composeSubagentAuthority({ enabledMcpServerIds: ['server-a'] }, { enabledMcpServerIds: [] })
        .enabledMcpServerIds
    ).toEqual([])
  })

  it('is order-independent and idempotent across authority boundaries', () => {
    const sources = [
      {
        disabledAgentTools: ['read', 'write'],
        enabledMcpServerIds: ['server-a', 'server-b']
      },
      {
        disabledAgentTools: ['exec'],
        enabledMcpServerIds: ['server-b', 'server-c']
      },
      {
        disabledAgentTools: ['write'],
        enabledMcpServerIds: undefined
      }
    ]
    const expected = composeSubagentAuthority(...sources)

    expect(composeSubagentAuthority(...[...sources].reverse())).toEqual(expected)
    expect(composeSubagentAuthority(...sources, ...sources)).toEqual(expected)
  })
})
