<template>
  <div>
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <button
          class="flex w-full items-center gap-1.5 px-4 py-1 text-left text-xs transition hover:bg-muted/40"
          :style="{ paddingLeft: `${16 + depth * 12}px` }"
          type="button"
          @click="handleClick"
        >
          <!-- Expand/collapse icon for directories -->
          <Icon
            v-if="node.isDirectory"
            :icon="node.expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
            class="h-3 w-3 flex-shrink-0 text-muted-foreground"
          />
          <span v-else class="w-3" />

          <!-- File/folder icon -->
          <Icon :icon="iconName" class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />

          <!-- Name -->
          <span class="truncate text-foreground/90 dark:text-white/80">
            {{ node.name }}
          </span>
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent
        class="w-48"
        align="start"
        :side="depth === 0 ? 'bottom' : 'right'"
        :side-offset="4"
      >
        <ContextMenuItem v-if="!node.isDirectory" @select="handleOpenFile">
          <Icon icon="lucide:external-link" class="h-4 w-4" />
          {{ t('chat.acp.workspace.files.contextMenu.openFile') }}
        </ContextMenuItem>
        <ContextMenuItem @select="handleRevealInFolder">
          <Icon icon="lucide:folder-open-dot" class="h-4 w-4" />
          {{ t('chat.acp.workspace.files.contextMenu.revealInFolder') }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="handleAppendFromMenu">
          <Icon icon="lucide:arrow-down-left" class="h-4 w-4" />
          {{ t('chat.acp.workspace.files.contextMenu.insertPath') }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <!-- Recursive children -->
    <template v-if="node.isDirectory && node.expanded && node.children">
      <AcpWorkspaceFileNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @toggle="$emit('toggle', $event)"
        @append-path="$emit('append-path', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
import type { AcpFileNode } from '@shared/presenter'

const props = defineProps<{
  node: AcpFileNode
  depth: number
}>()

const emit = defineEmits<{
  toggle: [node: AcpFileNode]
  'append-path': [filePath: string]
}>()

const { t } = useI18n()
const acpWorkspacePresenter = usePresenter('acpWorkspacePresenter')

const extensionIconMap: Record<string, string> = {
  pdf: 'lucide:file-text',
  md: 'lucide:file-text',
  markdown: 'lucide:file-text',
  txt: 'lucide:file-text',
  js: 'lucide:file-code',
  ts: 'lucide:file-code',
  tsx: 'lucide:file-code',
  jsx: 'lucide:file-code',
  vue: 'lucide:file-code',
  json: 'lucide:file-json',
  yml: 'lucide:file-cog',
  yaml: 'lucide:file-cog',
  png: 'lucide:image',
  jpg: 'lucide:image',
  jpeg: 'lucide:image',
  gif: 'lucide:image',
  svg: 'lucide:image',
  mp4: 'lucide:file-video',
  mov: 'lucide:file-video',
  mp3: 'lucide:music',
  wav: 'lucide:music',
  zip: 'lucide:archive',
  tar: 'lucide:archive',
  gz: 'lucide:archive'
}

const iconName = computed(() => {
  if (props.node.isDirectory) {
    return props.node.expanded ? 'lucide:folder-open' : 'lucide:folder-closed'
  }
  const ext = props.node.name.split('.').pop()?.toLowerCase()
  if (ext && extensionIconMap[ext]) {
    return extensionIconMap[ext]
  }
  return 'lucide:file'
})

const emitAppendPath = () => emit('append-path', props.node.path)

const handleClick = () => {
  if (props.node.isDirectory) {
    emit('toggle', props.node)
    return
  }

  emitAppendPath()
}

const handleOpenFile = async () => {
  if (props.node.isDirectory) {
    return
  }

  try {
    await acpWorkspacePresenter.openFile(props.node.path)
  } catch (error) {
    console.error(`[AcpWorkspace] Failed to open file: ${props.node.path}`, error)
  }
}

const handleRevealInFolder = async () => {
  try {
    await acpWorkspacePresenter.revealFileInFolder(props.node.path)
  } catch (error) {
    console.error(`[AcpWorkspace] Failed to reveal path: ${props.node.path}`, error)
  }
}

const handleAppendFromMenu = () => {
  emitAppendPath()
}
</script>
