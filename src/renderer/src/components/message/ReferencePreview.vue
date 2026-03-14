<template>
  <div
    v-if="show"
    ref="previewEl"
    class="reference-preview fixed z-50 max-w-[384px] bg-card rounded-lg shadow-lg p-3 sm:p-4"
    :style="positionStyle"
  >
    <!-- 内容区域 -->
    <div class="space-y-1.5 sm:space-y-2">
      <!-- 标题区域 -->
      <div class="flex items-center gap-1.5 sm:gap-2">
        <img
          v-if="content?.icon"
          :src="content.icon"
          class="w-3 h-3 sm:w-4 sm:h-4 rounded"
          :alt="content?.title"
        />
        <Icon v-else icon="lucide:globe" class="w-3 h-3 sm:w-4 sm:h-4" />
        <h3 class="font-medium text-xs sm:text-sm line-clamp-1">{{ content?.title }}</h3>
      </div>

      <!-- 内容预览 -->
      <p class="text-xs sm:text-sm text-muted-foreground line-clamp-2">
        {{ content?.description || content?.content }}
      </p>

      <!-- 链接信息 -->
      <div class="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
        <Icon icon="lucide:link" class="w-2.5 h-2.5 sm:w-3 sm:h-3" />
        <span class="truncate">{{ content?.url }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import type { SearchResult } from '@shared/types/core/search'

const props = defineProps<{
  show: boolean
  content: SearchResult | undefined
  rect?: DOMRect
}>()

const previewEl = ref<HTMLElement>()

const positionStyle = computed(() => {
  if (!props.rect) return {}

  // 获取视窗大小
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // 预览框的预计尺寸
  const previewWidth = 384 // w-96 = 24rem = 384px
  const previewHeight = previewEl.value?.offsetHeight || 200 // 假设最小高度

  // 计算基础位置
  let top = props.rect.bottom + window.scrollY + 8
  let left = props.rect.left + window.scrollX

  // 确保不会超出右边界
  if (left + previewWidth > viewportWidth) {
    left = viewportWidth - previewWidth - 16 // 16px 作为安全边距
  }

  // 如果底部空间不足，就显示在上方
  if (top + previewHeight > viewportHeight + window.scrollY) {
    top = props.rect.top + window.scrollY - previewHeight - 8
  }

  return {
    top: `${top}px`,
    left: `${left}px`
  }
})
</script>
