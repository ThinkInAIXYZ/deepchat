<template>
  <div
    class="z-50 relative min-w-55 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
  >
    <div v-if="displayItems.length > 0" class="max-h-64 overflow-y-auto">
      <button
        v-for="(item, index) in displayItems"
        :key="item.id || index"
        :ref="(el) => (itemElements[index] = el as HTMLButtonElement)"
        class="relative flex cursor-default hover:bg-accent select-none items-center rounded-sm gap-2 px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 w-full text-left"
        :class="[index === selectedIndex ? 'bg-accent' : '']"
        @click="selectItem(index)"
      >
        <!-- Type indicator based on category -->
        <span v-if="item.category === 'skills'" class="size-4 shrink-0 text-center">✨</span>
        <span
          v-else-if="item.category === 'prompts'"
          class="size-4 shrink-0 text-center text-blue-500"
          >💬</span
        >
        <span
          v-else-if="item.category === 'tools'"
          class="size-4 shrink-0 text-center text-green-600"
          >🔧</span
        >
        <Icon v-else-if="item.icon" :icon="item.icon" class="size-4 shrink-0" />
        <span v-else class="size-4 shrink-0"></span>

        <!-- File attachment indicator for prompts -->
        <Icon v-if="hasFiles(item)" icon="lucide:paperclip" class="size-3 text-blue-500" />

        <!-- Label -->
        <div class="font-medium flex-1 truncate">{{ item.label }}</div>

        <!-- Inline description (truncated) -->
        <span
          v-if="item.description && !displayItems[selectedIndex]?.description"
          class="text-xs text-muted-foreground truncate max-w-24"
        >
          {{ item.description }}
        </span>
      </button>
    </div>
    <div v-else class="p-2 text-sm text-muted-foreground text-center">No result</div>

    <!-- Description panel (shown when selected item has description) -->
    <div
      v-if="displayItems[selectedIndex]?.description"
      class="absolute text-muted-foreground shadow-sm -top-px right-[-328px] w-[320px] max-h-64 bg-card rounded-md p-2 border text-xs overflow-y-auto"
    >
      <div class="font-medium pb-1 border-b border-dashed">Description</div>
      <div class="py-1">{{ displayItems[selectedIndex].description }}</div>
    </div>

    <!-- Prompt params dialog -->
    <PromptParamsDialog
      v-if="showParamsDialog && selectedPrompt"
      :prompt-name="selectedPrompt.label"
      :params="selectedPrompt.params || []"
      @close="showParamsDialog = false"
      @submit="handlePromptParams"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { CategorizedData, getPromptFilesHandler } from './suggestion'
import PromptParamsDialog from './PromptParamsDialog.vue'

const props = defineProps<{
  items: CategorizedData[]
  command: (payload: {
    id: string
    label?: string | null
    category?: string | null
    content?: string | null
  }) => void
  query: string
  initialIndex?: number
}>()

const selectedIndex = ref(props.initialIndex ?? 0)
const itemElements = ref<(HTMLButtonElement | null)[]>([])

// Check if a prompt has associated files
const hasFiles = (item: CategorizedData): boolean => {
  if (item.category !== 'prompts') return false
  const mcpEntry = item.mcpEntry
  return Boolean(
    mcpEntry &&
    'files' in mcpEntry &&
    mcpEntry.files &&
    Array.isArray(mcpEntry.files) &&
    mcpEntry.files.length > 0
  )
}

// Flat list of items - no category navigation
const displayItems = computed<CategorizedData[]>(() => {
  // Filter out category-type items, only show actual items
  const items = props.items.filter((item) => item.type === 'item')

  if (props.query) {
    // Filter by query and limit results
    return items
      .filter((item) => item.label.toLowerCase().includes(props.query.toLowerCase()))
      .slice(0, 10)
  }

  // No query - show all items (limited)
  return items.slice(0, 10)
})

// Watch items changes and clamp selectedIndex
watch(
  () => props.items,
  () => {
    const max = Math.max(0, displayItems.value.length - 1)
    selectedIndex.value = Math.max(0, Math.min(selectedIndex.value, max))
  },
  { immediate: true }
)

const upHandler = () => {
  if (displayItems.value.length === 0) return
  selectedIndex.value =
    (selectedIndex.value + displayItems.value.length - 1) % displayItems.value.length
}

const downHandler = () => {
  if (displayItems.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + 1) % displayItems.value.length
}

// Scroll selected item into view
watch(
  () => selectedIndex.value,
  () => {
    if (itemElements.value[selectedIndex.value]) {
      itemElements.value[selectedIndex.value]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }
)

const showParamsDialog = ref(false)
const selectedPrompt = ref<{
  id: string
  label: string
  category: string
  content: string
  params?: Array<{
    name: string
    description: string
    required: boolean
  }>
} | null>(null)

const handlePromptParams = (values: Record<string, string>) => {
  if (selectedPrompt.value) {
    const promptContent = JSON.parse(selectedPrompt.value.content)
    if (!promptContent.arguments) {
      promptContent.arguments = {}
    }
    promptContent.argumentsValue = values

    props.command({
      id: selectedPrompt.value.id,
      label: selectedPrompt.value.label,
      category: selectedPrompt.value.category,
      content: JSON.stringify(promptContent)
    })

    const handler = getPromptFilesHandler()
    if (handler && promptContent.files && Array.isArray(promptContent.files)) {
      handler(promptContent.files).catch((error) => {
        console.error('Failed to handle prompt files:', error)
      })
    }

    showParamsDialog.value = false
    selectedPrompt.value = null
  }
}

const selectItem = (index: number) => {
  const selectedDisplayItem = displayItems.value[index]
  if (!selectedDisplayItem) return

  // Handle prompts with params dialog
  if (selectedDisplayItem.category === 'prompts') {
    const mcpEntry = selectedDisplayItem.mcpEntry
      ? typeof selectedDisplayItem.mcpEntry === 'string'
        ? JSON.parse(selectedDisplayItem.mcpEntry)
        : selectedDisplayItem.mcpEntry
      : null

    if (mcpEntry?.arguments && Array.isArray(mcpEntry.arguments) && mcpEntry.arguments.length > 0) {
      selectedPrompt.value = {
        id: selectedDisplayItem.id || '',
        label: selectedDisplayItem.label,
        category: selectedDisplayItem.category || '',
        content:
          typeof selectedDisplayItem.mcpEntry === 'string'
            ? selectedDisplayItem.mcpEntry
            : JSON.stringify(selectedDisplayItem.mcpEntry),
        params: mcpEntry.arguments
      }
      showParamsDialog.value = true
    } else {
      props.command({
        id: selectedDisplayItem.id || '',
        label: selectedDisplayItem.label,
        category: selectedDisplayItem.category || '',
        content:
          typeof selectedDisplayItem.mcpEntry === 'string'
            ? selectedDisplayItem.mcpEntry
            : selectedDisplayItem.mcpEntry
              ? JSON.stringify(selectedDisplayItem.mcpEntry)
              : ''
      })
    }

    // Handle associated files
    if (hasFiles(selectedDisplayItem)) {
      const handler = getPromptFilesHandler()
      if (handler && mcpEntry?.files) {
        handler(mcpEntry.files).catch((error) => {
          console.error('Failed to handle prompt files:', error)
        })
      }
    }
  } else {
    // Non-prompt items
    props.command({
      id: selectedDisplayItem.id || '',
      label: selectedDisplayItem.label,
      category: selectedDisplayItem.category || '',
      content:
        typeof selectedDisplayItem.mcpEntry === 'string'
          ? selectedDisplayItem.mcpEntry
          : selectedDisplayItem.mcpEntry
            ? JSON.stringify(selectedDisplayItem.mcpEntry)
            : ''
    })
  }
}

const enterHandler = () => {
  selectItem(selectedIndex.value)
}

const onKeyDown = ({ event }: { event: KeyboardEvent }): boolean => {
  if (event.key === 'ArrowUp') {
    upHandler()
    return true
  }

  if (event.key === 'ArrowDown') {
    downHandler()
    return true
  }

  if (event.key === 'Enter') {
    enterHandler()
    event.preventDefault()
    return true
  }

  if (event.key === 'Escape') {
    selectedIndex.value = 0
    return true
  }

  return false
}

defineExpose({
  onKeyDown
})
</script>
