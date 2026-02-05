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
import { toRef } from 'vue'
import SearchResultsDrawer from '../SearchResultsDrawer.vue'
import SearchStatusIndicator from '@/components/SearchStatusIndicator.vue'
import { useSearchResultState } from '@/composables/useSearchResultState'
import { AssistantMessageBlock } from '@shared/chat'

const props = defineProps<{
  messageId: string
  block: AssistantMessageBlock
}>()

const blockRef = toRef(props, 'block')
const messageIdRef = toRef(props, 'messageId')

const {
  isDrawerOpen,
  searchResults,
  searchLabel,
  statusDescription,
  favicons,
  isInteractive,
  openResults
} = useSearchResultState({
  messageId: messageIdRef,
  block: blockRef
})

const handleClick = async () => {
  await openResults()
}
</script>
