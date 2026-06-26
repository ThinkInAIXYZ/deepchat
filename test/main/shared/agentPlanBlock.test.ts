import { describe, expect, it } from 'vitest'
import { snapshotFromAgentPlanBlock } from '@shared/types/agent-plan-block'

describe('snapshotFromAgentPlanBlock', () => {
  it('hydrates a persisted plan block into a live snapshot', () => {
    expect(
      snapshotFromAgentPlanBlock('s1', 'm1', {
        type: 'plan',
        content: 'Current plan',
        extra: {
          plan_entries: [
            { step: 'Inspect runtime', status: 'completed' },
            { step: 'Patch store', status: 'in_progress' }
          ],
          plan_revision: 3,
          plan_updated_at: '2026-05-18T00:00:00.000Z',
          plan_terminal_reason: 'error'
        }
      })
    ).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      plan: [
        { step: 'Inspect runtime', status: 'completed' },
        { step: 'Patch store', status: 'in_progress' }
      ],
      explanation: 'Current plan',
      revision: 3,
      updatedAt: '2026-05-18T00:00:00.000Z',
      terminalReason: 'error'
    })
  })

  it('falls back revision and updatedAt when optional metadata is missing', () => {
    const snapshot = snapshotFromAgentPlanBlock('s1', 'm1', {
      type: 'plan',
      extra: {
        plan_entries: [{ content: 'Legacy entry', status: 'done' }]
      }
    })

    expect(snapshot).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Legacy entry', status: 'completed' }],
      revision: 1,
      updatedAt: new Date(0).toISOString()
    })
  })

  it('ignores non-plan blocks and empty plan blocks', () => {
    expect(
      snapshotFromAgentPlanBlock('s1', 'm1', {
        type: 'content',
        content: 'No plan'
      })
    ).toBeNull()
    expect(
      snapshotFromAgentPlanBlock('s1', 'm1', {
        type: 'plan',
        extra: {
          plan_entries: []
        }
      })
    ).toBeNull()
  })
})
