import { describe, it, expect } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { AcpContentMapper } from '@/presenter/llmProviderPresenter/acp/acpContentMapper'

const createNotification = <T extends schema.SessionNotification['update']>(
  sessionId: string,
  update: T
): schema.SessionNotification => ({
  sessionId,
  update
})

describe('AcpContentMapper tool call handling', () => {
  it('emits tool call start/chunk/end events for ACP fragments', () => {
    const mapper = new AcpContentMapper()
    const toolCallId = 'tool-1'

    const start = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: 'write_file',
        status: 'in_progress',
        rawInput: { path: '/tmp' }
      })
    )

    const startEvent = start.events.find((event) => event.type === 'tool_call_start')
    expect(startEvent).toMatchObject({
      type: 'tool_call_start',
      tool_call_id: toolCallId,
      tool_call_name: 'write_file'
    })

    const chunkEvent = start.events.find((event) => event.type === 'tool_call_chunk')
    expect(chunkEvent).toMatchObject({
      type: 'tool_call_chunk',
      tool_call_id: toolCallId,
      tool_call_arguments_chunk: '{"path":"/tmp"}'
    })

    const completion = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed'
      })
    )

    const endEvent = completion.events.find((event) => event.type === 'tool_call_end')
    expect(endEvent).toMatchObject({
      type: 'tool_call_end',
      tool_call_id: toolCallId,
      tool_call_arguments_complete: '{"path":"/tmp"}'
    })
  })

  it('tracks tool call state per session to avoid id collisions', () => {
    const mapper = new AcpContentMapper()

    const first = mapper.map(
      createNotification('session-a', {
        sessionUpdate: 'tool_call',
        toolCallId: 'shared-id',
        title: 'list_files',
        status: 'in_progress'
      })
    )

    const second = mapper.map(
      createNotification('session-b', {
        sessionUpdate: 'tool_call',
        toolCallId: 'shared-id',
        title: 'write_file',
        status: 'in_progress'
      })
    )

    const firstStart = first.events.find((event) => event.type === 'tool_call_start')
    const secondStart = second.events.find((event) => event.type === 'tool_call_start')

    expect(firstStart).toBeTruthy()
    expect(secondStart).toBeTruthy()
    expect(firstStart && firstStart.tool_call_name).toBe('list_files')
    expect(secondStart && secondStart.tool_call_name).toBe('write_file')
  })
})

describe('AcpContentMapper plan handling', () => {
  it('emits structured plan entries', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Analyze requirements', status: 'completed', priority: 'high' },
          { content: 'Implement feature', status: 'in_progress', priority: 'high' },
          { content: 'Write tests', status: 'pending', priority: 'medium' }
        ]
      })
    )

    expect(result.planEntries).toHaveLength(3)
    expect(result.planEntries![0]).toMatchObject({
      content: 'Analyze requirements',
      status: 'completed',
      priority: 'high'
    })
    expect(result.planEntries![1]).toMatchObject({
      content: 'Implement feature',
      status: 'in_progress'
    })
  })

  it('emits a plan block alongside the structured plan entries', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Step 1', status: 'completed' },
          { content: 'Step 2', status: 'in_progress' }
        ]
      })
    )

    const reasoningEvent = result.events.find((e) => e.type === 'reasoning')
    expect(reasoningEvent).toBeTruthy()
    expect(reasoningEvent?.reasoning_content).toBe('')

    const planBlock = result.blocks.find((block) => block.type === 'plan')
    expect(planBlock?.extra).toMatchObject({
      plan_entries: [
        { content: 'Step 1', status: 'completed', priority: null },
        { content: 'Step 2', status: 'in_progress', priority: null }
      ]
    })
  })

  it('preserves plan entry statuses in the structured payload', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Done task', status: 'completed' },
          { content: 'Current task', status: 'in_progress' },
          { content: 'Future task', status: 'pending' }
        ]
      })
    )

    expect(result.planEntries).toEqual([
      { content: 'Done task', status: 'completed', priority: null },
      { content: 'Current task', status: 'in_progress', priority: null },
      { content: 'Future task', status: 'pending', priority: null }
    ])
  })

  it('handles empty plan entries gracefully', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: []
      })
    )

    expect(result.planEntries).toBeUndefined()
    expect(result.events).toHaveLength(0)
  })
})

describe('AcpContentMapper mode handling', () => {
  it('emits mode change with currentModeId', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'architect'
      })
    )

    expect(result.currentModeId).toBe('architect')
  })

  it('emits reasoning event for mode change', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'code'
      })
    )

    const reasoningEvent = result.events.find((e) => e.type === 'reasoning')
    expect(reasoningEvent).toBeTruthy()
    expect(reasoningEvent?.reasoning_content).toContain('Mode changed to: code')
  })

  it('stores mode change in block extra data', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'ask'
      })
    )

    const block = result.blocks.find((b) => b.type === 'reasoning_content')
    expect(block?.extra).toMatchObject({ mode_change: 'ask' })
  })
})

describe('AcpContentMapper available commands handling', () => {
  it('normalizes available commands from ACP updates', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          {
            name: ' review ',
            description: ' Run review ',
            input: { hint: 'ticket id' }
          },
          {
            name: 'plan',
            description: ''
          }
        ]
      })
    )

    expect(result.availableCommands).toEqual([
      {
        name: 'review',
        description: 'Run review',
        input: { hint: 'ticket id' }
      },
      {
        name: 'plan',
        description: '',
        input: null
      }
    ])
  })
})

describe('AcpContentMapper config options handling', () => {
  it('normalizes config_option_update payloads into config state', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'gpt-5',
            options: [
              { value: 'gpt-5', name: 'gpt-5' },
              { value: 'gpt-5-mini', name: 'gpt-5-mini' }
            ]
          },
          {
            id: 'safe_edits',
            name: 'Safe Edits',
            type: 'boolean',
            currentValue: true
          }
        ]
      })
    )

    expect(result.configState).toEqual({
      source: 'configOptions',
      options: [
        {
          id: 'model',
          label: 'Model',
          description: null,
          category: 'model',
          type: 'select',
          currentValue: 'gpt-5',
          options: [
            {
              value: 'gpt-5',
              label: 'gpt-5',
              description: null,
              groupId: null,
              groupLabel: null
            },
            {
              value: 'gpt-5-mini',
              label: 'gpt-5-mini',
              description: null,
              groupId: null,
              groupLabel: null
            }
          ]
        },
        {
          id: 'safe_edits',
          label: 'Safe Edits',
          description: null,
          type: 'boolean',
          category: null,
          currentValue: true
        }
      ]
    })
    expect(result.events).toHaveLength(0)
  })
})
