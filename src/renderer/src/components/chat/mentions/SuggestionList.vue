<template>
  <div
    class="w-80 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
  >
    <div
      :id="listId"
      role="listbox"
      :aria-label="label"
      class="dc-overscroll-contain max-h-[min(18rem,45vh)] overflow-y-auto"
    >
      <template v-for="(item, index) in filteredItems" :key="item.id">
        <div
          v-if="groupLabelForIndex(index)"
          class="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground"
          role="presentation"
        >
          {{ groupLabelForIndex(index) }}
        </div>
        <button
          :id="optionId(index)"
          role="option"
          type="button"
          tabindex="-1"
          :aria-selected="index === selectedIndex"
          @mousedown.prevent
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
              <div
                v-if="item.description"
                class="text-xs text-muted-foreground [overflow-wrap:anywhere]"
              >
                {{ item.description }}
              </div>
            </div>
          </div>
        </button>
      </template>
    </div>
    <div
      :id="`${listId}-status`"
      role="status"
      :class="
        filteredItems.length && !statusLabel ? 'sr-only' : 'px-3 py-2 text-xs text-muted-foreground'
      "
    >
      {{ statusLabel || (filteredItems.length ? '' : emptyLabel) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

export type SuggestionCategory = 'file' | 'session' | 'command' | 'skill' | 'prompt' | 'tool'

export interface SuggestionListItem {
  id: string
  label: string
  description?: string
  category: SuggestionCategory
  payload: unknown
}

const props = defineProps<{
  listId: string
  label: string
  emptyLabel: string
  statusLabel?: string
  items: SuggestionListItem[]
  query: string
  command: (item: SuggestionListItem) => void
}>()

const emit = defineEmits<{ activeChange: [id: string | null] }>()
const { t } = useI18n()
const optionId = (index: number) => `${props.listId}-option-${index}`
const selectedIndex = ref(0)
const itemElements = ref<(HTMLButtonElement | null)[]>([])

const filteredItems = computed(() => props.items)

const groupLabelForIndex = (index: number) => {
  const category = filteredItems.value[index]?.category
  if (category !== 'session' && category !== 'file') return ''
  if (index > 0 && filteredItems.value[index - 1]?.category === category) return ''
  return t(`chat.sessionReference.groups.${category}`)
}

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

watch(
  [selectedIndex, filteredItems],
  () => {
    emit('activeChange', filteredItems.value.length ? optionId(selectedIndex.value) : null)
    itemElements.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true, flush: 'post' }
)

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
    case 'session':
      return '↗'
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
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return false
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

  if ((event.key === 'Enter' || event.key === 'Tab') && filteredItems.value.length) {
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
