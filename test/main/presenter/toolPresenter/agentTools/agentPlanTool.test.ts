import { describe, expect, it, vi } from 'vitest'
import { AgentPlanTool, UPDATE_PLAN_TOOL_NAME } from '@/presenter/toolPresenter/agentTools'

describe('AgentPlanTool', () => {
  it('updates session plan state and emits a progress snapshot', () => {
    const tool = new AgentPlanTool()
    const onProgress = vi.fn()

    const result = tool.call(
      {
        explanation: 'Repo inspected',
        plan: [
          { step: ' Inspect current runtime ', status: 'completed' },
          { step: 'Implement handler', status: 'in_progress' },
          { step: 'Add tests', status: 'pending' }
        ]
      },
      'session-1',
      {
        toolCallId: 'tool-1',
        onProgress
      }
    )

    expect(result.content).toBe('{}')
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent_plan',
        toolCallId: 'tool-1',
        snapshot: expect.objectContaining({
          sessionId: 'session-1',
          toolCallId: 'tool-1',
          explanation: 'Repo inspected',
          revision: 1,
          plan: [
            { step: 'Inspect current runtime', status: 'completed' },
            { step: 'Implement handler', status: 'in_progress' },
            { step: 'Add tests', status: 'pending' }
          ]
        })
      })
    )
    expect(tool.getState('session-1')).toMatchObject({
      revision: 1,
      current: {
        explanation: 'Repo inspected',
        plan: [
          { step: 'Inspect current runtime', status: 'completed' },
          { step: 'Implement handler', status: 'in_progress' },
          { step: 'Add tests', status: 'pending' }
        ]
      }
    })
  })

  it('increments revision and allows an empty plan to clear the checklist', () => {
    const tool = new AgentPlanTool()

    tool.call(
      {
        plan: [{ step: 'Start', status: 'in_progress' }]
      },
      'session-1',
      { toolCallId: 'tool-1' }
    )
    tool.call(
      {
        plan: []
      },
      'session-1',
      { toolCallId: 'tool-2' }
    )

    expect(tool.getState('session-1')).toMatchObject({
      revision: 2,
      current: {
        plan: []
      }
    })
  })

  it('rejects invalid payloads without updating state', () => {
    const tool = new AgentPlanTool()

    expect(() =>
      tool.call(
        {
          plan: [
            { step: 'A', status: 'in_progress' },
            { step: 'B', status: 'in_progress' }
          ]
        },
        'session-1',
        { toolCallId: 'tool-1' }
      )
    ).toThrow('at most one step can be in_progress')

    expect(() =>
      tool.call(
        {
          plan: [{ step: '   ', status: 'pending' }]
        },
        'session-1',
        { toolCallId: 'tool-1' }
      )
    ).toThrow('step must be a non-empty string')

    expect(() =>
      tool.call(
        {
          plan: [{ step: 'A', status: 'pending', owner: 'user' }]
        },
        'session-1',
        { toolCallId: 'tool-1' }
      )
    ).toThrow('Unrecognized key')

    expect(tool.getState('session-1')).toMatchObject({
      revision: 0,
      current: null
    })
  })

  it('exposes a strict update_plan tool definition in the core group', () => {
    const tool = new AgentPlanTool()
    const definition = tool.getToolDefinition()

    expect(definition.function.name).toBe(UPDATE_PLAN_TOOL_NAME)
    expect(definition.server.name).toBe('agent-core')
    expect(definition.function.description).toContain('complete current plan snapshot')
  })
})
