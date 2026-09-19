<template>
  <span
    class="group inline-flex max-w-full items-center gap-2 rounded-full border bg-background/70 px-2.5 py-1 text-xs text-foreground shadow-sm transition-colors hover:bg-accent"
    :class="compact ? 'align-middle' : ''"
    data-testid="chat-attachment-item"
    @click="$emit('click')"
  >
    <img
      v-if="thumbnail"
      :src="thumbnail"
      class="h-5 w-5 shrink-0 rounded-full border object-cover"
      alt="attachment"
    />
    <Icon
      v-else
      :icon="fileIcon"
      class="h-4 w-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <span :class="compact ? 'max-w-[120px]' : 'max-w-[180px]'" class="truncate">
      {{ file.name }}
    </span>
    <button
      v-if="resolvedRepresentation?.kind === 'ocr_text'"
      type="button"
      data-testid="attachment-ocr-preview-trigger"
      :title="t('chat.attachments.inspectOcrText')"
      :aria-label="t('chat.attachments.inspectOcrText')"
      @mousedown.stop
      @click.stop="isOcrPreviewOpen = true"
    >
      <DcBadge
        variant="secondary"
        data-testid="attachment-representation-status"
        class="h-4 px-1.5 text-[9px] font-medium"
        :class="
          ocrStatus === 'complete' ? '' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        "
      >
        {{ ocrStatusLabel }}
      </DcBadge>
    </button>
    <DcBadge
      v-else-if="resolvedRepresentation?.kind === 'embedded_text'"
      variant="secondary"
      data-testid="attachment-representation-status"
      class="h-4 px-1.5 text-[9px] font-medium"
    >
      {{ t('chat.attachments.embeddedTextBadge') }}
    </DcBadge>
    <DcBadge
      v-else-if="resolvedRepresentation?.kind === 'image'"
      variant="secondary"
      data-testid="attachment-representation-status"
      class="h-4 px-1.5 text-[9px] font-medium"
    >
      {{ t('chat.attachments.imageBadge') }}
    </DcBadge>
    <DcBadge
      v-else-if="resolvedRepresentation?.kind === 'unavailable'"
      variant="warning"
      data-testid="attachment-representation-status"
      class="h-4 px-1.5 text-[9px] font-medium"
      :title="t(`chat.attachments.reasons.${resolvedRepresentation.reason}`)"
    >
      {{ t('chat.attachments.unavailableBadge') }}
    </DcBadge>
    <DcButton
      v-if="removable"
      type="button"
      size="icon-xs"
      icon="lucide:x"
      icon-size="3.5"
      :label="t('chat.pendingInput.remove')"
      :tooltip="t('chat.pendingInput.remove')"
      class="size-[18px] rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click.stop.prevent="$emit('remove')"
    />
  </span>

  <Dialog v-model:open="isOcrPreviewOpen">
    <DialogContent class="flex max-h-[80vh] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('chat.attachments.ocrPreviewTitle', { name: file.name }) }}</DialogTitle>
        <DialogDescription v-if="ocrRepresentation">
          <span class="block">
            {{
              t('chat.attachments.ocrPreviewDescription', {
                tokens: ocrRepresentation.tokenCount
              })
            }}
          </span>
          <span v-if="ocrPageCoverage" class="block">{{ ocrPageCoverage }}</span>
        </DialogDescription>
      </DialogHeader>
      <div
        v-if="ocrNotice"
        class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
      >
        {{ ocrNotice }}
      </div>
      <pre
        data-testid="attachment-ocr-preview-text"
        class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs text-foreground"
        >{{ ocrRepresentation?.text ?? '' }}</pre
      >
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import type { MessageFile } from '@shared/types/agent-interface'
import { Icon } from '@iconify/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getMimeTypeIcon } from '@/lib/utils'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { getAttachmentResolvedRepresentation } from '@shared/utils/attachmentRepresentation'

const props = withDefaults(
  defineProps<{
    file: MessageFile
    removable?: boolean
    compact?: boolean
  }>(),
  {
    removable: false,
    compact: false
  }
)

defineEmits<{
  click: []
  remove: []
}>()

const { t } = useI18n()
const mimeType = computed(() => props.file.mimeType || 'application/octet-stream')
const thumbnail = computed(() => props.file.thumbnail || '')
const fileIcon = computed(() => getMimeTypeIcon(mimeType.value))
const resolvedRepresentation = computed(() => getAttachmentResolvedRepresentation(props.file))
const ocrRepresentation = computed(() => {
  const representation = resolvedRepresentation.value
  return representation?.kind === 'ocr_text' ? representation : null
})
const ocrStatus = computed<'complete' | 'partial' | 'limited'>(() => {
  const representation = ocrRepresentation.value
  if (representation?.document?.artifactTermination === 'resource_limited') return 'limited'
  return representation?.truncated ? 'partial' : 'complete'
})
const ocrStatusLabel = computed(() => {
  if (ocrStatus.value === 'limited') return t('chat.attachments.ocrLimitedBadge')
  if (ocrStatus.value === 'partial') return t('chat.attachments.ocrPartialBadge')
  return t('chat.attachments.ocrBadge')
})
const ocrPageCoverage = computed(() => {
  const document = ocrRepresentation.value?.document
  if (!document) return ''
  return t(
    document.includedThroughPageComplete
      ? 'chat.attachments.ocrPageCoverage'
      : 'chat.attachments.ocrPageCoveragePartial',
    { page: document.includedThroughPage }
  )
})
const ocrNotice = computed(() => {
  const representation = ocrRepresentation.value
  if (!representation) return ''
  if (representation.document?.artifactTermination === 'resource_limited') {
    return t('chat.attachments.reasons.ocr_resource_limited')
  }
  return representation.truncated ? t('chat.attachments.ocrTextTruncated') : ''
})
const isOcrPreviewOpen = ref(false)
</script>
