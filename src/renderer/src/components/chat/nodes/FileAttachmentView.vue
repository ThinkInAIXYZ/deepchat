<template>
  <NodeViewWrapper
    class="file-chip group inline-flex items-center gap-1 rounded-md border border-muted-foreground/25 bg-muted/25 px-1.5 py-0.5 text-xs text-muted-foreground select-none"
    data-file-attachment
    as="span"
  >
    <Icon :icon="fileIcon" class="h-3 w-3 shrink-0" />
    <span class="truncate max-w-[120px]">{{ node.attrs.fileName }}</span>
    <AttachmentRepresentationMenu
      v-if="actions?.setFileRepresentation"
      :file="attachmentFile"
      :is-acp-session="isAcpSession"
      :supports-vision="supportsVision"
      :ocr-availability="ocrAvailability"
      @refresh-ocr-availability="attachmentContext?.refreshOcrAvailability()"
      @update:representation="handleRepresentationChange"
      @switch-vision-model="actions?.switchToVisionModel()"
    />
    <button
      type="button"
      class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-muted-foreground/20"
      :aria-label="`${t('common.delete')} ${node.attrs.fileName}`"
      contenteditable="false"
      @mousedown.prevent
      @keydown.stop
      @click="handleRemove"
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
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'
import AttachmentRepresentationMenu from '../AttachmentRepresentationMenu.vue'
import { ATTACHMENT_NODE_CONTEXT, INPUT_NODE_ACTIONS, type InputNodeActions } from './symbols'

const props = defineProps<NodeViewProps>()
const actions = inject<InputNodeActions>(INPUT_NODE_ACTIONS)
const attachmentContext = inject(ATTACHMENT_NODE_CONTEXT)
const { t } = useI18n()

const fileIcon = computed(() => {
  const mimeType = (props.node.attrs.mimeType as string) || ''
  return getMimeTypeIcon(mimeType)
})

const attachmentFile = computed(() => ({
  name: String(props.node.attrs.fileName || ''),
  path: String(props.node.attrs.filePath || ''),
  mimeType: String(props.node.attrs.mimeType || ''),
  requestedRepresentation: props.node.attrs.requestedRepresentation,
  type: undefined
}))
const isAcpSession = computed(() => attachmentContext?.isAcpSession.value ?? false)
const supportsVision = computed(() => attachmentContext?.supportsVision.value ?? null)
const ocrAvailability = computed(
  () => attachmentContext?.ocrAvailability.value ?? { status: 'unknown' as const }
)

function handleRepresentationChange(preference: AttachmentRepresentationPreference) {
  const filePath = props.node.attrs.filePath as string
  if (!filePath) {
    return
  }

  props.updateAttributes({ requestedRepresentation: preference })
  actions?.setFileRepresentation?.(filePath, preference)
}

function handleRemove() {
  props.deleteNode()
  props.editor.commands.focus()
}
</script>
