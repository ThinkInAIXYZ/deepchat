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
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <button
                  class="flex w-full items-center gap-2 py-2 pr-4 text-left text-xs text-muted-foreground pl-7 transition hover:bg-muted/40"
                  type="button"
                  @click="handleSnippetClick(snippet.id)"
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
                  <Icon
                    :icon="
                      isSnippetExpanded(snippet.id) ? 'lucide:chevron-down' : 'lucide:chevron-right'
                    "
                    class="h-3 w-3 text-muted-foreground"
                  />
                </button>
              </ContextMenuTrigger>

              <ContextMenuContent class="w-48">
                <ContextMenuItem
                  v-if="snippet.status === 'running'"
                  @select="handleTerminate(snippet.id)"
                >
                  <Icon icon="lucide:stop-circle" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.terminate`) }}
                </ContextMenuItem>
                <ContextMenuItem v-else @select="handleDelete(snippet.id)">
                  <Icon icon="lucide:trash-2" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.delete`) }}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  v-if="isSnippetExpanded(snippet.id)"
                  @select="store.toggleSnippetExpansion(snippet.id)"
                >
                  <Icon icon="lucide:chevron-right" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.collapse`) }}
                </ContextMenuItem>
                <ContextMenuItem v-else @select="handleSnippetClick(snippet.id)">
                  <Icon icon="lucide:chevron-down" class="h-4 w-4" />
                  {{ t(`${terminalKeyPrefix}.contextMenu.expand`) }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <Transition name="terminal-expand">
              <div
                v-if="isSnippetExpanded(snippet.id)"
                :ref="setOutputRef(snippet.id)"
                class="max-h-60 overflow-y-auto px-7 pr-4 pb-2"
              >
                <div class="rounded bg-muted/30 p-2">
                  <div
                    v-if="snippet.output"
                    class="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground/80"
                  >
                    {{ snippet.output }}
                    <span v-if="snippet.truncated" class="ml-2 text-muted-foreground/60">
                      {{ t(`${terminalKeyPrefix}.output.truncated`) }}
                    </span>
                  </div>
                  <div v-else class="text-[10px] text-muted-foreground">
                    {{ t(`${terminalKeyPrefix}.noOutput`) }}
                  </div>
                </div>
              </div>
            </Transition>
          </li>
        </ul>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, type ComponentPublicInstance, type VNodeRef } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
import type { WorkspaceTerminalStatus } from '@shared/presenter'

const { t } = useI18n()
const store = useWorkspaceStore()
const chatMode = useChatMode()
const showTerminal = ref(true)
const expandedOutputRefs = ref<Map<string, HTMLElement>>(new Map())

const i18nPrefix = computed(() =>
  chatMode.currentMode.value === 'acp agent' ? 'chat.acp.workspace' : 'chat.workspace'
)

const terminalKeyPrefix = computed(() => `${i18nPrefix.value}.terminal`)
const sectionKey = computed(() => `${terminalKeyPrefix.value}.section`)

type DisplayStatus = 'running' | 'completed' | 'failed' | 'timed_out'

const isSnippetExpanded = (snippetId: string) => store.expandedSnippetIds.has(snippetId)

const setOutputRef =
  (snippetId: string): VNodeRef =>
  (el) => {
    const node = el instanceof HTMLElement ? el : (el as ComponentPublicInstance | null)?.$el
    if (node instanceof HTMLElement) {
      expandedOutputRefs.value.set(snippetId, node)
    } else {
      expandedOutputRefs.value.delete(snippetId)
    }
  }

const scrollToBottom = (snippetId: string) => {
  nextTick(() => {
    const el = expandedOutputRefs.value.get(snippetId)
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

const handleSnippetClick = (snippetId: string) => {
  store.toggleSnippetExpansion(snippetId)
  if (store.expandedSnippetIds.has(snippetId)) {
    scrollToBottom(snippetId)
  }
}

const handleTerminate = async (snippetId: string) => {
  await store.terminateCommand(snippetId)
}

const handleDelete = (snippetId: string) => {
  store.removeTerminalSnippet(snippetId)
}

const getDisplayStatus = (status: WorkspaceTerminalStatus): DisplayStatus => {
  if (
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'timed_out'
  ) {
    return status
  }
  return 'failed'
}

const statusColorMap: Record<DisplayStatus, string> = {
  running: 'text-sky-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
  timed_out: 'text-amber-500'
}

const statusIconClassMap: Record<DisplayStatus, string> = {
  running: 'h-3.5 w-3.5 animate-spin text-sky-500',
  completed: 'h-3.5 w-3.5 text-green-500',
  failed: 'h-3.5 w-3.5 text-red-500',
  timed_out: 'h-3.5 w-3.5 text-amber-500'
}

const statusIconMap: Record<DisplayStatus, string> = {
  running: 'lucide:loader-2',
  completed: 'lucide:check',
  failed: 'lucide:x',
  timed_out: 'lucide:clock'
}

const getStatusLabelClass = (status: DisplayStatus) =>
  statusColorMap[status] ?? 'text-muted-foreground'
const getStatusIconClass = (status: DisplayStatus) =>
  statusIconClassMap[status] ?? 'h-3.5 w-3.5 text-muted-foreground'
const getStatusIcon = (status: DisplayStatus) => statusIconMap[status] ?? 'lucide:circle-small'
const getStatusLabel = (status: DisplayStatus) => t(`${terminalKeyPrefix.value}.status.${status}`)
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

.terminal-expand-enter-active,
.terminal-expand-leave-active {
  transition: all 0.2s ease;
}

.terminal-expand-enter-from,
.terminal-expand-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}

.terminal-expand-enter-to,
.terminal-expand-leave-from {
  opacity: 1;
  max-height: 15rem;
  transform: translateY(0);
}
</style>
