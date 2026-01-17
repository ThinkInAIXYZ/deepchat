<template>
  <div
    class="flex flex-col h-full border-r border-border bg-background"
    :style="{ width: sidebarWidth }"
  >
    <!-- Header: Window drag region -->
    <div class="h-9 shrink-0 window-drag-region flex items-center justify-center">
      <span v-if="!collapsed" class="text-xs font-medium text-muted-foreground">
        {{ t('sidebar.conversations') }}
      </span>
    </div>

    <!-- Conversation list -->
    <div
      ref="listContainer"
      class="flex-1 overflow-y-auto scrollbar-hide px-1"
      @dragover="onContainerDragOver"
      @drop="onContainerDrop"
    >
      <div class="flex flex-col gap-0.5 py-1 relative">
        <ConversationTab
          v-for="(conv, idx) in conversations"
          :key="conv.id"
          :conversation="conv"
          :active="conv.id === activeConversationId"
          :closable="conversations.length > 1"
          :draggable="enableReordering"
          @click="$emit('conversation-select', conv.id)"
          @close="$emit('conversation-close', conv.id)"
          @dragstart="(_id, e) => onTabDragStart(conv.id, idx, e)"
          @dragover="onTabDragOver(idx, $event)"
          @dragend="onTabDragEnd"
        />

        <!-- Drag insert indicator -->
        <div
          v-if="dragInsertIndex !== -1"
          class="absolute left-1 right-1 h-0.5 bg-primary z-10 pointer-events-none rounded"
          :style="{ top: dragInsertPosition + 'px' }"
        />
      </div>

      <!-- Empty state -->
      <div
        v-if="conversations.length === 0"
        class="flex flex-col items-center justify-center h-32 text-muted-foreground"
      >
        <Icon icon="lucide:message-square-plus" class="w-8 h-8 mb-2 opacity-50" />
        <span class="text-xs">{{ t('sidebar.noConversations') }}</span>
      </div>
    </div>

    <!-- Bottom actions -->
    <div class="shrink-0 flex flex-col border-t border-border p-1 gap-0.5">
      <!-- New conversation -->
      <Button
        variant="ghost"
        :class="['w-full justify-start gap-2', collapsed ? 'px-2' : 'px-3']"
        @click="$emit('new-conversation')"
      >
        <Icon icon="lucide:plus" class="w-4 h-4" />
        <span v-if="!collapsed">{{ t('sidebar.newConversation') }}</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useI18n } from 'vue-i18n'
import ConversationTab from './ConversationTab.vue'
import type { ConversationMeta } from '@/stores/sidebarStore'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    conversations: ConversationMeta[]
    activeConversationId?: string
    width?: number
    collapsed?: boolean
    enableReordering?: boolean
  }>(),
  {
    width: 240,
    collapsed: false,
    enableReordering: true
  }
)

const emit = defineEmits<{
  'conversation-select': [conversationId: string]
  'conversation-close': [conversationId: string]
  'conversation-reorder': [payload: { conversationId: string; fromIndex: number; toIndex: number }]
  'new-conversation': []
  'width-change': [newWidth: number]
  'collapsed-change': [collapsed: boolean]
}>()

// Computed width for styling
const sidebarWidth = computed(() => (props.collapsed ? '48px' : `${props.width}px`))

// Drag and drop state
const listContainer = ref<HTMLElement | null>(null)
const dragInsertIndex = ref(-1)
const dragInsertPosition = ref(0)
const dragSourceIndex = ref(-1)
const dragSourceId = ref<string | null>(null)

// Drag handlers (adapted from AppBar.vue)
const onTabDragStart = (id: string, idx: number, _e: DragEvent) => {
  dragSourceId.value = id
  dragSourceIndex.value = idx
}

const onTabDragOver = (idx: number, e: DragEvent) => {
  e.preventDefault()
  if (!props.enableReordering) return

  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const midY = rect.top + rect.height / 2

  if (e.clientY < midY) {
    dragInsertIndex.value = idx
    dragInsertPosition.value = rect.top - (listContainer.value?.getBoundingClientRect().top || 0)
  } else {
    dragInsertIndex.value = idx + 1
    dragInsertPosition.value = rect.bottom - (listContainer.value?.getBoundingClientRect().top || 0)
  }
}

const onContainerDragOver = (e: DragEvent) => {
  e.preventDefault()
}

const onTabDragEnd = () => {
  // Reset drag state when drag ends (including cancel via ESC)
  dragInsertIndex.value = -1
  dragInsertPosition.value = 0
  dragSourceIndex.value = -1
  dragSourceId.value = null
}

const onContainerDrop = (e: DragEvent) => {
  e.preventDefault()
  if (!props.enableReordering) return

  if (dragSourceId.value && dragInsertIndex.value !== -1) {
    const fromIndex = dragSourceIndex.value
    let toIndex = dragInsertIndex.value

    // Adjust toIndex if dropping after the source
    if (toIndex > fromIndex) {
      toIndex -= 1
    }

    if (fromIndex !== toIndex) {
      emit('conversation-reorder', {
        conversationId: dragSourceId.value,
        fromIndex,
        toIndex
      })
    }
  }

  // Reset drag state
  dragInsertIndex.value = -1
  dragSourceIndex.value = -1
  dragSourceId.value = null
}
</script>
