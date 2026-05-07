<template>
  <div class="my-1">
    <div class="rounded-lg border bg-card text-card-foreground p-4 w-fit">
      <div class="flex flex-col space-y-2">
        <!-- 图片加载区域 -->
        <div class="flex justify-center">
          <template v-if="resolvedImageData">
            <ImageActionContextMenu :source="resolvedImageSrc" :mime-type="resolvedImageMimeType">
              <img
                :src="resolvedImageSrc"
                class="max-w-[400px] rounded-md cursor-pointer hover:shadow-md transition-shadow"
                @click="openFullImage"
                @error="handleImageError"
              />
            </ImageActionContextMenu>
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
      <DialogContent
        class="sm:max-w-[800px] p-3 bg-background border-0 shadow-none focus:outline-none"
        @open-auto-focus="handleImageDialogOpenAutoFocus"
      >
        <DialogHeader>
          <DialogTitle>
            <div class="flex items-center justify-between gap-2 pr-8">
              <span>{{ t('common.image') }}</span>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                    @click="handleSaveImage"
                  >
                    <Icon icon="lucide:download" class="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ t('image.save') }}</TooltipContent>
              </Tooltip>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div class="flex items-center justify-center">
          <template v-if="resolvedImageData">
            <ImageActionContextMenu :source="resolvedImageSrc" :mime-type="resolvedImageMimeType">
              <img
                :src="resolvedImageSrc"
                class="rounded-md max-h-[80vh] max-w-full object-contain"
              />
            </ImageActionContextMenu>
          </template>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'
import ImageActionContextMenu from './ImageActionContextMenu.vue'
import { useImageActions } from '@/composables/useImageActions'

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
  block: DisplayAssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

type LegacyImageBlockContent = {
  data?: string
  mimeType?: string
}

const imageError = ref(false)
const showFullImage = ref(false)
const { saveImage } = useImageActions()

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
  // Handle new format with image_data field
  if (props.block.image_data?.data) {
    const rawData = props.block.image_data.data

    // Handle URLs
    if (
      rawData.startsWith('imgcache://') ||
      rawData.startsWith('http://') ||
      rawData.startsWith('https://')
    ) {
      return {
        data: rawData,
        mimeType: 'deepchat/image-url'
      }
    }

    let normalizedData = rawData
    let normalizedMimeType = inferMimeType(rawData, props.block.image_data.mimeType)

    // Handle legacy data URIs that may still exist in persisted data
    if (rawData.startsWith('data:image/')) {
      const match = rawData.match(/^data:([^;]+);base64,(.*)$/)
      if (match?.[1] && match?.[2]) {
        normalizedMimeType = match[1]
        normalizedData = match[2]
      }
    }

    return {
      data: normalizedData,
      mimeType: normalizedMimeType
    }
  }

  // Handle legacy formats (for backward compatibility)
  const content = props.block.content

  if (content && typeof content === 'object' && 'data' in (content as LegacyImageBlockContent)) {
    const legacyContent = content as LegacyImageBlockContent
    if (legacyContent.data) {
      const rawData = legacyContent.data

      // Handle URLs
      if (
        rawData.startsWith('imgcache://') ||
        rawData.startsWith('http://') ||
        rawData.startsWith('https://')
      ) {
        return {
          data: rawData,
          mimeType: 'deepchat/image-url'
        }
      }

      let normalizedData = rawData
      let normalizedMimeType = inferMimeType(rawData, legacyContent.mimeType)

      // Handle data URIs
      if (rawData.startsWith('data:image/')) {
        const match = rawData.match(/^data:([^;]+);base64,(.*)$/)
        if (match?.[1] && match?.[2]) {
          normalizedMimeType = match[1]
          normalizedData = match[2]
        }
      }

      return {
        data: normalizedData,
        mimeType: normalizedMimeType
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

const resolvedImageSrc = computed(() => {
  const image = resolvedImageData.value
  if (!image) {
    return ''
  }

  return image.mimeType === 'deepchat/image-url'
    ? image.data
    : `data:${image.mimeType};base64,${image.data}`
})

const resolvedImageMimeType = computed(() => {
  const mimeType = resolvedImageData.value?.mimeType
  return mimeType === 'deepchat/image-url' ? undefined : mimeType
})

const handleImageError = () => {
  imageError.value = true
}

const openFullImage = () => {
  if (resolvedImageData.value) {
    showFullImage.value = true
  }
}

const handleImageDialogOpenAutoFocus = (event: Event) => {
  event.preventDefault()
  const target = event.target as HTMLElement | null
  target?.focus()
}

const handleSaveImage = () => {
  if (!resolvedImageSrc.value) {
    return
  }

  void saveImage({
    source: resolvedImageSrc.value,
    mimeType: resolvedImageMimeType.value
  })
}
</script>

<style scoped>
.image-container {
  transition: all 0.3s ease;
}
</style>
