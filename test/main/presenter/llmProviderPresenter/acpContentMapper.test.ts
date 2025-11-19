import { describe, it, expect } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import { AcpContentMapper } from '@/presenter/llmProviderPresenter/agent/acpContentMapper'

const createNotification = (
  sessionId: string,
  update: Extract<
    schema.SessionNotification['update'],
    { sessionUpdate: 'tool_call' | 'tool_call_update' }
  >
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
