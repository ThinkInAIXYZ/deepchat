<template>
  <div
    class="flex px-3 py-2 gap-2 flex-row bg-card border items-center justify-start rounded-md text-base select-none hover:bg-accent"
  >
    <Icon
      :icon="getFileIcon()"
      class="w-10 h-10 text-muted-foreground p-1 bg-accent rounded-md border"
    />
    <div class="grow flex-1 w-[calc(100%-170px)]">
      <div
        :title="file.name"
        class="text-sm leading-none pb-2 truncate text-ellipsis whitespace-nowrap"
      >
        {{ file.name }}
      </div>
      <div
        class="text-xs leading-none text-muted-foreground truncate text-ellipsis whitespace-nowrap"
      >
        <span class="mr-1">
          {{ uploadTime }}
        </span>
        {{ formatFileSize(file.metadata.size) }}
      </div>
    </div>
    <div class="ml-auto flex align-center">
      <div
        class="h-7 w-7 flex items-center justify-center rounded-full transition-colors"
        :title="file.metadata.errorReason || getStatusTitle(file.status)"
      >
        <Icon
          v-if="file.status === 'completed'"
          icon="lucide:circle-check-big"
          class="text-base text-green-500"
        />
        <div
          v-else-if="file.status === 'processing'"
          class="relative group w-6 h-6 flex items-center justify-center"
        >
          <Spinner class="size-4 text-blue-500" />
          <!-- Tooltip -->
          <div
            class="absolute bottom-full mb-1 w-max px-2 py-0.5 rounded-md bg-card text-muted-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-md pointer-events-none whitespace-nowrap"
          >
            {{ Math.floor(progressPercent) }}% {{ fileProgress.completed + fileProgress.error }}/{{
              fileProgress.total
            }}
            }}
          </div>
        </div>

        <Icon
          v-else-if="file.status === 'error'"
          icon="lucide:circle-alert"
          class="text-base text-red-400"
        />
        <Icon
          v-else-if="file.status === 'paused'"
          icon="lucide:circle-pause"
          class="text-base text-yellow-500"
        />
      </div>
      <DcButton
        variant="ghost"
        size="icon"
        :disabled="disabled"
        class="h-7 w-7 flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors"
        :tooltip="t(`settings.knowledgeBase.reAdd`)"
        v-if="file.status !== 'processing'"
        @click="reAddDialogOpen = true"
      >
        <Icon icon="lucide:refresh-ccw" class="text-base text-gray-500" />
      </DcButton>
      <DcConfirmDialog
        :open="reAddDialogOpen"
        :title="t('settings.knowledgeBase.reAddFile.title')"
        :description="t('settings.knowledgeBase.reAddFile.content', { fileName: file.name })"
        :danger="false"
        confirm-label="t('common.confirm')"
        cancel-label="t('common.cancel')"
        @update:open="reAddDialogOpen = $event"
        @confirm="reAddFile"
        @cancel="reAddDialogOpen = false"
      />

      <DcButton
        variant="ghost"
        size="icon"
        :disabled="disabled"
        class="h-7 w-7 flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors"
        :tooltip="t(`settings.knowledgeBase.delete`)"
        @click="deleteDialogOpen = true"
      >
        <Icon icon="lucide:trash" class="text-base text-red-400" />
      </DcButton>
      <DcConfirmDialog
        :open="deleteDialogOpen"
        :title="t('settings.knowledgeBase.deleteFile.title')"
        :description="t('settings.knowledgeBase.deleteFile.content', { fileName: file.name })"
        :danger="true"
        confirm-label="t('common.confirm')"
        cancel-label="t('common.cancel')"
        @update:open="deleteDialogOpen = $event"
        @confirm="deleteFile"
        @cancel="deleteDialogOpen = false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { getMimeTypeIcon } from '@/lib/utils'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { computed, ref } from 'vue'
import type { KnowledgeFileMessage } from '@shared/types/knowledge'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import dayjs from 'dayjs'

dayjs.extend(utc)
dayjs.extend(timezone)

const { t } = useI18n()
const props = defineProps<{
  file: KnowledgeFileMessage
  progress?: {
    completed: number
    error: number
    total: number
  }
  disabled?: boolean
}>()
const emit = defineEmits<{
  delete: []
  reAdd: []
}>()

// 获取用户时区
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
// 格式化上传时间
const uploadTime = computed(() => {
  return dayjs(props.file.uploadedAt).tz(userTimeZone).format('YYYY-MM-DD HH:mm:ss')
})
// 删除文件
const deleteDialogOpen = ref(false)
const deleteFile = () => {
  deleteDialogOpen.value = false
  emit('delete')
}

// 重新上传
const reAddDialogOpen = ref(false)
const reAddFile = () => {
  reAddDialogOpen.value = false
  emit('reAdd')
}

// 文件大小的单位转换
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

const getFileIcon = () => {
  return getMimeTypeIcon(props.file.mimeType)
}

// 根据状态获取提示文字
const getStatusTitle = (status: string): string => {
  switch (status) {
    case 'completed':
      return t(`settings.knowledgeBase.uploadCompleted`)
    case 'processing':
      return t(`settings.knowledgeBase.processing`)
    case 'error':
      return t(`settings.knowledgeBase.uploadError`)
    case 'paused':
      return t(`settings.knowledgeBase.paused`)
    default:
      return t(`settings.knowledgeBase.unknown`)
  }
}

const fileProgress = computed(
  () => props.progress ?? { completed: 0, error: 0, total: props.file.metadata.totalChunks }
)
const progressPercent = computed(() => {
  if (!fileProgress.value.total) return 0
  return (
    ((fileProgress.value.completed + fileProgress.value.error) / fileProgress.value.total) * 100
  )
})
</script>
