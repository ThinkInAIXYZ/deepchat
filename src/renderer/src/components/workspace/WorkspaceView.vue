<template>
  <aside class="workspace box-border flex h-full flex-col transition-all dark:border-white/10">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:layout-dashboard" class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t(titleKey) }}
        </h2>
      </div>
      <button
        class="flex h-5 w-5 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:bg-muted/50"
        type="button"
        @click="store.setOpen(false)"
        :aria-label="t(collapseKey)"
      >
        <Icon icon="lucide:chevron-right" class="h-3 w-3" />
      </button>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Files Section -->
      <WorkspaceFiles @append-path="emit('append-file-path', $event)" />

      <!-- Browser Tabs Section (agent mode only) -->
      <WorkspaceBrowserTabs v-if="showBrowserTabs" />

      <!-- Plan Section (hidden when empty) -->
      <WorkspacePlan />

      <!-- Terminal Section (hidden when empty) -->
      <WorkspaceTerminal />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useYoBrowserStore } from '@/stores/yoBrowser'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'
import WorkspacePlan from './WorkspacePlan.vue'
import WorkspaceFiles from './WorkspaceFiles.vue'
import WorkspaceTerminal from './WorkspaceTerminal.vue'
import WorkspaceBrowserTabs from './WorkspaceBrowserTabs.vue'

const { t } = useI18n()
const store = useWorkspaceStore()
const yoBrowserStore = useYoBrowserStore()
const chatMode = useChatMode()
const showBrowserTabs = computed(
  () => chatMode.currentMode.value === 'agent' && yoBrowserStore.tabCount > 0
)

const i18nPrefix = computed(() => 'chat.workspace')
const titleKey = computed(() => `${i18nPrefix.value}.title`)
const collapseKey = computed(() => `${i18nPrefix.value}.collapse`)

const emit = defineEmits<{
  'append-file-path': [filePath: string]
}>()
</script>
