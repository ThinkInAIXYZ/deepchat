import { describe, expect, it } from 'vitest'
import {
  formatUserMessageContent,
  getExportedUserMessageText
} from '@/exporter/formats/userMessageText'

describe('formatUserMessageContent', () => {
  it('formats prompt mentions', () => {
    const content = formatUserMessageContent([
      {
        type: 'mention',
        id: 'prompt-1',
        category: 'prompts',
        content: JSON.stringify({
          messages: [{ content: 'Hello' }, { content: { type: 'text', text: 'World' } }]
        })
      }
    ])

    expect(content).toBe('@prompt-1 <prompts>Hello\nWorld</prompts>')
  })

  it('exports the embedded PDF snapshot that was sent to the model', () => {
    expect(
      getExportedUserMessageText({
        text: 'Summarize it',
        files: [
          {
            name: 'report.pdf',
            path: '/tmp/report.pdf',
            mimeType: 'application/pdf',
            content: 'Persisted embedded PDF body',
            resolvedRepresentation: { kind: 'embedded_text' }
          }
        ],
        links: [],
        search: false,
        think: false
      })
    ).toContain('[Embedded PDF text sent to the model: report.pdf]\nPersisted embedded PDF body')
  })
})
