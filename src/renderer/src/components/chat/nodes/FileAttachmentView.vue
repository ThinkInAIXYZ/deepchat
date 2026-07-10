<template>
  <NodeViewWrapper
    class="file-chip inline-flex items-center gap-1 rounded-md border border-muted-foreground/25 bg-muted/25 px-1.5 py-0.5 text-xs text-muted-foreground select-none"
    data-file-attachment
    as="span"
  >
    <Icon :icon="fileIcon" class="h-3 w-3 shrink-0" />
    <span class="truncate max-w-[120px]">{{ node.attrs.fileName }}</span>
    <button
      type="button"
      class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
      :aria-label="`${t('common.delete')} ${node.attrs.fileName}`"
      @mousedown.prevent="handleRemove"
    >
      <Icon icon="lucide:x" class="h-3 w-3" />
    </button>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { Icon } from '@iconify/vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { getMimeTypeIcon } from '@/lib/utils'
import { INPUT_NODE_ACTIONS, type InputNodeActions } from './symbols'

const props = defineProps<NodeViewProps>()
const actions = inject<InputNodeActions>(INPUT_NODE_ACTIONS)
const { t } = useI18n()

const fileIcon = computed(() => {
  const mimeType = (props.node.attrs.mimeType as string) || ''
  return getMimeTypeIcon(mimeType)
})

function handleRemove() {
  const filePath = props.node.attrs.filePath as string
  props.deleteNode()
  if (filePath && actions?.removeFile) {
    actions.removeFile(filePath)
  }
}
</script>
