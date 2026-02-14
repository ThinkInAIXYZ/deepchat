<template>
  <div class="my-1">
    <div class="rounded-lg border bg-card text-card-foreground p-4 w-fit">
      <div class="flex flex-col space-y-2">
        <!-- Video Player -->
        <div class="flex justify-center">
          <template v-if="resolvedVideoData">
            <video
              :src="resolvedVideoData.url"
              :poster="resolvedVideoData.cover"
              controls
              class="max-w-[400px] rounded-md"
              preload="metadata"
            >
              {{ t('chat.video.unsupported') }}
            </video>
          </template>
          <div v-else-if="videoError" class="text-sm text-red-500 p-4">
            {{ t('common.error.requestFailed') }}
          </div>
          <div v-else class="flex items-center justify-center h-40 w-full">
            <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </div>

        <!-- Video Info -->
        <div
          v-if="resolvedVideoData?.duration"
          class="flex items-center justify-between text-xs text-muted-foreground"
        >
          <span>{{ formatDuration(resolvedVideoData.duration) }}</span>
          <Button variant="ghost" size="sm" @click="downloadVideo">
            <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
            {{ t('common.download') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { AssistantMessageBlock } from '@shared/chat'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'

const { t } = useI18n()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

const videoError = ref(false)

const resolvedVideoData = computed(() => {
  if (props.block.video_data?.url) {
    return {
      url: props.block.video_data.url,
      cover: props.block.video_data.cover,
      duration: props.block.video_data.duration
    }
  }
  return null
})

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const downloadVideo = async () => {
  if (!resolvedVideoData.value?.url) return

  try {
    const link = document.createElement('a')
    link.href = resolvedVideoData.value.url
    link.download = `video-${props.messageId || Date.now()}.mp4`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (error) {
    console.error('Failed to download video:', error)
  }
}
</script>

<style scoped>
video {
  max-height: 400px;
}
</style>
