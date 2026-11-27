import { describe, expect, it } from 'vitest'
import { buildConversationExportContent } from '@/exporter/formats/conversationExporter'

const conversation = {
  id: 'conv-1',
  title: 'Template {{title}} chat',
  settings: { modelId: 'model-{{x}}', providerId: 'provider' }
} as never

function messages(text: string) {
  return [
    {
      id: 'u1',
      role: 'user',
      timestamp: 1,
      content: { text, files: [{ name: '{{mime}}.md', mimeType: 'text/markdown' }], links: [] }
    },
    {
      id: 'a1',
      role: 'assistant',
      timestamp: 2,
      content: [
        { type: 'content', content: text },
        { type: 'reasoning_content', content: text },
        {
          type: 'tool_call',
          tool_call: { name: 'tool', params: JSON.stringify({ t: text }), response: text }
        },
        { type: 'error', content: text }
      ]
    }
  ] as never
}

describe('buildConversationExportContent html', () => {
  it.each([
    'Use {{name}} here',
    '{{user_name}}',
    '{{content}} and {{timestamp}}',
    '{{constructor}} {{__proto__}} {{toString}}',
    '{{title}}{{items}}{{value}}'
  ])('keeps {{word}} text from %s', (text) => {
    const html = buildConversationExportContent(conversation, messages(text), 'html')
    expect(html).toContain(`<div class="message-content">${text}</div>`)
    const pre = (label: string, value: string) =>
      `<div class="section-label">${label}</div>\n        <pre class="code">${value}</pre>`
    expect(html).toContain(
      `<div class="section-title">🤔 思考过程</div>\n        <pre class="code">${text}</pre>`
    )
    expect(html).toContain(pre('参数', `{\n  &quot;t&quot;: &quot;${text}&quot;\n}`))
    expect(html).toContain(pre('响应', text))
    expect(html).toContain(`❌ ${text}\n`)
    expect(html).toContain('Template {{title}} chat')
    expect(html).toContain('model-{{x}}')
    expect(html).toContain('<strong>{{mime}}.md</strong>')
  })

  it('still drops template tokens that have no value', () => {
    const html = buildConversationExportContent(conversation, messages('plain'), 'html')
    expect(html).not.toMatch(/\{\{(?:attachmentsSection|linksSection|assistantBlocks|caption)\}\}/)
  })
})

describe('buildConversationExportContent markdown', () => {
  it('keeps nested fences inside reasoning and tool output without consuming the answer', () => {
    const nested = ['before', '````js', 'const value = 42', '````', 'after'].join('\n')
    const md = buildConversationExportContent(
      conversation,
      [
        {
          role: 'assistant',
          timestamp: 2,
          content: [
            { type: 'reasoning_content', content: nested },
            { type: 'artifact-thinking', content: nested },
            { type: 'tool_call', tool_call: { name: 'tool', params: nested, response: nested } },
            { type: 'content', content: 'The final answer is normal Markdown.' }
          ]
        }
      ] as never,
      'markdown'
    )

    const fenced = ['\n`````\n', nested, '\n`````\n'].join('')
    const jsonFenced = fenced.replace('\n`````\n', '\n`````json\n')
    expect(md.split(fenced)).toHaveLength(4)
    expect(md).toContain(jsonFenced)
    expect(md).toContain(`${fenced}\nThe final answer is normal Markdown.\n\n---`)
  })

  it('keeps three backticks and the JSON info string for ordinary tool parameters', () => {
    const md = buildConversationExportContent(conversation, messages('ordinary'), 'markdown')
    expect(md).toContain('\n```json\n{\n  "t": "ordinary"\n}\n```\n')
  })
})
