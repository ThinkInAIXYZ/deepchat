import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useComposerDraft } from '@/components/chat-input/composables/useComposerDraft'

describe('useComposerDraft', () => {
  it('persists and restores drafts per conversation', () => {
    const conversationId = ref('conv-1')
    const inputText = ref('hello')
    const editor = { commands: { setContent: vi.fn() } } as any

    const draft = useComposerDraft({ conversationId, inputText, editor })

    draft.persistDraft(conversationId.value)
    inputText.value = 'changed'

    draft.restoreDraft(conversationId.value)

    expect(editor.commands.setContent).toHaveBeenCalledWith('hello')
    expect(inputText.value).toBe('hello')

    draft.clearDraft(conversationId.value)
  })

  it('clears drafts when requested', () => {
    const conversationId = ref('conv-2')
    const inputText = ref('draft')
    const editor = { commands: { setContent: vi.fn() } } as any

    const draft = useComposerDraft({ conversationId, inputText, editor })

    draft.persistDraft(conversationId.value)
    draft.clearDraft(conversationId.value)

    inputText.value = 'changed'
    draft.restoreDraft(conversationId.value)

    expect(editor.commands.setContent).toHaveBeenLastCalledWith('')
    expect(inputText.value).toBe('')
  })
})
