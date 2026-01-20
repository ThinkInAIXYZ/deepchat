import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import type { AssistantMessageBlock } from '@shared/chat'
import type { SearchResult } from '@shared/presenter'

type SearchExtra = {
  total: number
  pages: Array<{
    url?: string
    icon?: string
  }>
  label?: string
  name?: string
  engine?: string
  provider?: string
  searchId?: string
}

type UseSearchResultStateOptions = {
  messageId: Ref<string>
  block: Ref<AssistantMessageBlock>
}

export function useSearchResultState(options: UseSearchResultStateOptions) {
  const { t } = useI18n()
  const conversationCore = useConversationCore()
  const isDrawerOpen = ref(false)
  const searchResults = ref<SearchResult[]>([])

  const extra = computed<SearchExtra>(() => {
    const raw = (options.block.value.extra || {}) as Record<string, unknown>
    const totalValue = raw.total
    const parsedTotal = typeof totalValue === 'number' ? totalValue : Number(totalValue ?? 0)
    const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : 0

    const rawPages = raw.pages
    const pages = Array.isArray(rawPages)
      ? (rawPages as Array<{ url?: string; icon?: string }>).slice(0, 10)
      : []

    const label = typeof raw.label === 'string' ? raw.label : undefined
    const name = typeof raw.name === 'string' ? raw.name : undefined
    const engine = typeof raw.engine === 'string' ? raw.engine : undefined
    const provider = typeof raw.provider === 'string' ? raw.provider : undefined
    const searchId = typeof raw.searchId === 'string' ? raw.searchId : undefined

    return {
      total: Number.isFinite(total) ? total : 0,
      pages,
      label,
      name,
      engine,
      provider,
      searchId
    }
  })

  const searchLabel = computed(() => {
    const { label, name, engine, provider } = extra.value
    return label || name || engine || provider || 'web_search'
  })

  const favicons = computed(() => {
    return extra.value.pages
      .map((page) => page.icon)
      .filter((icon): icon is string => typeof icon === 'string' && icon.length > 0)
      .slice(0, 6)
  })

  const statusDescription = computed(() => {
    const total = extra.value.total
    switch (options.block.value.status) {
      case 'success':
        return t('chat.search.results', [total])
      case 'loading':
        return total > 0 ? t('chat.search.results', [total]) : t('chat.search.searching')
      case 'optimizing':
        return t('chat.search.optimizing')
      case 'reading':
        return t('chat.search.reading')
      case 'error':
        return t('chat.search.error')
      default:
        return t('chat.search.searching')
    }
  })

  const isInteractive = computed(
    () => options.block.value.status === 'success' && extra.value.total > 0
  )

  const searchId = computed(() => extra.value.searchId)

  const openResults = async () => {
    if (!isInteractive.value) {
      return
    }

    try {
      isDrawerOpen.value = true
      searchResults.value = await conversationCore.getSearchResults(
        options.messageId.value,
        searchId.value
      )
    } catch (error) {
      console.error('Failed to load search results:', error)
    }
  }

  return {
    isDrawerOpen,
    searchResults,
    searchLabel,
    statusDescription,
    favicons,
    isInteractive,
    openResults
  }
}
