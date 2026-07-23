<template>
  <NodeViewWrapper
    class="file-chip inline-flex items-center gap-1 rounded-md border border-muted-foreground/25 bg-muted/25 px-1.5 py-0.5 text-xs text-muted-foreground select-none"
    data-file-attachment
    as="span"
  >
    <Icon :icon="fileIcon" class="h-3 w-3 shrink-0" />
    <span class="truncate max-w-[120px]">{{ node.attrs.fileName }}</span>
    <DropdownMenu v-if="isImage">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          contenteditable="false"
          data-testid="attachment-representation-trigger"
          class="inline-flex h-4 items-center gap-0.5 rounded-sm px-1 text-[10px] font-medium text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
          :title="representationLabel"
          :aria-label="t('chat.attachments.chooseRepresentation', { name: node.attrs.fileName })"
          @mousedown.stop
        >
          <Icon :icon="representationIcon" class="h-3 w-3" />
          <Icon icon="lucide:chevron-down" class="h-2.5 w-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-44" @mousedown.stop>
        <DropdownMenuLabel>{{ t('chat.attachments.representation') }}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="requestedRepresentation"
          @update:model-value="handleRepresentationChange"
        >
          <DropdownMenuRadioItem value="auto">
            {{ t('chat.attachments.auto') }}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="image">
            {{ t('chat.attachments.sendImage') }}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="ocr_text">
            {{ t('chat.attachments.useOcrText') }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'
import {
  isImageAttachment,
  normalizeAttachmentRepresentationPreference
} from '@shared/utils/attachmentRepresentation'
import { INPUT_NODE_ACTIONS, type InputNodeActions } from './symbols'

const props = defineProps<NodeViewProps>()
const actions = inject<InputNodeActions>(INPUT_NODE_ACTIONS)
const { t } = useI18n()

const fileIcon = computed(() => {
  const mimeType = (props.node.attrs.mimeType as string) || ''
  return getMimeTypeIcon(mimeType)
})

const isImage = computed(() =>
  isImageAttachment({
    name: String(props.node.attrs.fileName || ''),
    path: String(props.node.attrs.filePath || ''),
    mimeType: String(props.node.attrs.mimeType || ''),
    type: undefined
  })
)
const requestedRepresentation = computed<AttachmentRepresentationPreference>(
  () =>
    normalizeAttachmentRepresentationPreference(props.node.attrs.requestedRepresentation) ?? 'auto'
)
const representationLabel = computed(() =>
  t(
    `chat.attachments.${requestedRepresentation.value === 'ocr_text' ? 'useOcrText' : requestedRepresentation.value === 'image' ? 'sendImage' : 'auto'}`
  )
)
const representationIcon = computed(() => {
  if (requestedRepresentation.value === 'ocr_text') return 'lucide:scan-text'
  if (requestedRepresentation.value === 'image') return 'lucide:image'
  return 'lucide:wand-sparkles'
})

function handleRepresentationChange(value: unknown) {
  const preference = normalizeAttachmentRepresentationPreference(value)
  const filePath = props.node.attrs.filePath as string
  if (!preference || !filePath) {
    return
  }

  props.updateAttributes({ requestedRepresentation: preference })
  actions?.setFileRepresentation?.(filePath, preference)
}

function handleRemove() {
  const filePath = props.node.attrs.filePath as string
  props.deleteNode()
  if (filePath && actions?.removeFile) {
    actions.removeFile(filePath)
  }
}
</script>
