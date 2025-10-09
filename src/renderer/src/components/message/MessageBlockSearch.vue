<template>
  <div class="my-1 max-w-full">
    <div
      class="inline-block"
      role="button"
      :aria-disabled="!isInteractive"
      :tabindex="isInteractive ? 0 : undefined"
      @click="handleClick"
      @keydown.enter.prevent="handleClick"
      @keydown.space.prevent="handleClick"
    >
      <SearchStatusIndicator
        :status="block.status"
        :label="searchLabel"
        :description="statusDescription"
        :favicons="favicons"
        :interactive="isInteractive"
      />
    </div>
    <SearchResultsDrawer v-model:open="isDrawerOpen" :search-results="searchResults" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { SearchResult } from '@shared/presenter'
import SearchResultsDrawer from '../SearchResultsDrawer.vue'
import SearchStatusIndicator from '@/components/SearchStatusIndicator.vue'
import { AssistantMessageBlock } from '@shared/chat'

const { t } = useI18n()
const threadPresenter = usePresenter('threadPresenter')
const isDrawerOpen = ref(false)
const searchResults = ref<SearchResult[]>([])

const props = defineProps<{
  messageId: string
  block: AssistantMessageBlock
}>()

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

const extra = computed<SearchExtra>(() => {
  const raw = (props.block.extra || {}) as Record<string, unknown>
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
  switch (props.block.status) {
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

const isInteractive = computed(() => props.block.status === 'success' && extra.value.total > 0)

const searchId = computed(() => extra.value.searchId)

const handleClick = async () => {
  if (!isInteractive.value) {
    return
  }

  isDrawerOpen.value = true
  searchResults.value = await threadPresenter.getSearchResults(props.messageId, searchId.value)
}
</script>
