<template>
  <div class="min-w-64 max-w-96 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
    <div v-if="filteredItems.length > 0" class="max-h-72 overflow-y-auto">
      <button
        v-for="(item, index) in filteredItems"
        :key="item.id"
        :ref="(el) => (itemElements[index] = el as HTMLButtonElement)"
        class="w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
        :class="index === selectedIndex ? 'bg-accent text-accent-foreground' : ''"
        @click="selectIndex(index)"
      >
        <div class="flex items-start gap-2">
          <span
            class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-xs text-muted-foreground"
          >
            <Icon
              v-if="item.category === 'command'"
              icon="lucide:command"
              data-icon="lucide:command"
              class="h-3.5 w-3.5"
            />
            <span v-else>{{ categoryTag(item.category) }}</span>
          </span>
          <div class="flex-1 min-w-0">
            <div class="truncate font-medium">{{ item.label }}</div>
            <div v-if="item.description" class="truncate text-xs text-muted-foreground">
              {{ item.description }}
            </div>
          </div>
        </div>
      </button>
    </div>
    <div v-else class="px-3 py-2 text-sm text-muted-foreground">No result</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'

export type SuggestionCategory = 'file' | 'command' | 'skill' | 'prompt' | 'tool'

export interface SuggestionListItem {
  id: string
  label: string
  description?: string
  category: SuggestionCategory
  payload: unknown
}

const props = defineProps<{
  items: SuggestionListItem[]
  query: string
  command: (item: SuggestionListItem) => void
}>()

const selectedIndex = ref(0)
const itemElements = ref<(HTMLButtonElement | null)[]>([])

const filteredItems = computed(() => props.items)

watch(
  () => filteredItems.value.length,
  (length) => {
    if (length <= 0) {
      selectedIndex.value = 0
      return
    }
    if (selectedIndex.value >= length) {
      selectedIndex.value = length - 1
    }
  },
  { immediate: true }
)

watch(selectedIndex, () => {
  itemElements.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' })
})

const categoryTag = (category: SuggestionCategory) => {
  switch (category) {
    case 'command':
      return '/'
    case 'skill':
      return 'SK'
    case 'prompt':
      return 'PR'
    case 'tool':
      return 'TL'
    case 'file':
      return '@'
    default:
      return ''
  }
}

const selectIndex = (index: number) => {
  const item = filteredItems.value[index]
  if (!item) return
  props.command(item)
}

const onKeyDown = ({ event }: { event: KeyboardEvent }): boolean => {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!filteredItems.value.length) return true
    selectedIndex.value =
      (selectedIndex.value + filteredItems.value.length - 1) % filteredItems.value.length
    return true
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!filteredItems.value.length) return true
    selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
    return true
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    selectIndex(selectedIndex.value)
    return true
  }

  return false
}

defineExpose({
  onKeyDown
})
</script>
