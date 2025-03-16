<template>
  <div
    class="inline-flex z-0 flex-row gap-2 items-center cursor-pointer h-9 text-xs text-muted-foreground hover:bg-accent px-2 rounded-md"
    @click="openSearchResults"
  >
    <template v-if="block.status === 'success'">
      <div v-if="pages.length > 0" class="flex flex-row ml-1.5">
        <template v-for="(page, index) in pages" :key="index">
          <img
            v-if="page.icon"
            :src="page.icon"
            :style="{
              zIndex: pages.length - index
            }"
            class="w-6 h-6 -ml-1.5 border-card rounded-full bg-card border-2 box-border"
          />
          <Icon
            v-else
            icon="lucide:compass"
            class="w-6 h-6 -ml-1.5 border-card rounded-full bg-card border-2 box-border"
          />
        </template>
      </div>
      <span>{{ t('chat.search.results', [block.extra.total]) }}</span>
      <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
    </template>
    <template v-else-if="block.status === 'loading'">
      <Icon icon="lucide:loader-circle" class="w-4 h-4 text-muted-foreground animate-spin" />
      <span>{{
        block.extra.total > 0
          ? t('chat.search.results', [block.extra.total])
          : t('chat.search.searching')
      }}</span>
    </template>
    <template v-else-if="block.status === 'optimizing'">
      <Icon icon="lucide:loader-circle" class="w-4 h-4 text-muted-foreground animate-spin" />
      <span>{{ t('chat.search.optimizing') }}</span>
    </template>
    <template v-else-if="block.status === 'reading'">
      <Icon icon="lucide:loader-circle" class="w-4 h-4 text-muted-foreground animate-spin" />
      <span>{{ t('chat.search.reading') }}</span>
    </template>
    <template v-else-if="block.status === 'error'">
      <Icon icon="lucide:x" class="w-4 h-4 text-muted-foreground" />
      <span>{{ t('chat.search.error') }}</span>
    </template>
  </div>
  <SearchResultsDrawer v-model:open="isDrawerOpen" :search-results="searchResults" />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { SearchResult } from '@shared/presenter'
import { computed, ref } from 'vue'
import SearchResultsDrawer from '../SearchResultsDrawer.vue'

const { t } = useI18n()
const threadPresenter = usePresenter('threadPresenter')
const isDrawerOpen = ref(false)
const searchResults = ref<SearchResult[]>([])

const props = defineProps<{
  messageId: string
  block: {
    status: 'success' | 'loading' | 'optimizing' | 'reading' | 'error'
    extra: {
      total: number
      pages?: Array<{
        url: string
        icon: string
      }>
    }
  }
}>()

const pages = computed(() => {
  return props.block.extra.pages?.slice(0, 10) || []
})

const openSearchResults = async () => {
  if (props.block.status === 'success') {
    isDrawerOpen.value = true
    searchResults.value = await threadPresenter.getSearchResults(props.messageId)
  }
}
</script>
