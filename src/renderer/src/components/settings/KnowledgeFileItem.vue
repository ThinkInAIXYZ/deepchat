<template>
  <div
    class="flex px-3 py-2 gap-2 flex-row bg-card border items-center justify-start rounded-md text-base select-none hover:bg-accent"
  >
    <Icon
      :icon="getFileIcon()"
      class="w-10 h-10 text-muted-foreground p-1 bg-accent rounded-md border"
    />
    <div class="flex-grow flex-1 w-[calc(100%-170px)]">
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
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors"
        :title="t(`settings.knowledgeBase.reAdd`)"
        v-if="file.status !== 'processing'"
        @click="reAddFile"
      >
        <Icon icon="lucide:refresh-ccw" class="text-base" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors"
        :title="file.metadata.errorReason"
      >
        <Icon
          v-if="file.status === 'completed'"
          icon="lucide:circle-check-big"
          class="text-base text-green-500"
        />
        <Icon
          v-else-if="file.status === 'processing'"
          icon="lucide:loader"
          class="text-base text-blue-500 animate-spin"
        />
        <Icon
          v-else-if="file.status === 'error'"
          icon="lucide:circle-alert"
          class="text-base text-red-500"
        />
        <Icon
          v-else-if="file.status === 'paused'"
          icon="lucide:circle-pause"
          class="text-base text-yellow-500"
        />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors"
        :title="t(`settings.knowledgeBase.delete`)"
        @click="deleteFile"
      >
        <Icon icon="lucide:trash" class="text-base text-red-600" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getMimeTypeIcon } from '@/lib/utils'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { computed } from 'vue'
import { KnowledgeFileMessage } from '@shared/presenter'
import { Button } from '@/components/ui/button'
import dayjs from 'dayjs'

dayjs.extend(utc)
dayjs.extend(timezone)

const { t } = useI18n()
const props = defineProps<{
  file: KnowledgeFileMessage
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
const deleteFile = () => {
  emit('delete')
}

// 重新上传
const reAddFile = () => {
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
</script>
