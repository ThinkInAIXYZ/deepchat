import type { Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'

type ComposerDraftOptions = {
  conversationId: Ref<string | null>
  inputText: Ref<string>
  editor: Editor
}

const draftCache = new Map<string, string>()

export function useComposerDraft(options: ComposerDraftOptions) {
  const persistDraft = (conversationId: string | null) => {
    if (!conversationId) return
    draftCache.set(conversationId, options.inputText.value)
  }

  const restoreDraft = (conversationId: string | null) => {
    if (!conversationId) return
    const draft = draftCache.get(conversationId) ?? ''
    options.editor.commands.setContent(draft)
    options.inputText.value = draft
  }

  const clearDraft = (conversationId?: string | null) => {
    const target = conversationId ?? options.conversationId.value
    if (target) {
      draftCache.delete(target)
    }
  }

  return {
    persistDraft,
    restoreDraft,
    clearDraft
  }
}
