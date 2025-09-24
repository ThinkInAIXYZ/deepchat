<template>
  <Sheet :open="open" @update:open="$emit('update:open', $event)">
    <SheetContent
      class="h-[80vh] overflow-y-auto p-3 sm:p-6 max-w-[600px] rounded-t-lg mx-auto"
      side="bottom"
    >
      <SheetHeader class="space-y-1">
        <SheetTitle class="text-base sm:text-lg">{{ t('chat.search.title') }}</SheetTitle>
        <SheetDescription class="text-xs sm:text-sm">
          {{ t('chat.search.description', [searchResults.length]) }}
        </SheetDescription>
      </SheetHeader>
      <div class="mt-3 sm:mt-4 space-y-3 sm:space-y-4">
        <div
          v-for="result in searchResults"
          :key="result.url"
          class="p-3 sm:p-4 space-y-1.5 sm:space-y-2 rounded-lg border hover:bg-accent/50 active:bg-accent cursor-pointer transition-colors"
          @click="openUrl(result.url)"
        >
          <div class="flex items-center gap-1.5 sm:gap-2">
            <img
              v-if="result.icon"
              :src="result.icon"
              class="w-3 h-3 sm:w-4 sm:h-4 rounded"
              :alt="result.title"
            />
            <Icon v-else icon="lucide:globe" class="w-3 h-3 sm:w-4 sm:h-4" />
            <h3 class="font-medium text-xs sm:text-sm line-clamp-1">{{ result.title }}</h3>
          </div>
          <p class="text-xs sm:text-sm text-muted-foreground line-clamp-2">
            {{ result.description || result.content }}
          </p>
          <div
            class="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground"
          >
            <Icon icon="lucide:link" class="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            <span class="truncate">{{ result.url }}</span>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import type { SearchResult } from '@shared/presenter'

const { t } = useI18n()

defineProps<{
  open: boolean
  searchResults: SearchResult[]
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

const openUrl = (url: string) => {
  window.open(url, '_blank')
}
</script>
