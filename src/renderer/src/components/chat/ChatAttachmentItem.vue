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
      @mousedown.stop
      @click.stop="isOcrPreviewOpen = true"
    >
      <Badge variant="secondary" class="h-4 px-1.5 text-[9px] font-medium">
        {{ t('chat.attachments.ocrBadge') }}
      </Badge>
    </button>
    <Badge
      v-else-if="resolvedRepresentation?.kind === 'image'"
      variant="secondary"
      class="h-4 px-1.5 text-[9px] font-medium"
    >
      {{ t('chat.attachments.imageBadge') }}
    </Badge>
    <Badge
      v-else-if="resolvedRepresentation?.kind === 'unavailable'"
      variant="outline"
      class="h-4 border-amber-500/40 px-1.5 text-[9px] font-medium text-amber-700 dark:text-amber-300"
      :title="t(`chat.attachments.reasons.${resolvedRepresentation.reason}`)"
    >
      {{ t('chat.attachments.unavailableBadge') }}
    </Badge>
    <button
      v-if="removable"
      type="button"
      class="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click.stop.prevent="$emit('remove')"
    >
      <Icon icon="lucide:x" class="h-3.5 w-3.5" />
    </button>
  </span>

  <Dialog v-model:open="isOcrPreviewOpen">
    <DialogContent class="flex max-h-[80vh] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('chat.attachments.ocrPreviewTitle', { name: file.name }) }}</DialogTitle>
        <DialogDescription v-if="ocrRepresentation">
          {{
            t('chat.attachments.ocrPreviewDescription', {
              tokens: ocrRepresentation.tokenCount
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <div
        v-if="ocrRepresentation?.truncated"
        class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
      >
        {{ t('chat.attachments.ocrTextTruncated') }}
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
import { Badge } from '@shadcn/components/ui/badge'
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

const mimeType = computed(() => props.file.mimeType || 'application/octet-stream')
const thumbnail = computed(() => props.file.thumbnail || '')
const fileIcon = computed(() => getMimeTypeIcon(mimeType.value))
const resolvedRepresentation = computed(() => getAttachmentResolvedRepresentation(props.file))
const ocrRepresentation = computed(() => {
  const representation = resolvedRepresentation.value
  return representation?.kind === 'ocr_text' ? representation : null
})
const isOcrPreviewOpen = ref(false)
const { t } = useI18n()
</script>
