<template>
  <div class="flex flex-col h-full w-full">
    <!-- Conversation icon list -->
    <div
      ref="listContainer"
      class="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide"
      @dragover="onContainerDragOver"
      @drop="onContainerDrop"
    >
      <div class="flex flex-col items-center gap-3 py-2 px-2 relative">
        <TooltipProvider :delay-duration="300">
          <!-- Add button (always at end, scrolls with items) -->
          <Tooltip>
            <TooltipTrigger as-child>
              <div
                class="flex items-center justify-center w-10 h-10 cursor-pointer transition-all duration-200 group"
                @click="$emit('home')"
              >
                <div
                  class="flex items-center justify-center w-10 h-10 rounded-2xl transition-all duration-200 ease-out text-foreground group-hover:bg-muted border group-hover:scale-105 group-hover:rounded-xl group-hover:shadow-lg"
                >
                  <Icon icon="lucide:house" class="w-4 h-4 transition-transform" />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" :side-offset="12" class="font-medium">
              <p>{{ t('sidebar.newConversation') }}</p>
            </TooltipContent>
          </Tooltip>

          <!-- Separator line before add button -->
          <div v-if="conversations.length > 0" class="w-8 h-px bg-border my-1" />

          <Tooltip v-for="(conv, idx) in conversations" :key="conv.id">
            <TooltipTrigger as-child>
              <div
                :draggable="enableReordering"
                @dragstart="onTabDragStart(conv.id, idx, $event)"
                @dragover="onTabDragOver(idx, $event)"
                @dragend="onTabDragEnd"
              >
                <IconItem
                  :conversation="conv"
                  :is-active="conv.id === activeConversationId"
                  :closable="conversations.length > 1"
                  @click="$emit('conversation-select', conv.id)"
                  @close="$emit('conversation-close', conv.id)"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" :side-offset="12" class="font-medium">
              <p>{{ conv.title || t('sidebar.newConversation') }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <!-- Drag insert indicator -->
        <div
          v-if="dragInsertIndex !== -1"
          class="absolute left-2 right-2 h-0.5 bg-primary z-10 pointer-events-none rounded-full shadow-lg"
          :style="{ top: dragInsertPosition + 'px' }"
        />
      </div>

      <!-- Empty state -->
      <div
        v-if="conversations.length === 0"
        class="flex flex-col items-center justify-center h-32 text-muted-foreground px-2"
      >
        <Icon icon="lucide:message-square-plus" class="w-8 h-8 mb-2 opacity-30" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import IconItem from './IconItem.vue'
import type { ConversationMeta } from '@/stores/sidebarStore'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    conversations: ConversationMeta[]
    activeConversationId?: string
    enableReordering?: boolean
  }>(),
  {
    enableReordering: true
  }
)

const emit = defineEmits<{
  'conversation-select': [conversationId: string]
  'conversation-close': [conversationId: string]
  'conversation-reorder': [payload: { conversationId: string; fromIndex: number; toIndex: number }]
  home: []
}>()

// Drag and drop state
const listContainer = ref<HTMLElement | null>(null)
const dragInsertIndex = ref(-1)
const dragInsertPosition = ref(0)
const dragSourceIndex = ref(-1)
const dragSourceId = ref<string | null>(null)

// Drag handlers
const onTabDragStart = (id: string, idx: number, e: DragEvent) => {
  dragSourceId.value = id
  dragSourceIndex.value = idx
  e.dataTransfer?.setData('text/plain', id)
  e.dataTransfer!.effectAllowed = 'move'
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
