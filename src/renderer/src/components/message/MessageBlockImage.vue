<template>
  <div class="my-1">
    <div class="rounded-lg border bg-card text-card-foreground p-4">
      <div class="flex flex-col space-y-2">
        <!-- 图片加载区域 -->
        <div class="flex justify-center">
          <template v-if="block.image_data">
            <img
              v-if="block.image_data.mimeType === 'deepchat/image-url'"
              :src="`${block.image_data.data}`"
              class="max-w-[400px] rounded-md cursor-pointer hover:shadow-md transition-shadow"
              @click="openFullImage"
              @error="handleImageError"
            />
            <img
              v-else
              :src="`data:${block.image_data.mimeType};base64,${block.image_data.data}`"
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
          <template v-if="block.image_data">
            <img
              v-if="block.image_data.mimeType === 'deepchat/image-url'"
              :src="block.image_data.data"
              class="rounded-md max-h-[80vh] max-w-full object-contain"
            />
            <img
              v-else
              :src="`data:${block.image_data.mimeType};base64,${block.image_data.data}`"
              class="rounded-md max-h-[80vh] max-w-full object-contain"
            />
          </template>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { AssistantMessageBlock } from '@shared/chat'
import { useI18n } from 'vue-i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'

// 创建一个安全的翻译函数
const t = (() => {
  try {
    const { t } = useI18n()
    return t
  } catch (e) {
    // 如果 i18n 未初始化，提供默认翻译
    return (key: string) => {
      if (key === 'image.title') return '生成的图片'
      if (key === 'image.generatedImage') return 'AI生成的图片'
      if (key === 'image.loadError') return '图片加载失败'
      if (key === 'image.viewFull') return '查看原图'
      if (key === 'image.close') return '关闭'
      return key
    }
  }
})()

const props = defineProps<{
  block: AssistantMessageBlock
  messageId?: string
  threadId?: string
}>()

const imageError = ref(false)
const showFullImage = ref(false)

const handleImageError = () => {
  imageError.value = true
}

const openFullImage = () => {
  if (props.block.image_data) {
    showFullImage.value = true
  }
}
</script>

<style scoped>
.image-container {
  transition: all 0.3s ease;
}
</style>
