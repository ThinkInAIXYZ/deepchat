<template>
  <div
    :dir="langStore.dir"
    :class="[
      'select-none px-3 py-2 rounded-md text-sm cursor-pointer group flex items-center gap-2 transition-colors',
      active ? 'bg-accent border-l-2 border-primary' : 'hover:bg-muted',
      conversation.isLoading ? 'opacity-70' : '',
      conversation.hasError ? 'text-destructive' : ''
    ]"
    :draggable="draggable"
    @click="$emit('click', conversation.id)"
    @dragstart="handleDragStart"
    @dragend="$emit('dragend', conversation.id, $event)"
  >
    <!-- Icon -->
    <div class="shrink-0 w-5 h-5 flex items-center justify-center">
      <Icon
        v-if="conversation.isLoading"
        icon="lucide:loader-2"
        class="w-4 h-4 animate-spin text-muted-foreground"
      />
      <Icon
        v-else-if="conversation.hasError"
        icon="lucide:alert-circle"
        class="w-4 h-4 text-destructive"
      />
      <Icon v-else icon="lucide:message-square" class="w-4 h-4 text-muted-foreground" />
    </div>

    <!-- Title -->
    <span class="flex-1 truncate" :title="conversation.title">
      {{ conversation.title || t('sidebar.newConversation') }}
    </span>

    <!-- Close button -->
    <Button
      v-if="closable"
      variant="ghost"
      size="icon"
      class="shrink-0 w-5 h-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
      @click.stop="$emit('close', conversation.id, $event)"
    >
      <Icon icon="lucide:x" class="w-3 h-3" />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import type { ConversationMeta } from '@/stores/sidebarStore'

const langStore = useLanguageStore()
const { t } = useI18n()

const props = defineProps<{
  conversation: ConversationMeta
  active: boolean
  closable?: boolean
  draggable?: boolean
}>()

const emit = defineEmits<{
  click: [conversationId: string]
  close: [conversationId: string, event: MouseEvent]
  dragstart: [conversationId: string, event: DragEvent]
  dragend: [conversationId: string, event: DragEvent]
}>()

const handleDragStart = (e: DragEvent) => {
  if (!props.draggable) {
    e.preventDefault()
    return
  }
  e.dataTransfer?.setData('text/plain', props.conversation.id)
  e.dataTransfer!.effectAllowed = 'move'
  emit('dragstart', props.conversation.id, e)
}
</script>
