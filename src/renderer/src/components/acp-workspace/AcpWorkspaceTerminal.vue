<template>
  <section v-if="store.terminalSnippets.length > 0" class="mt-2 px-0">
    <button
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/40"
      type="button"
      @click="showTerminal = !showTerminal"
    >
      <Icon icon="lucide:terminal" class="h-3.5 w-3.5" />
      <span
        class="flex-1 text-[12px] font-medium tracking-wide text-foreground/80 dark:text-white/80"
      >
        {{ t('chat.acp.workspace.terminal.section') }}
      </span>
      <span class="text-[10px] text-muted-foreground">
        {{ store.terminalSnippets.length }}
      </span>
      <Icon
        :icon="showTerminal ? 'lucide:chevron-down' : 'lucide:chevron-up'"
        class="h-3 w-3 text-muted-foreground"
      />
    </button>

    <Transition name="workspace-collapse">
      <div v-if="showTerminal" class="space-y-0 overflow-hidden pb-1">
        <div
          v-for="snippet in store.terminalSnippets"
          :key="snippet.id"
          class="px-4 py-2 border-b border-border/50 last:border-b-0"
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] text-muted-foreground">$</span>
            <span class="text-xs font-mono text-foreground/90 truncate">
              {{ snippet.command }}
            </span>
            <span
              v-if="snippet.exitCode !== null && snippet.exitCode !== undefined"
              class="ml-auto text-[10px]"
              :class="snippet.exitCode === 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ snippet.exitCode }}
            </span>
          </div>
          <pre
            v-if="snippet.output"
            class="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap break-all max-h-20 overflow-y-auto"
            >{{ snippet.output }}</pre
          >
          <span v-if="snippet.truncated" class="text-[10px] text-muted-foreground italic">
            (truncated)
          </span>
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useAcpWorkspaceStore } from '@/stores/acpWorkspace'

const { t } = useI18n()
const store = useAcpWorkspaceStore()
const showTerminal = ref(true)
</script>

<style scoped>
.workspace-collapse-enter-active,
.workspace-collapse-leave-active {
  transition: all 0.18s ease;
}

.workspace-collapse-enter-from,
.workspace-collapse-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
}

.workspace-collapse-enter-to,
.workspace-collapse-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 200px;
}
</style>
