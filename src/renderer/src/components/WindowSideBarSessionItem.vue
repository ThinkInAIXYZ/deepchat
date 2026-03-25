<template>
  <div
    class="session-item no-drag flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-all duration-150"
    :class="active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50'"
    @click="$emit('select', session)"
  >
    <span class="flex-1 text-sm truncate">{{ session.title }}</span>
    <span v-if="session.status === 'working'" class="shrink-0">
      <Icon icon="lucide:loader-2" class="w-3.5 h-3.5 text-primary animate-spin" />
    </span>
    <span v-else-if="session.status === 'completed'" class="shrink-0">
      <Icon icon="lucide:check" class="w-3.5 h-3.5 text-green-500" />
    </span>
    <span v-else-if="session.status === 'error'" class="shrink-0">
      <Icon icon="lucide:alert-circle" class="w-3.5 h-3.5 text-destructive" />
    </span>
    <span class="right-button flex gap-2 items-center opacity-0 transition-all">
      <Icon
        @click.stop="$emit('delete', session)"
        icon="lucide:trash-2"
        class="h-4 w-4 cursor-pointer hover:text-primary"
      />
      <Icon
        @click.stop="$emit('toggle-pin', session)"
        :icon="session.isPinned ? 'lucide:pin-off' : 'lucide:pin'"
        class="h-4 w-4 hover:text-primary cursor-pointer"
      />
    </span>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'

import type { UISession } from '@/stores/ui/session'

defineOptions({
  name: 'WindowSideBarSessionItem'
})

defineProps<{
  session: UISession
  active: boolean
}>()

defineEmits<{
  select: [session: UISession]
  'toggle-pin': [session: UISession]
  rename: [session: UISession]
  clear: [session: UISession]
  delete: [session: UISession]
}>()
</script>

<style scoped>
.no-drag {
  -webkit-app-region: no-drag;
}

.session-item:hover .right-button {
  display: flex;
  opacity: 1;
}
</style>
