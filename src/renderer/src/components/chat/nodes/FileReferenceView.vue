<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'
import { createWindowClient } from '@api/WindowClient'
import { getReferencePathLabel } from '@shared/messageInlineItems'
import ReferenceChip from '../ReferenceChip.vue'

const props = defineProps<NodeViewProps>()
const label = computed(() => {
  const paths: string[] = []
  props.editor.state.doc.descendants((node) => {
    if (node.type.name === 'fileReference') paths.push(node.attrs.relativePath)
  })
  return getReferencePathLabel(props.node.attrs.relativePath, paths)
})
const open = () => createWindowClient().previewFile(props.node.attrs.filePath)
function remove() {
  props.deleteNode()
  props.editor.commands.focus()
}
</script>

<template>
  <NodeViewWrapper as="span" contenteditable="false" data-file-reference>
    <ReferenceChip
      kind="file"
      :label="label"
      :source="node.attrs.filePath"
      removable
      @open="open"
      @remove="remove"
    />
  </NodeViewWrapper>
</template>
