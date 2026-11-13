import { describe, expect, it } from 'vitest'
import { projectHtmlRenderHistory } from '@/provider/aiSdk/htmlRenderHistory'
import { mapMessagesToModelMessages } from '@/provider/aiSdk/messageMapper'
import type { ChatMessage, ChatMessageToolCall } from '@shared/types/core/chat-message'

const sectionCall: ChatMessageToolCall = {
  id: 'section-1',
  type: 'function',
  function: {
    name: 'html_render_section',
    arguments: JSON.stringify({ panelId: 'p1', sectionId: 'chart', html: '<p>Chart</p>' })
  }
}
const sectionResult = 'html_render_section succeeded. panelId: p1; sectionId: chart'

describe('projectHtmlRenderHistory', () => {
  it('projects receipts outside assistant narration without changing the internal conversation', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Render a chart' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Adding a chart', provider_options: { test: { id: 't' } } }
        ],
        reasoning_content: 'The shell is ready',
        reasoning_provider_options: { test: { signature: 'r' } },
        tool_calls: [sectionCall]
      },
      { role: 'tool', tool_call_id: sectionCall.id, content: sectionResult }
    ]
    const original = structuredClone(messages)

    const projected = projectHtmlRenderHistory(messages)

    expect(projected).toHaveLength(3)
    expect(projected[1].tool_calls).toBeUndefined()
    expect(projected[1].content).toEqual(messages[1].content)
    expect(projected[1].reasoning_content).toBe(messages[1].reasoning_content)
    expect(projected[1].reasoning_provider_options).toEqual(messages[1].reasoning_provider_options)
    expect(projected[2]).toEqual({ role: 'user', content: sectionResult })
    expect(JSON.stringify(projected)).not.toContain('<p>Chart</p>')
    expect(messages).toEqual(original)
    expect(projectHtmlRenderHistory(projected)).toBe(projected)
  })

  it('identifies successful and failed sections in a mixed batch without breaking other tool pairs', () => {
    const successCall: ChatMessageToolCall = {
      id: 'section-2',
      type: 'function',
      function: {
        name: 'html_render_section',
        arguments: JSON.stringify({ panelId: 'p1', sectionId: 'summary' })
      }
    }
    const success = 'html_render_section succeeded. panelId: p1; sectionId: summary'
    const error = 'Error: The panel would exceed 2 MB. Start a new panel with html_render.'
    const failure = `html_render_section failed. panelId: p1; sectionId: chart\n${error}`
    const readCall: ChatMessageToolCall = {
      id: 'read-1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"README.md"}' }
    }
    const replay: ChatMessage = {
      role: 'assistant',
      provider_replay: { markerId: 'search-1', payload: 'opaque search output' }
    }
    const messages: ChatMessage[] = [
      { role: 'assistant', tool_calls: [successCall, readCall, sectionCall] },
      replay,
      { role: 'assistant', content: 'Search finished' },
      { role: 'tool', tool_call_id: sectionCall.id, content: error },
      { role: 'tool', tool_call_id: readCall.id, content: 'Readme content' },
      { role: 'tool', tool_call_id: successCall.id, content: success }
    ]
    const original = structuredClone(messages)

    const projected = projectHtmlRenderHistory(messages)

    expect(projected).toEqual([
      {
        role: 'assistant',
        tool_calls: [readCall]
      },
      replay,
      messages[2],
      messages[4],
      { role: 'user', content: success },
      { role: 'user', content: failure }
    ])

    const mapped = mapMessagesToModelMessages(messages, { tools: [], supportsNativeTools: true })
    expect(mapped.slice(-2)).toEqual([
      { role: 'user', content: [{ type: 'text', text: success }] },
      { role: 'user', content: [{ type: 'text', text: failure }] }
    ])
    expect(JSON.stringify(mapped)).not.toContain('<p>Chart</p>')
    expect(messages).toEqual(original)
  })

  it.each([
    [JSON.stringify({ title: 'Report', html: '<main>Report</main>' }), 'title: Report'],
    ['invalid arguments', 'toolCallId: page-1']
  ])('identifies failed page calls without replaying their HTML (%s)', (args, target) => {
    const error = 'Error: Invalid arguments for html_render'
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        tool_calls: [
          { id: 'page-1', type: 'function', function: { name: 'html_render', arguments: args } }
        ]
      },
      { role: 'tool', tool_call_id: 'page-1', content: error }
    ]

    expect(mapMessagesToModelMessages(messages, { tools: [], supportsNativeTools: true })).toEqual([
      { role: 'user', content: [{ type: 'text', text: `html_render failed. ${target}\n${error}` }] }
    ])
  })

  it('leaves pending batches intact without borrowing results from a later user turn', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', tool_calls: [sectionCall] },
      { role: 'user', content: 'Try again' },
      { role: 'assistant', tool_calls: [sectionCall] },
      { role: 'tool', tool_call_id: sectionCall.id, content: sectionResult }
    ]

    expect(projectHtmlRenderHistory(messages)[0]).toBe(messages[0])
    const pending = messages.slice(0, 2)
    expect(projectHtmlRenderHistory(pending)).toBe(pending)
  })
})
