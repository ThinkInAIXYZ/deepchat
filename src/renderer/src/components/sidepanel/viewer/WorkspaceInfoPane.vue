<template>
  <div
    class="h-full min-h-0 w-full overflow-auto px-4 py-4 text-sm"
    data-testid="workspace-info-pane"
  >
    <div v-if="description" class="mb-3 text-foreground">{{ description }}</div>
    <div class="space-y-2 text-muted-foreground">
      <div>{{ props.filePreview.mimeType }}</div>
      <div>
        {{
          t('common.size.bytes', {
            count: Math.max(0, Number(props.filePreview.metadata.fileSize) || 0)
          })
        }}
      </div>
      <div>{{ formatDate(props.filePreview.metadata.fileModified) }}</div>
      <div v-if="createdAt !== modifiedAt">{{ createdAt }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorkspaceFilePreview } from '@shared/presenter'

const props = defineProps<{
  filePreview: WorkspaceFilePreview
}>()

const { t } = useI18n()

const formatDate = (value: Date | string | number): string => {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString()
}

const description = computed(() => props.filePreview.metadata.fileDescription?.trim() || '')
const createdAt = computed(() => formatDate(props.filePreview.metadata.fileCreated))
const modifiedAt = computed(() => formatDate(props.filePreview.metadata.fileModified))
</script>
