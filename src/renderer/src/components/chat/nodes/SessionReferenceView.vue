<template>
  <NodeViewWrapper as="span" contenteditable="false" data-session-reference>
    <ReferenceChip
      kind="session"
      :label="node.attrs.title"
      :source="tooltip"
      removable
      @open="open"
      @remove="remove"
    />
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { useSessionStore } from '@/stores/ui/session'
import ReferenceChip from '../ReferenceChip.vue'

const props = defineProps<NodeViewProps>()
const { t } = useI18n()
const sessionStore = useSessionStore()
const tooltip = computed(() =>
  [props.node.attrs.projectDir, props.node.attrs.sessionId].filter(Boolean).join('\n')
)
function remove() {
  props.deleteNode()
  props.editor.commands.focus()
}

async function open() {
  try {
    await sessionStore.selectSession(props.node.attrs.sessionId, props.node.attrs.tapeIncarnationId)
  } catch {
    notifyRenderer({
      kind: 'error',
      code: 'chat.sessionReference.unavailable',
      title: t('chat.sessionReference.unavailableTitle'),
      description: t('chat.sessionReference.unavailableDescription')
    })
  }
}
</script>
