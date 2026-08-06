<template>
  <NodeViewWrapper
    class="file-chip group inline-flex items-center gap-1 rounded-md border border-muted-foreground/25 bg-muted/25 px-1.5 py-0.5 text-xs text-muted-foreground select-none"
    data-file-attachment
    as="span"
  >
    <Icon :icon="fileIcon" class="h-3 w-3 shrink-0" />
    <span class="truncate max-w-[120px]">{{ node.attrs.fileName }}</span>
    <DropdownMenu v-if="hasRepresentationChoice" @update:open="handleMenuOpenChange">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          contenteditable="false"
          data-testid="attachment-representation-trigger"
          class="attachment-representation-trigger inline-flex h-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-medium transition-[color,background-color,opacity] hover:bg-muted-foreground/20 hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          :class="
            hasExplicitPreference
              ? 'max-w-20 gap-0.5 border border-border/70 bg-background/70 px-1 text-foreground opacity-100'
              : 'w-4 px-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          "
          :title="
            hasExplicitPreference
              ? representationLabel
              : t('chat.attachments.chooseRepresentation', { name: node.attrs.fileName })
          "
          :aria-label="t('chat.attachments.chooseRepresentation', { name: node.attrs.fileName })"
          @mousedown.stop
        >
          <span v-if="hasExplicitPreference" class="truncate">{{ representationLabel }}</span>
          <Icon
            :icon="hasExplicitPreference ? 'lucide:chevron-down' : 'lucide:ellipsis'"
            class="h-2.5 w-2.5 shrink-0"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-48 max-w-72" @mousedown.stop>
        <DropdownMenuRadioGroup
          :model-value="requestedRepresentation"
          @update:model-value="handleRepresentationChange"
        >
          <DropdownMenuRadioItem
            v-for="option in representationOptions"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            <span class="min-w-0">
              <span class="block">{{ t(option.labelKey) }}</span>
              <span
                v-if="option.disabledReason"
                class="mt-0.5 block text-[10px] leading-tight text-muted-foreground"
              >
                {{ option.disabledReason }}
              </span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <template v-if="isImage && supportsVision === false">
          <DropdownMenuSeparator />
          <DcDropdownActionItem
            icon="lucide:scan-eye"
            :label="t('chat.attachments.switchVisionModel')"
            @select="handleSwitchToVisionModel"
          />
        </template>
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'
import {
  isImageAttachment,
  isPdfAttachment,
  normalizeAttachmentRepresentationPreferenceForFile
} from '@shared/utils/attachmentRepresentation'
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
  type: undefined
}))
const isImage = computed(() => isImageAttachment(attachmentFile.value))
const isPdf = computed(() => isPdfAttachment(attachmentFile.value))
const isAcpSession = computed(() => attachmentContext?.isAcpSession.value ?? false)
const supportsVision = computed(() => attachmentContext?.supportsVision.value ?? null)
const ocrAvailability = computed(
  () => attachmentContext?.ocrAvailability.value ?? { status: 'unknown' as const }
)
const hasRepresentationChoice = computed(
  () => !isAcpSession.value && (isImage.value || isPdf.value)
)
const requestedRepresentation = computed<AttachmentRepresentationPreference>(() =>
  normalizeAttachmentRepresentationPreferenceForFile(
    attachmentFile.value,
    props.node.attrs.requestedRepresentation
  )
)
const hasExplicitPreference = computed(() => requestedRepresentation.value !== 'auto')
const isOcrKnownUnavailable = computed(() => ocrAvailability.value.status === 'unavailable')
const ocrUnavailableReason = computed(() => {
  const availability = ocrAvailability.value
  return availability.status === 'unavailable'
    ? t(`settings.ocr.unavailableReasons.${availability.reason}`)
    : undefined
})
const representationOptions = computed<
  Array<{
    value: AttachmentRepresentationPreference
    labelKey: string
    disabled?: boolean
    disabledReason?: string
  }>
>(() => {
  if (isPdf.value) {
    return [
      { value: 'auto', labelKey: 'chat.attachments.auto' },
      { value: 'embedded_text', labelKey: 'chat.attachments.useEmbeddedText' },
      {
        value: 'ocr_text',
        labelKey: 'chat.attachments.useOcrText',
        disabled: isOcrKnownUnavailable.value,
        disabledReason: ocrUnavailableReason.value
      }
    ]
  }
  if (isImage.value) {
    return [
      { value: 'auto', labelKey: 'chat.attachments.auto' },
      {
        value: 'image',
        labelKey: 'chat.attachments.sendImage',
        disabled: supportsVision.value === false,
        disabledReason:
          supportsVision.value === false
            ? t('chat.attachments.reasons.requested_image_requires_vision')
            : undefined
      },
      {
        value: 'ocr_text',
        labelKey: 'chat.attachments.useOcrText',
        disabled: isOcrKnownUnavailable.value,
        disabledReason: ocrUnavailableReason.value
      }
    ]
  }
  return []
})
const representationLabel = computed(() => {
  const labelKeys: Record<AttachmentRepresentationPreference, string> = {
    auto: 'chat.attachments.auto',
    image: 'chat.attachments.imageBadge',
    embedded_text: 'chat.attachments.embeddedTextBadge',
    ocr_text: 'chat.attachments.ocrBadge'
  }
  return t(labelKeys[requestedRepresentation.value])
})

function handleRepresentationChange(value: unknown) {
  const preference = normalizeAttachmentRepresentationPreferenceForFile(attachmentFile.value, value)
  if (
    isAcpSession.value ||
    (preference === 'image' && supportsVision.value === false) ||
    (preference === 'ocr_text' && isOcrKnownUnavailable.value)
  ) {
    return
  }
  const filePath = props.node.attrs.filePath as string
  if (!filePath) {
    return
  }

  props.updateAttributes({ requestedRepresentation: preference })
  actions?.setFileRepresentation?.(filePath, preference)
}

function handleMenuOpenChange(open: boolean): void {
  if (open) {
    void attachmentContext?.refreshOcrAvailability()
  }
}

function handleSwitchToVisionModel(): void {
  actions?.switchToVisionModel()
}

function handleRemove() {
  const filePath = props.node.attrs.filePath as string
  props.deleteNode()
  if (filePath && actions?.removeFile) {
    actions.removeFile(filePath)
  }
}
</script>

<style scoped>
@media (pointer: coarse) {
  .attachment-representation-trigger {
    opacity: 1;
  }
}
</style>
