<template>
  <NodeViewWrapper
    as="span"
    contenteditable="false"
    data-session-reference
    class="inline-flex items-center gap-1 rounded-md border border-muted-foreground/25 bg-muted/25 px-1.5 py-0.5 text-xs text-muted-foreground select-none"
    :title="tooltip"
  >
    <button
      type="button"
      class="inline-flex min-w-0 items-center gap-1 rounded-sm hover:text-foreground"
      :aria-label="t('chat.sessionReference.open', { title: node.attrs.title })"
      @mousedown.prevent
      @keydown.stop
      @click="open"
    >
      <Icon icon="lucide:messages-square" class="h-3 w-3 shrink-0" />
      <span class="max-w-[160px] truncate">{{ node.attrs.title }}</span>
    </button>
    <button
      type="button"
      contenteditable="false"
      class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
      :aria-label="`${t('common.delete')} ${node.attrs.title}`"
      @mousedown.prevent
      @keydown.stop
      @click="remove"
    >
      <Icon icon="lucide:x" class="h-3 w-3" />
    </button>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'
import { useI18n } from 'vue-i18n'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { useSessionStore } from '@/stores/ui/session'

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
