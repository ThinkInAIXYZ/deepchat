<template>
  <section class="mt-2 px-0">
    <button
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/40"
      type="button"
      @click="showFiles = !showFiles"
    >
      <Icon icon="lucide:folder-open" class="h-3.5 w-3.5" />
      <span
        class="flex-1 text-[12px] font-medium tracking-wide text-foreground/80 dark:text-white/80"
      >
        {{ t('chat.acpWorkspace.filesSection') }}
      </span>
      <span class="text-[10px] text-muted-foreground">
        {{ fileCount }}
      </span>
      <Icon
        :icon="showFiles ? 'lucide:chevron-down' : 'lucide:chevron-up'"
        class="h-3 w-3 text-muted-foreground"
      />
    </button>

    <Transition name="workspace-collapse">
      <div v-if="showFiles" class="space-y-0 overflow-hidden">
        <div v-if="store.isLoading" class="px-4 py-3 text-[11px] text-muted-foreground">
          {{ t('chat.acpWorkspace.filesLoading') }}
        </div>
        <div v-else-if="store.fileTree.length > 0" class="pb-1">
          <AcpWorkspaceFileNode
            v-for="node in store.fileTree"
            :key="node.path"
            :node="node"
            :depth="0"
            @toggle="handleToggle"
          />
        </div>
        <div v-else class="px-4 py-3 text-[11px] text-muted-foreground">
          {{ t('chat.acpWorkspace.filesEmpty') }}
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useAcpWorkspaceStore } from '@/stores/acpWorkspace'
import AcpWorkspaceFileNode from './AcpWorkspaceFileNode.vue'
import type { ACP_FILE_NODE } from '@shared/presenter'

const { t } = useI18n()
const store = useAcpWorkspaceStore()
const showFiles = ref(true)

const countFiles = (nodes: ACP_FILE_NODE[]): number => {
  let count = 0
  for (const node of nodes) {
    count += 1
    if (node.children) {
      count += countFiles(node.children)
    }
  }
  return count
}

const fileCount = computed(() => countFiles(store.fileTree))

const handleToggle = (node: ACP_FILE_NODE) => {
  store.toggleFileNode(node)
}
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
  max-height: 300px;
}
</style>
