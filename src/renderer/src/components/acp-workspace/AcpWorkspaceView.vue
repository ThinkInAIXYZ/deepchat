<template>
  <aside
    class="acp-workspace box-border flex h-full min-h-[320px] w-[228px] flex-col rounded-br-2xl border-l border-black/5 bg-background shadow-sm transition-all dark:border-white/10"
  >
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:layout-dashboard" class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t('chat.acpWorkspace.title') }}
        </h2>
      </div>
      <button
        class="flex h-5 w-5 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:bg-muted/50"
        type="button"
        @click="store.setOpen(false)"
        :aria-label="t('chat.acpWorkspace.collapse')"
      >
        <Icon icon="lucide:chevron-right" class="h-3 w-3" />
      </button>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Plan Section -->
      <AcpWorkspacePlan />

      <!-- Files Section -->
      <AcpWorkspaceFiles />

      <!-- Terminal Section -->
      <AcpWorkspaceTerminal />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useAcpWorkspaceStore } from '@/stores/acpWorkspace'
import AcpWorkspacePlan from './AcpWorkspacePlan.vue'
import AcpWorkspaceFiles from './AcpWorkspaceFiles.vue'
import AcpWorkspaceTerminal from './AcpWorkspaceTerminal.vue'

const { t } = useI18n()
const store = useAcpWorkspaceStore()
</script>
