<script lang="ts">
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { getReferencePathLabels } from '@shared/messageInlineItems'

// ProseMirror documents are immutable. Share one projection across their node views and let
// discarded documents (including closed editors) be collected without a separate lifecycle.
const labelsByDocument = new WeakMap<ProseMirrorNode, Map<string, string>>()
function getDocumentLabels(doc: ProseMirrorNode) {
  let labels = labelsByDocument.get(doc)
  if (!labels) {
    const paths: string[] = []
    doc.descendants((node) => {
      if (node.type.name === 'fileReference') paths.push(node.attrs.relativePath)
    })
    labels = getReferencePathLabels(paths)
    labelsByDocument.set(doc, labels)
  }
  return labels
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'
import { createWindowClient } from '@api/WindowClient'
import ReferenceChip from '../ReferenceChip.vue'

const props = defineProps<NodeViewProps>()
const label = computed(
  () =>
    getDocumentLabels(props.editor.state.doc).get(props.node.attrs.relativePath) ??
    props.node.attrs.relativePath
)
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
