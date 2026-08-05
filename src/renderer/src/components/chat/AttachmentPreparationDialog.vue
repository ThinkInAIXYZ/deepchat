<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-lg" data-testid="attachment-preparation-dialog">
      <DialogHeader>
        <DialogTitle>{{ t('chat.attachments.actionRequiredTitle') }}</DialogTitle>
        <DialogDescription>
          {{ t('chat.attachments.actionRequiredDescription') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="visibleIssues.length > 0" class="space-y-2">
        <div
          v-for="issue in visibleIssues"
          :key="`${issue.attachmentIndex}-${issue.reason}`"
          class="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm"
        >
          <Icon icon="lucide:file-warning" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <div class="font-medium">
              {{ t('chat.attachments.attachmentNumber', { number: issue.attachmentIndex + 1 }) }}
            </div>
            <div class="text-xs text-muted-foreground">
              {{ t(`chat.attachments.reasons.${issue.reason}`) }}
            </div>
          </div>
        </div>
        <div v-if="hiddenIssueCount > 0" class="text-xs text-muted-foreground">
          {{ t('chat.attachments.moreIssues', { count: hiddenIssueCount }) }}
        </div>
      </div>

      <div v-else class="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
        {{ t('chat.attachments.genericUnavailable') }}
      </div>

      <DialogFooter class="flex-wrap sm:justify-between">
        <DcButton
          variant="ghost"
          :disabled="processing && !cancelWhileProcessing"
          @click="emit('cancel')"
        >
          {{ t('chat.attachments.keepDraft') }}
        </DcButton>
        <div class="flex flex-wrap justify-end gap-2">
          <DcButton
            v-if="hasAction('switch_to_vision_model')"
            variant="outline"
            :disabled="processing"
            @click="emit('switch-model')"
          >
            {{ t('chat.attachments.switchVisionModel') }}
          </DcButton>
          <DcButton
            v-if="hasAction('retry')"
            variant="outline"
            :disabled="processing"
            @click="emit('retry')"
          >
            {{ t('chat.attachments.retry') }}
          </DcButton>
          <DcButton
            v-if="hasAction('send_without_image_content')"
            :disabled="processing"
            @click="emit('send-without-image-content')"
          >
            <Spinner v-if="processing" class="mr-2 size-4" />
            {{ t('chat.attachments.sendWithoutImageContent') }}
          </DcButton>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Spinner } from '@shadcn/components/ui/spinner'
import type {
  AttachmentPreparationAction,
  AttachmentPreparationSummary
} from '@shared/types/attachment'

const MAX_VISIBLE_ISSUES = 5

const props = withDefaults(
  defineProps<{
    open: boolean
    summary: AttachmentPreparationSummary | null
    processing?: boolean
    cancelWhileProcessing?: boolean
  }>(),
  {
    processing: false,
    cancelWhileProcessing: false
  }
)

const emit = defineEmits<{
  cancel: []
  retry: []
  'send-without-image-content': []
  'switch-model': []
}>()

const { t } = useI18n()
const visibleIssues = computed(() => props.summary?.issues.slice(0, MAX_VISIBLE_ISSUES) ?? [])
const hiddenIssueCount = computed(() =>
  Math.max(0, (props.summary?.issues.length ?? 0) - visibleIssues.value.length)
)

function hasAction(action: AttachmentPreparationAction): boolean {
  return props.summary?.suggestedActions.includes(action) ?? false
}

function handleOpenChange(open: boolean): void {
  if (!open && (!props.processing || props.cancelWhileProcessing)) {
    emit('cancel')
  }
}
</script>
