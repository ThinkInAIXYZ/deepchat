import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useComposerSubmission } from '@/components/chat-input/composables/useComposerSubmission'

describe('useComposerSubmission', () => {
  it('returns null when input is empty', async () => {
    const submission = useComposerSubmission({
      editor: { getJSON: () => ({ type: 'doc', content: [] }) } as any,
      inputText: ref(''),
      selectedFiles: ref([]),
      deepThinking: ref(false),
      buildBlocks: vi.fn(async () => [])
    })

    const result = await submission.buildMessageContent()
    expect(result).toBeNull()
  })

  it('builds message content from input and blocks', async () => {
    const doc = { type: 'doc', content: [] }
    const buildBlocks = vi.fn(async () => [{ type: 'text', content: 'hello' }])

    const submission = useComposerSubmission({
      editor: { getJSON: () => doc } as any,
      inputText: ref('Hello'),
      selectedFiles: ref([]),
      deepThinking: ref(true),
      buildBlocks
    })

    const result = await submission.buildMessageContent()
    expect(buildBlocks).toHaveBeenCalledWith(doc)
    expect(result).toMatchObject({
      text: 'Hello',
      links: [],
      search: false,
      think: true,
      content: [{ type: 'text', content: 'hello' }]
    })
  })
})
