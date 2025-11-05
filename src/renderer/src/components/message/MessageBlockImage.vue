<template>
  <div class="my-1">
    <div class="rounded-lg border bg-card text-card-foreground p-4">
      <div class="flex flex-col space-y-2">
        <!-- 图片加载区域 -->
        <div class="flex justify-center">
          <template v-if="resolvedImageData">
            <img
              v-if="resolvedImageData.mimeType === 'deepchat/image-url'"
              :src="`${resolvedImageData.data}`"
              class="max-w-[400px] rounded-md cursor-pointer hover:shadow-md transition-shadow"
              @click="openFullImage"
              @error="handleImageError"
            />
            <img
              v-else
              :src="`data:${resolvedImageData.mimeType};base64,${resolvedImageData.data}`"
              class="max-w-[400px] rounded-md cursor-pointer hover:shadow-md transition-shadow"
              @click="openFullImage"
              @error="handleImageError"
            />
          </template>
          <div v-else-if="imageError" class="text-sm text-red-500 p-4">
            {{ t('common.error.requestFailed') }}
          </div>
          <div v-else class="flex items-center justify-center h-40 w-full">
            <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>

    <!-- 全屏图片查看器 -->
    <Dialog :open="showFullImage" @update:open="showFullImage = $event">
      <DialogContent class="sm:max-w-[800px] p-3 bg-background border-0 shadow-none">
        <DialogHeader>
          <DialogTitle>
            <div class="flex items-center justify-between">
              {{ t('common.image') }}
            </div>
          </DialogTitle>
        </DialogHeader>
        <div class="flex items-center justify-center">
          <template v-if="resolvedImageData">
            <img
              v-if="resolvedImageData.mimeType === 'deepchat/image-url'"
              :src="resolvedImageData.data"
              class="rounded-md max-h-[80vh] max-w-full object-contain"
            />
            <img
              v-else
              :src="`data:${resolvedImageData.mimeType};base64,${resolvedImageData.data}`"
              class="rounded-md max-h-[80vh] max-w-full object-contain"
            />
          </template>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { AssistantMessageBlock } from '@shared/chat'
import { useI18n } from 'vue-i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'

const keyMap = {
  'image.title': '生成的图片',
  'image.generatedImage': 'AI生成的图片',
  'image.loadError': '图片加载失败',
  'image.viewFull': '查看原图',
  'image.close': '关闭'
}
// 创建一个安全的翻译函数
const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    // 如果 i18n 未初始化，提供默认翻译
    return (key: string) => keyMap[key] || key
  }
})()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

type LegacyImageBlockContent = {
  data?: string
  mimeType?: string
}

const imageError = ref(false)
const showFullImage = ref(false)

const inferMimeType = (data: string, mimeType?: string): string => {
  if (mimeType && mimeType.trim().length > 0) {
    return mimeType
  }

  if (data.startsWith('imgcache://') || data.startsWith('http://') || data.startsWith('https://')) {
    return 'deepchat/image-url'
  }

  if (data.startsWith('data:image/')) {
    const match = data.match(/^data:([^;]+);base64,(.*)$/)
    if (match?.[1]) {
      return match[1]
    }
  }

  return 'image/png'
}

const resolvedImageData = computed(() => {
  if (props.block.image_data?.data) {
    return props.block.image_data
  }

  const content = props.block.content

  if (content && typeof content === 'object' && 'data' in (content as LegacyImageBlockContent)) {
    const legacyContent = content as LegacyImageBlockContent
    if (legacyContent.data) {
      return {
        data: legacyContent.data,
        mimeType: inferMimeType(legacyContent.data, legacyContent.mimeType)
      }
    }
  }

  if (typeof content === 'string' && content.length > 0) {
    if (content.startsWith('data:image/')) {
      const match = content.match(/^data:([^;]+);base64,(.*)$/)
      if (match?.[1] && match?.[2]) {
        return {
          data: match[2],
          mimeType: match[1]
        }
      }
    }

    if (
      content.startsWith('imgcache://') ||
      content.startsWith('http://') ||
      content.startsWith('https://')
    ) {
      return {
        data: content,
        mimeType: 'deepchat/image-url'
      }
    }

    return {
      data: content,
      mimeType: inferMimeType(content)
    }
  }

  return null
})

const handleImageError = () => {
  imageError.value = true
}

const openFullImage = () => {
  if (resolvedImageData.value) {
    showFullImage.value = true
  }
}
</script>

<style scoped>
.image-container {
  transition: all 0.3s ease;
}
</style>
