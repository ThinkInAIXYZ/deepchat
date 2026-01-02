import { describe, it, expect } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { AcpContentMapper } from '@/presenter/agentPresenter/acp'

const createNotification = <T extends schema.SessionNotification['update']>(
  sessionId: string,
  update: T
): schema.SessionNotification => ({
  sessionId,
  update
})

const textContent = (text: string): schema.ToolCallContent => ({
  type: 'content',
  content: {
    type: 'text',
    text
  }
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
        status: 'in_progress'
      })
    )

    const startEvent = start.events.find((event) => event.type === 'tool_call_start')
    expect(startEvent).toMatchObject({
      type: 'tool_call_start',
      tool_call_id: toolCallId,
      tool_call_name: 'write_file'
    })

    const chunk = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'in_progress',
        content: [textContent('{"path":')]
      })
    )

    const chunkEvent = chunk.events.find((event) => event.type === 'tool_call_chunk')
    expect(chunkEvent).toMatchObject({
      type: 'tool_call_chunk',
      tool_call_id: toolCallId,
      tool_call_arguments_chunk: '{"path":'
    })

    const completion = mapper.map(
      createNotification('session-1', {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [textContent('"/tmp"}')]
      })
    )

    const completionChunk = completion.events.find((event) => event.type === 'tool_call_chunk')
    expect(completionChunk).toMatchObject({
      type: 'tool_call_chunk',
      tool_call_id: toolCallId,
      tool_call_arguments_chunk: '"/tmp"}'
    })

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

  it('emits reasoning event with formatted plan', () => {
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
    expect(reasoningEvent?.reasoning_content).toContain('Plan:')
    expect(reasoningEvent?.reasoning_content).toContain('Step 1')
    expect(reasoningEvent?.reasoning_content).toContain('Step 2')
  })

  it('includes status icons in formatted plan', () => {
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

    const reasoningEvent = result.events.find((e) => e.type === 'reasoning')
    expect(reasoningEvent?.reasoning_content).toContain('●') // completed
    expect(reasoningEvent?.reasoning_content).toContain('◐') // in_progress
    expect(reasoningEvent?.reasoning_content).toContain('○') // pending
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
