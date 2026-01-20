import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import type { AssistantMessageBlock } from '@shared/chat'
import { useSearchResultState } from '@/composables/useSearchResultState'

const getSearchResults = vi.fn().mockResolvedValue([
  {
    title: 'Example',
    url: 'https://example.com',
    description: 'Example result'
  }
])

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k })
}))

vi.mock('@/composables/chat/useConversationCore', () => ({
  useConversationCore: () => ({
    getSearchResults
  })
}))

describe('useSearchResultState', () => {
  it('computes summary state and opens results drawer', async () => {
    const block = ref<AssistantMessageBlock>({
      type: 'search',
      status: 'success',
      content: '',
      extra: {
        total: 2,
        pages: [{ icon: 'https://a.com/icon.png' }, { icon: 'https://b.com/icon.png' }],
        label: 'custom_search',
        searchId: 'search-1'
      }
    } as AssistantMessageBlock)
    const messageId = ref('message-1')

    const state = useSearchResultState({ messageId, block })

    expect(state.searchLabel.value).toBe('custom_search')
    expect(state.favicons.value).toEqual(['https://a.com/icon.png', 'https://b.com/icon.png'])
    expect(state.statusDescription.value).toBe('chat.search.results')
    expect(state.isInteractive.value).toBe(true)

    await state.openResults()
    expect(getSearchResults).toHaveBeenCalledWith('message-1', 'search-1')
    expect(state.isDrawerOpen.value).toBe(true)
    expect(state.searchResults.value).toHaveLength(1)
  })
})
