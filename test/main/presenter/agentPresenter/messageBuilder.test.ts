import { describe, expect, it, vi } from 'vitest'

// messageBuilder imports the full main-process presenter graph; mock it out so we can unit-test
// pure message-building utilities without initializing Electron/main presenters.
vi.mock('@/presenter', () => ({ presenter: {} }))

describe('messageBuilder.buildPostToolExecutionContext', () => {
  it('emits assistant(tool_calls) -> tool(tool_call_id) pairing when functionCall is enabled', async () => {
    const { buildPostToolExecutionContext } =
      await import('@/presenter/agentPresenter/message/messageBuilder')

    const messages = await buildPostToolExecutionContext({
      conversation: { settings: { systemPrompt: '' } } as any,
      contextMessages: [],
      userMessage: { role: 'user', content: { text: 'hi', files: [] } } as any,
      currentAssistantMessage: {
        role: 'assistant',
        content: [{ type: 'content', content: 'calling tool' }]
      } as any,
      completedToolCall: {
        id: 'call_1',
        name: 'exec',
        params: '{"command":"pwd"}',
        response: '/tmp'
      },
      modelConfig: { functionCall: true } as any
    })

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
    expect(messages[1].tool_calls?.[0]?.id).toBe('call_1')
    expect(messages[2].tool_call_id).toBe('call_1')
  })

  it('generates a stable tool_call_id when upstream id is empty', async () => {
    const { buildPostToolExecutionContext } =
      await import('@/presenter/agentPresenter/message/messageBuilder')

    const messages = await buildPostToolExecutionContext({
      conversation: { settings: { systemPrompt: '' } } as any,
      contextMessages: [],
      userMessage: { role: 'user', content: { text: 'hi', files: [] } } as any,
      currentAssistantMessage: {
        role: 'assistant',
        content: [{ type: 'content', content: 'calling tool' }]
      } as any,
      completedToolCall: {
        id: '',
        name: 'exec',
        params: '{"command":"pwd"}',
        response: '/tmp'
      },
      modelConfig: { functionCall: true } as any
    })

    const toolCallId = messages[1].tool_calls?.[0]?.id
    expect(typeof toolCallId).toBe('string')
    expect(toolCallId).toBeTruthy()
    expect(messages[2].tool_call_id).toBe(toolCallId)
  })

  it('falls back to legacy function_call_record injection when functionCall is disabled', async () => {
    const { buildPostToolExecutionContext } =
      await import('@/presenter/agentPresenter/message/messageBuilder')

    const messages = await buildPostToolExecutionContext({
      conversation: { settings: { systemPrompt: '' } } as any,
      contextMessages: [],
      userMessage: { role: 'user', content: { text: 'hi', files: [] } } as any,
      currentAssistantMessage: {
        role: 'assistant',
        content: [{ type: 'content', content: 'calling tool' }]
      } as any,
      completedToolCall: {
        id: 'call_1',
        name: 'exec',
        params: '{"command":"pwd"}',
        response: '/tmp'
      },
      modelConfig: { functionCall: false } as any
    })

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(String(messages[1].content)).toContain('<function_call>')
    expect(messages.some((m) => m.role === 'tool')).toBe(false)
  })
})
