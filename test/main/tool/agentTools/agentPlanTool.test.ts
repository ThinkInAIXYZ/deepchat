import { describe, expect, it, vi } from 'vitest'
import { AgentPlanTool, UPDATE_PLAN_TOOL_NAME } from '@/tool/agentTools'

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
    expect(result.rawData.toolResult).toEqual({ kind: 'agent_plan' })
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
  })

  it('increments revision and allows an empty plan to clear the checklist', () => {
    const tool = new AgentPlanTool()
    const onProgress = vi.fn()

    tool.call(
      {
        plan: [{ step: 'Start', status: 'in_progress' }]
      },
      'session-1',
      { toolCallId: 'tool-1', onProgress }
    )
    tool.call(
      {
        plan: []
      },
      'session-1',
      { toolCallId: 'tool-2', onProgress }
    )

    expect(onProgress).toHaveBeenLastCalledWith({
      kind: 'agent_plan',
      toolCallId: 'tool-2',
      snapshot: expect.objectContaining({
        revision: 2,
        plan: []
      })
    })
  })

  it('rejects invalid payloads without updating state', () => {
    const tool = new AgentPlanTool()
    const onProgress = vi.fn()

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

    tool.call(
      {
        plan: [{ step: 'Valid', status: 'pending' }]
      },
      'session-1',
      { toolCallId: 'tool-2', onProgress }
    )

    expect(onProgress).toHaveBeenCalledWith({
      kind: 'agent_plan',
      toolCallId: 'tool-2',
      snapshot: expect.objectContaining({
        revision: 1,
        plan: [{ step: 'Valid', status: 'pending' }]
      })
    })
  })

  it('commits dispatch after validation and before mutating plan state', () => {
    const tool = new AgentPlanTool()
    const onProgress = vi.fn()
    const beforeMutation = vi.fn(() => {
      throw new Error('T1 unavailable')
    })

    expect(() =>
      tool.call({ plan: [{ step: 'Blocked', status: 'pending' }] }, 'session-1', {
        toolCallId: 'tool-1',
        onProgress,
        beforeMutation
      })
    ).toThrow('T1 unavailable')

    expect(beforeMutation).toHaveBeenCalledWith({
      plan: [{ step: 'Blocked', status: 'pending' }]
    })
    expect(onProgress).not.toHaveBeenCalled()

    tool.call({ plan: [{ step: 'Committed', status: 'pending' }] }, 'session-1', {
      toolCallId: 'tool-2',
      onProgress
    })
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ revision: 1 }) })
    )
  })

  it('clears session state so revisions restart for that session', () => {
    const tool = new AgentPlanTool()
    const onProgress = vi.fn()

    tool.call({ plan: [{ step: 'Start', status: 'pending' }] }, 'session-1', {
      toolCallId: 'tool-1',
      onProgress
    })
    tool.clearState('session-1')
    tool.call({ plan: [{ step: 'Restart', status: 'pending' }] }, 'session-1', {
      toolCallId: 'tool-2',
      onProgress
    })

    expect(onProgress).toHaveBeenLastCalledWith({
      kind: 'agent_plan',
      toolCallId: 'tool-2',
      snapshot: expect.objectContaining({
        revision: 1,
        plan: [{ step: 'Restart', status: 'pending' }]
      })
    })
  })

  it('rejects calls without a tool call ID', () => {
    const tool = new AgentPlanTool()
    const onProgress = vi.fn()

    expect(() =>
      tool.call(
        {
          plan: [{ step: 'Start', status: 'in_progress' }]
        },
        'session-1'
      )
    ).toThrow('update_plan requires a tool call ID')

    tool.call({ plan: [{ step: 'Start', status: 'in_progress' }] }, 'session-1', {
      toolCallId: 'tool-1',
      onProgress
    })

    expect(onProgress).toHaveBeenCalledWith({
      kind: 'agent_plan',
      toolCallId: 'tool-1',
      snapshot: expect.objectContaining({
        revision: 1,
        plan: [{ step: 'Start', status: 'in_progress' }]
      })
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
