import { describe, expect, it } from 'vitest'
import {
  collectVisibleUserMessageText,
  getVisibleMentionLabel,
  getVisibleUserContentBlocks
} from '@/features/chat-page/model/displayUserMessageText'
import type { DisplayUserMessageContent } from '@/features/chat-page/model/displayMessage'

const createContent = (
  overrides: Partial<DisplayUserMessageContent> = {}
): DisplayUserMessageContent => ({
  text: '',
  files: [],
  links: [],
  search: false,
  think: false,
  ...overrides
})

describe('displayUserMessageText', () => {
  it('uses the labels rendered for prompt and context mentions', () => {
    expect(
      getVisibleMentionLabel({
        type: 'mention',
        category: 'prompts',
        id: 'prompt-a',
        content: 'raw'
      })
    ).toBe('prompt-a')
    expect(
      getVisibleMentionLabel({ type: 'mention', category: 'context', id: '', content: 'raw' })
    ).toBe('context')
  })

  it('uses rich blocks instead of raw text and inline items', () => {
    const content = createContent({
      text: 'raw text',
      inlineItems: [{ type: 'skill', offset: 0, skillName: 'inline-skill' }],
      content: [
        { type: 'text', content: 'visible ' },
        { type: 'mention', category: 'context', id: 'project-a', content: 'raw context' },
        { type: 'code', content: 'const answer = 42', language: 'typescript' }
      ]
    })

    expect(getVisibleUserContentBlocks(content)).toEqual(content.content)
    expect(collectVisibleUserMessageText(content)).toBe('visible project-aconst answer = 42')
  })

  it('inserts valid inline labels at their text offsets', () => {
    const content = createContent({
      text: 'before after',
      inlineItems: [
        { type: 'file', offset: 7, fileName: 'notes.md', filePath: '/tmp/notes.md' },
        { type: 'skill', offset: 7, skillName: 'review' },
        { type: 'skill', offset: 99, skillName: 'ignored' }
      ]
    })

    expect(getVisibleUserContentBlocks(content)).toEqual([
      { type: 'text', content: 'before ' },
      { type: 'file', fileName: 'notes.md', filePath: '/tmp/notes.md', mimeType: undefined },
      { type: 'skill', skillName: 'review' },
      { type: 'text', content: 'after' }
    ])
    expect(collectVisibleUserMessageText(content)).toBe('before notes.mdreviewafter')
  })

  it('falls back to raw text without renderable inline items', () => {
    const content = createContent({
      text: 'raw text',
      inlineItems: [{ type: 'skill', offset: -1, skillName: 'ignored' }]
    })

    expect(getVisibleUserContentBlocks(content)).toEqual([])
    expect(collectVisibleUserMessageText(content)).toBe('raw text')
  })
})
