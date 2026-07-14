import { describe, it, expect } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import {
  AcpContentMapper,
  mapAcpPromptStopReason
} from '@/agent/acp/runtime/acpContentMapper'

const createNotification = <T extends schema.SessionNotification['update']>(
  sessionId: string,
  update: T
): schema.SessionNotification => ({
  sessionId,
  update
})

describe('ACP prompt stop reason mapping', () => {
  it.each([
    ['end_turn', 'complete'],
    ['max_tokens', 'max_tokens'],
    ['max_turn_requests', 'stop_sequence'],
    ['cancelled', 'error'],
    ['refusal', 'error']
  ] as const)('maps %s to %s', (input, expected) => {
    expect(mapAcpPromptStopReason(input)).toBe(expected)
  })
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

    expect(
      start.blocks.some(
        (block) => block.type === 'action' && block.action_type === 'tool_call_permission'
      )
    ).toBe(false)
    expect(start.events.some((event) => event.type === 'reasoning')).toBe(true)

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

    expect(
      completion.blocks.some(
        (block) => block.type === 'action' && block.action_type === 'tool_call_permission'
      )
    ).toBe(false)
    expect(completion.events.some((event) => event.type === 'reasoning')).toBe(true)

    const endEvent = completion.events.find((event) => event.type === 'tool_call_end')
    expect(endEvent).toMatchObject({
      type: 'tool_call_end',
      tool_call_id: toolCallId,
      tool_call_arguments_complete: '{"path":"/tmp"}'
    })
  })

  it('keeps raw input as params and projects raw output as the tool result', () => {
    const mapper = new AcpContentMapper()

    mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-result',
        title: 'glob',
        status: 'in_progress',
        rawInput: { pattern: '**/*' }
      })
    )
    const completion = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-result',
        status: 'completed',
        rawOutput: { files: ['README.md'] }
      })
    )

    expect(completion.events.find((event) => event.type === 'tool_call_end')).toMatchObject({
      type: 'tool_call_end',
      tool_call_id: 'tool-result',
      tool_call_arguments_complete: '{"pattern":"**/*"}',
      tool_call_response: '{"files":["README.md"]}',
      tool_call_status: 'success'
    })
  })

  it('projects terminal and diff content when raw output is absent', () => {
    const mapper = new AcpContentMapper((terminalId) =>
      terminalId === 'terminal-1'
        ? { output: 'README.md\r\n', truncated: false, exitStatus: { exitCode: 0 } }
        : null
    )

    const completion = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-content',
        title: 'exec',
        status: 'completed',
        content: [
          { type: 'terminal', terminalId: 'terminal-1' },
          {
            type: 'diff',
            path: '/tmp/file.txt',
            oldText: 'before',
            newText: 'after'
          }
        ]
      })
    )

    const end = completion.events.find((event) => event.type === 'tool_call_end')
    expect(end).toMatchObject({
      type: 'tool_call_end',
      tool_call_status: 'success'
    })
    expect(end?.type === 'tool_call_end' ? end.tool_call_response : '').toContain('README.md')
    expect(end?.type === 'tool_call_end' ? end.tool_call_response : '').toContain(
      'diff: /tmp/file.txt\n--- before\nbefore\n+++ after\nafter'
    )
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

  it('clears pending tool call state for a session', () => {
    const mapper = new AcpContentMapper()

    mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call',
        toolCallId: 'shared-id',
        title: 'first_tool',
        status: 'in_progress'
      })
    )
    mapper.clearSession('session-1')

    const restarted = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call',
        toolCallId: 'shared-id',
        title: 'second_tool',
        status: 'in_progress'
      })
    )

    expect(restarted.events.find((event) => event.type === 'tool_call_start')).toMatchObject({
      type: 'tool_call_start',
      tool_call_id: 'shared-id',
      tool_call_name: 'second_tool'
    })
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
      step: 'Analyze requirements',
      status: 'completed',
      priority: 'high'
    })
    expect(result.planEntries![1]).toMatchObject({
      step: 'Implement feature',
      status: 'in_progress'
    })
  })

  it('emits a plan event without adding content blocks', () => {
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

    const planEvent = result.events.find((e) => e.type === 'plan')
    expect(planEvent).toMatchObject({
      type: 'plan',
      plan: [
        { step: 'Step 1', status: 'completed' },
        { step: 'Step 2', status: 'in_progress' }
      ],
      revision: 1
    })

    expect(result.blocks.some((block) => block.type === 'plan')).toBe(false)
  })

  it('increments plan revisions for successive updates in the same session', () => {
    const mapper = new AcpContentMapper()

    const first = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [{ content: 'Step 1', status: 'in_progress' }]
      })
    )
    const second = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [{ content: 'Step 1', status: 'completed' }]
      })
    )

    expect(first.events.find((event) => event.type === 'plan')).toMatchObject({ revision: 1 })
    expect(second.events.find((event) => event.type === 'plan')).toMatchObject({ revision: 2 })
  })

  it('clears per-session plan revisions without affecting other sessions', () => {
    const mapper = new AcpContentMapper()

    mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [{ content: 'Step 1', status: 'in_progress' }]
      })
    )
    mapper.map(
      createNotification('session-2', {
        sessionUpdate: 'plan',
        entries: [{ content: 'Other step', status: 'in_progress' }]
      })
    )
    mapper.clearSession('session-1')

    const reset = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'plan',
        entries: [{ content: 'Next step', status: 'in_progress' }]
      })
    )
    const preserved = mapper.map(
      createNotification('session-2', {
        sessionUpdate: 'plan',
        entries: [{ content: 'Other step', status: 'completed' }]
      })
    )

    expect(reset.events.find((event) => event.type === 'plan')).toMatchObject({ revision: 1 })
    expect(preserved.events.find((event) => event.type === 'plan')).toMatchObject({ revision: 2 })
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
      { step: 'Done task', status: 'completed', priority: null },
      { step: 'Current task', status: 'in_progress', priority: null },
      { step: 'Future task', status: 'pending', priority: null }
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

describe('AcpContentMapper session metadata updates', () => {
  it('maps session_info_update into session metadata', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'session_info_update',
        title: 'Imported Session',
        updatedAt: '2026-06-02T10:00:00.000Z',
        _meta: { source: 'agent' }
      })
    )

    expect(result.sessionInfo).toEqual({
      title: 'Imported Session',
      updatedAt: '2026-06-02T10:00:00.000Z',
      meta: { source: 'agent' }
    })
  })

  it('maps usage_update into ACP usage metadata without standard token usage', () => {
    const mapper = new AcpContentMapper()

    const result = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'usage_update',
        used: 42,
        size: 128,
        cost: { amount: 0.01, currency: 'USD' }
      })
    )

    expect(result.usage).toEqual({
      used: 42,
      size: 128,
      cost: { amount: 0.01, currency: 'USD' },
      meta: null
    })
    expect(result.events).toEqual([])
  })
})
