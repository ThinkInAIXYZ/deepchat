<template>
  <div
    class="icon-item group relative flex items-center justify-center w-12 h-12 cursor-pointer transition-all duration-200"
    :class="{
      active: isActive
    }"
    @click="$emit('click')"
  >
    <!-- Left pill indicator (Discord-style) -->
    <div
      class="absolute -left-2 w-1 bg-foreground rounded-r-full transition-all duration-200 ease-out"
      :class="{
        'h-10': isActive,
        'h-5 opacity-0 group-hover:opacity-100': !isActive
      }"
    />

    <!-- Icon container with smooth transitions -->
    <div
      class="flex items-center justify-center w-12 h-12 rounded-2xl transition-all duration-200 ease-out"
      :class="{
        'bg-primary/10 scale-100': isActive,
        'bg-muted/30 scale-90 group-hover:scale-100 group-hover:bg-accent/50 group-hover:rounded-xl':
          !isActive
      }"
    >
      <!-- Loading state -->
      <Icon
        v-if="conversation.isLoading"
        icon="lucide:loader-2"
        class="w-7 h-7 animate-spin text-muted-foreground"
      />
      <!-- Error state -->
      <Icon
        v-else-if="conversation.hasError"
        icon="lucide:alert-circle"
        class="w-7 h-7 text-destructive"
      />
      <!-- Model/Agent icon -->
      <ModelIcon
        v-else
        :model-id="iconId"
        custom-class="w-7 h-7 rounded-lg transition-transform duration-200"
        :class="{ 'scale-110': isActive }"
      />
    </div>

    <!-- Close button (appears on hover) -->
    <Button
      v-if="closable"
      variant="ghost"
      size="icon"
      class="absolute -top-1 -right-1 w-5 h-5 p-0 rounded-full bg-background/90 backdrop-blur-sm border border-border/50 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-md hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
      @click.stop="$emit('close')"
    >
      <Icon icon="lucide:x" class="w-3 h-3" />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import type { ConversationMeta } from '@/stores/sidebarStore'

const props = defineProps<{
  conversation: ConversationMeta
  isActive: boolean
  closable?: boolean
}>()

defineEmits<{
  click: []
  close: []
}>()

// Resolve the icon ID based on chat mode and model/agent ID
const iconId = computed(() => {
  // Use modelIcon which stores modelId (or agentId for ACP mode)
  // ModelIcon.vue handles the mapping to actual icon files
  return props.conversation.modelIcon || 'default'
})
</script>
