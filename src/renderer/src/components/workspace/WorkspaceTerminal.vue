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
        {{ t(sectionKey) }}
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
      <div v-if="showTerminal" class="space-y-0 overflow-hidden">
        <div
          v-if="store.terminalSnippets.length === 0"
          class="px-4 py-3 text-[11px] text-muted-foreground"
        >
          {{ t(`${terminalKeyPrefix}.empty`) }}
        </div>
        <ul v-else class="pb-1">
          <li v-for="snippet in store.terminalSnippets" :key="snippet.id">
            <div
              class="flex w-full items-center gap-2 py-2 pr-4 text-left text-xs text-muted-foreground pl-7"
            >
              <span class="flex h-4 w-4 shrink-0 items-center justify-center">
                <Icon
                  :icon="getStatusIcon(getDisplayStatus(snippet.status))"
                  :class="getStatusIconClass(getDisplayStatus(snippet.status))"
                />
              </span>
              <span class="flex-1 min-w-0 truncate text-[12px] font-medium">
                {{ snippet.command }}
              </span>
              <span
                class="text-[10px]"
                :class="getStatusLabelClass(getDisplayStatus(snippet.status))"
              >
                {{ getStatusLabel(getDisplayStatus(snippet.status)) }}
              </span>
            </div>
          </li>
        </ul>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'

const { t } = useI18n()
const store = useWorkspaceStore()
const chatMode = useChatMode()
const showTerminal = ref(true)

const i18nPrefix = computed(() =>
  chatMode.currentMode.value === 'acp agent' ? 'chat.acp.workspace' : 'chat.workspace'
)

const terminalKeyPrefix = computed(() => `${i18nPrefix.value}.terminal`)
const sectionKey = computed(() => `${terminalKeyPrefix.value}.section`)

const getDisplayStatus = (status: string) => {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'completed'
  return 'failed'
}

const statusColorMap: Record<string, string> = {
  running: 'text-sky-500',
  completed: 'text-green-500',
  failed: 'text-red-500'
}

const statusIconClassMap: Record<string, string> = {
  running: 'h-3.5 w-3.5 animate-spin text-sky-500',
  completed: 'h-3.5 w-3.5 text-green-500',
  failed: 'h-3.5 w-3.5 text-red-500'
}

const statusIconMap: Record<string, string> = {
  running: 'lucide:loader-2',
  completed: 'lucide:check',
  failed: 'lucide:x'
}

const getStatusLabelClass = (status: string) => statusColorMap[status] ?? 'text-muted-foreground'
const getStatusIconClass = (status: string) =>
  statusIconClassMap[status] ?? 'h-3.5 w-3.5 text-muted-foreground'
const getStatusIcon = (status: string) => statusIconMap[status] ?? 'lucide:circle-small'
const getStatusLabel = (status: string) => t(`${terminalKeyPrefix.value}.status.${status}`)
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
