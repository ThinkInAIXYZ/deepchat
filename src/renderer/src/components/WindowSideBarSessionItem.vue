<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <button
        type="button"
        class="no-drag flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-all duration-150"
        :class="
          active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50'
        "
        @click="$emit('select', session)"
      >
        <Icon
          v-if="session.isPinned"
          icon="lucide:pin"
          class="w-3.5 h-3.5 text-yellow-500 shrink-0"
        />
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
      </button>
    </ContextMenuTrigger>

    <ContextMenuContent class="w-48">
      <ContextMenuItem @select="$emit('toggle-pin', session)">
        <Icon :icon="session.isPinned ? 'lucide:pin-off' : 'lucide:pin'" class="mr-2 h-4 w-4" />
        <span>{{ session.isPinned ? t('thread.actions.unpin') : t('thread.actions.pin') }}</span>
      </ContextMenuItem>
      <ContextMenuItem @select="$emit('rename', session)">
        <Icon icon="lucide:pencil" class="mr-2 h-4 w-4" />
        <span>{{ t('thread.actions.rename') }}</span>
      </ContextMenuItem>
      <ContextMenuItem @select="$emit('clear', session)">
        <Icon icon="lucide:eraser" class="mr-2 h-4 w-4" />
        <span>{{ t('thread.actions.cleanMessages') }}</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem class="text-destructive" @select="$emit('delete', session)">
        <Icon icon="lucide:trash-2" class="mr-2 h-4 w-4" />
        <span>{{ t('thread.actions.delete') }}</span>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
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

const { t } = useI18n()
</script>

<style scoped>
.no-drag {
  -webkit-app-region: no-drag;
}
</style>
