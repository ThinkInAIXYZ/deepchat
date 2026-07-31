import { describe, expect, it } from 'vitest'
import { isSavedWorkflowSupported } from '@/lib/workflowSupport'

describe('isSavedWorkflowSupported', () => {
  const session = {
    id: 'session-1',
    agentId: 'agent-1',
    sessionKind: 'regular'
  }

  it('uses Agent kind instead of provider identity for the compatibility boundary', () => {
    expect(
      isSavedWorkflowSupported(session, session.id, [
        {
          id: 'agent-1',
          type: 'deepchat',
          agentType: 'deepchat'
        }
      ])
    ).toBe(true)
    expect(
      isSavedWorkflowSupported(session, session.id, [
        {
          id: 'agent-1',
          type: 'acp',
          agentType: 'acp'
        }
      ])
    ).toBe(false)
  })

  it('rejects child sessions and mismatched active sessions', () => {
    expect(isSavedWorkflowSupported({ ...session, sessionKind: 'subagent' }, session.id, [])).toBe(
      false
    )
    expect(isSavedWorkflowSupported(session, 'session-2', [])).toBe(false)
  })
})
