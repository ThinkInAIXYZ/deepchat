<template>
  <div
    class="z-50 relative min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
  >
    <div v-if="isCategoryView" class="text-xs text-muted-foreground pb-1 px-1">
      {{ currentCategory }}
    </div>
    <div v-if="displayItems.length > 0" class="max-h-64 overflow-y-auto">
      <button
        v-for="(item, index) in displayItems"
        :key="index"
        :ref="(el) => (itemElements[index] = el)"
        class="relative flex cursor-default hover:bg-accent select-none items-center rounded-sm gap-2 px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 w-full text-left"
        :class="[index === selectedIndex ? 'bg-accent' : '']"
        @click="selectItem(index)"
      >
        <Icon v-if="item.icon" :icon="item.icon" class="size-4 shrink-0" />
        <!-- 文件标识图标 -->
        <Icon v-if="hasFiles(item)" icon="lucide:paperclip" class="size-3 text-blue-500" />
        <div class="font-medium flex-1 truncate">{{ item.label }}</div>
        <Icon
          v-if="item.type === 'category'"
          icon="lucide:chevron-right"
          class="size-4 shrink-0"
        ></Icon>
      </button>
    </div>
    <div v-else class="p-1 text-sm text-muted-foreground">No result</div>
    <div
      v-if="displayItems[selectedIndex]?.description"
      class="absolute text-muted-foreground shadow-sm -top-px right-[-328px] w-[320px] max-h-64 bg-card rounded-md p-2 border text-xs overflow-y-auto"
    >
      <div class="font-medium pb-1 border-b border-dashed">Description</div>
      <div class="py-1">{{ displayItems[selectedIndex].description }}</div>
    </div>

    <!-- 参数输入对话框 -->
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
  items: CategorizedData[] // Allow items to be strings or objects
  command: (payload: {
    id: string
    label?: string | null
    category?: string | null
    content?: string | null
  }) => void
  query: string // Declare the query prop
}>()
const selectedIndex = ref(0)
const currentCategory = ref<string | null>(null)
const isCategoryView = computed(() => currentCategory.value != null)
const itemElements = ref<HTMLButtonElement | null[]>([])

// 检测 prompt 是否有关联文件
const hasFiles = (item: CategorizedData): boolean => {
  if (item.category !== 'prompts') return false
  const mcpEntry = item.mcpEntry
  // 类型保护：检查是否是 PromptListEntry 并且有 files 字段
  return Boolean(
    mcpEntry &&
      'files' in mcpEntry &&
      mcpEntry.files &&
      Array.isArray(mcpEntry.files) &&
      mcpEntry.files.length > 0
  )
}

// Compute items to display based on the current category
const displayItems = computed<CategorizedData[]>(() => {
  if (props.query) {
    if (!isCategoryView.value) {
      return props.items
    } else {
      return props.items.filter(
        (item) => item.type === 'item' && item.category === currentCategory.value
      )
    }
  } else {
    if (!isCategoryView.value) {
      return props.items.filter((item) => item.type === 'category')
    } else {
      return props.items.filter(
        (item) => item.type === 'item' && item.category === currentCategory.value
      )
    }
  }
})

watch(
  () => props.items,
  () => {
    // Reset selection state when items change
    selectedIndex.value = 0
  },
  { immediate: true } // Run watcher immediately to set initial state
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
    // 将参数值添加到 prompt 内容中
    const promptContent = JSON.parse(selectedPrompt.value.content)
    // 确保 arguments 字段存在
    if (!promptContent.arguments) {
      promptContent.arguments = {}
    }
    // 合并参数值
    promptContent.argumentsValue = values

    props.command({
      id: selectedPrompt.value.id,
      label: selectedPrompt.value.label,
      category: selectedPrompt.value.category,
      content: JSON.stringify(promptContent)
    })

    // 处理关联的文件
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
  if (selectedDisplayItem.type === 'category') {
    currentCategory.value = selectedDisplayItem.label
    selectedIndex.value = 0
  } else {
    if (selectedDisplayItem.category === 'prompts') {
      const mcpEntry = selectedDisplayItem.mcpEntry
        ? typeof selectedDisplayItem.mcpEntry === 'string'
          ? JSON.parse(selectedDisplayItem.mcpEntry)
          : selectedDisplayItem.mcpEntry
        : null

      // 检查是否有参数需要填写
      if (
        mcpEntry?.arguments &&
        Array.isArray(mcpEntry.arguments) &&
        mcpEntry.arguments.length > 0
      ) {
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
        // 没有参数，直接执行
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

      // 检查并处理关联的文件
      if (hasFiles(selectedDisplayItem)) {
        const handler = getPromptFilesHandler()
        if (handler && mcpEntry?.files) {
          handler(mcpEntry.files).catch((error) => {
            console.error('Failed to handle prompt files:', error)
          })
        }
      }
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
  }
}

const enterHandler = () => {
  selectItem(selectedIndex.value)
}

const backHandler = () => {
  if (currentCategory.value !== null) {
    currentCategory.value = null
    selectedIndex.value = 0
    return true
  } else {
    return false
  }
}

const cleanHandler = () => {
  currentCategory.value = null
  selectedIndex.value = 0
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
    // Prevent default form submission or other behavior
    event.preventDefault()
    return true
  }

  if (event.key === 'Escape') {
    cleanHandler()
    return true
  }

  if (event.key === 'Backspace') {
    if (backHandler()) {
      return true
    } else {
      return false
    }
  }

  return false
}

defineExpose({
  onKeyDown
})
</script>
