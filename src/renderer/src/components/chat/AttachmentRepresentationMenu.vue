<template>
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
            : t('chat.attachments.chooseRepresentation', { name: file.name })
        "
        :aria-label="t('chat.attachments.chooseRepresentation', { name: file.name })"
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
          @select="emit('switch-vision-model')"
        />
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { DcDropdownActionItem } from '@dc-ui/components/dropdown-action-item'
import type { MessageFile } from '@shared/types/agent-interface'
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'
import {
  isImageAttachment,
  isPdfAttachment,
  normalizeAttachmentRepresentationPreferenceForFile
} from '@shared/utils/attachmentRepresentation'
import type { AttachmentOcrAvailability } from './nodes/symbols'

const props = defineProps<{
  file: MessageFile
  isAcpSession: boolean
  supportsVision: boolean | null
  ocrAvailability: AttachmentOcrAvailability
}>()

const emit = defineEmits<{
  'update:representation': [preference: AttachmentRepresentationPreference]
  'refresh-ocr-availability': []
  'switch-vision-model': []
}>()

const { t } = useI18n()
const isImage = computed(() => isImageAttachment(props.file))
const isPdf = computed(() => isPdfAttachment(props.file))
const hasRepresentationChoice = computed(
  () => !props.isAcpSession && (isImage.value || isPdf.value)
)
const requestedRepresentation = computed<AttachmentRepresentationPreference>(() =>
  normalizeAttachmentRepresentationPreferenceForFile(props.file, props.file.requestedRepresentation)
)
const hasExplicitPreference = computed(() => requestedRepresentation.value !== 'auto')
const isOcrKnownUnavailable = computed(() => props.ocrAvailability.status === 'unavailable')
const ocrUnavailableReason = computed(() =>
  props.ocrAvailability.status === 'unavailable'
    ? t(`settings.ocr.unavailableReasons.${props.ocrAvailability.reason}`)
    : undefined
)
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
  return [
    { value: 'auto', labelKey: 'chat.attachments.auto' },
    {
      value: 'image',
      labelKey: 'chat.attachments.sendImage',
      disabled: props.supportsVision === false,
      disabledReason:
        props.supportsVision === false
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
  const preference = normalizeAttachmentRepresentationPreferenceForFile(props.file, value)
  if (
    props.isAcpSession ||
    (preference === 'image' && props.supportsVision === false) ||
    (preference === 'ocr_text' && isOcrKnownUnavailable.value)
  ) {
    return
  }
  emit('update:representation', preference)
}

function handleMenuOpenChange(open: boolean) {
  if (open) emit('refresh-ocr-availability')
}
</script>

<style scoped>
@media (pointer: coarse) {
  .attachment-representation-trigger {
    opacity: 1;
  }
}
</style>
