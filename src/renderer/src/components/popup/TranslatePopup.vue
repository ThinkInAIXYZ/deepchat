<!-- eslint-disable vue/no-v-html -->
<template>
  <div>
    <div
      v-if="isOpen"
      ref="popupRef"
      class="fixed z-50 w-[500px] bg-background border rounded-lg shadow-lg"
      :style="{ top: position.y + 'px', left: position.x + 'px' }"
    >
      <div
        class="flex items-center justify-between p-4 border-b cursor-move"
        @mousedown="startDrag"
      >
        <h3 class="text-lg font-semibold">{{ t('contextMenu.translate.title') }}</h3>
        <Button variant="ghost" size="icon" @click="close">
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>
      <div class="p-4">
        <div class="mb-4">
          <div class="p-2 bg-muted text-muted-foreground">{{ text }}</div>
        </div>
        <div class="h-px bg-border my-2"></div>
        <div>
          <div
            v-if="isTranslating"
            class="flex items-center gap-2 p-2 bg-muted text-sm text-muted-foreground"
          >
            <Icon icon="lucide:loader-2" class="animate-spin w-4 h-4" />
            <span>{{ t('common.loading') }}</span>
          </div>
          <div v-else class="p-2 bg-muted text-sm">{{ translatedText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import type { IThreadPresenter } from '../../../../shared/presenter'

const { t } = useI18n()
const threadPresenter = usePresenter('threadPresenter')

// 状态
const isOpen = ref(false)
const text = ref('')
const translatedText = ref('')
const isTranslating = ref(false)
const popupRef = ref<HTMLElement | null>(null)

// 窗口位置状态
const position = ref({ x: 100, y: 100 })

// 拖动相关状态
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

const POPUP_WIDTH = 500
const POPUP_HEIGHT = 220
const VISIBLE_EDGE = 40 // 保证至少40px可见

// 开始拖动
const startDrag = (event: MouseEvent) => {
  isDragging.value = true
  dragStart.value = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y
  }
}

// 处理拖动
const getMaxX = () => window.innerWidth - VISIBLE_EDGE
const getMinX = () => -(POPUP_WIDTH - VISIBLE_EDGE)
const getMaxY = () => window.innerHeight - VISIBLE_EDGE
const getMinY = (ref: HTMLElement | null) => -((ref?.offsetHeight || POPUP_HEIGHT) - VISIBLE_EDGE)

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value) return

  let newX = event.clientX - dragStart.value.x
  let newY = event.clientY - dragStart.value.y

  newX = Math.max(getMinX(), Math.min(newX, getMaxX()))
  newY = Math.max(getMinY(popupRef.value), Math.min(newY, getMaxY()))
  position.value = { x: newX, y: newY }
}

// 结束拖动
const stopDrag = () => {
  isDragging.value = false
}

// 关闭弹窗
const close = () => {
  isOpen.value = false
  text.value = ''
  translatedText.value = ''
  isTranslating.value = false
}

// 处理翻译请求
const handleTranslateRequest = async (event: Event) => {
  const customEvent = event as CustomEvent<{ text: string; x?: number; y?: number }>
  const { text: newText, x, y } = customEvent.detail

  text.value = newText
  if (typeof x === 'number' && typeof y === 'number') {
    const posX = x
    const posY = y
    position.value = {
      x: Math.max(0, posX),
      y: Math.max(0, posY)
    }
    if (posX + POPUP_WIDTH > getMaxX()) {
      position.value.x = getMaxX() - POPUP_WIDTH
    }
  }

  isOpen.value = true
  isTranslating.value = true
  translatedText.value = ''

  try {
    const result = await (threadPresenter as IThreadPresenter).translateText(
      newText,
      window.api.getWebContentsId()
    )
    translatedText.value = result
  } catch (error) {
    translatedText.value = t('contextMenu.translate.error')
  } finally {
    isTranslating.value = false
  }
}

onMounted(() => {
  window.addEventListener('context-menu-translate-text', handleTranslateRequest)
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
  window.removeEventListener('context-menu-translate-text', handleTranslateRequest)
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped>
.cursor-move {
  cursor: move;
}
</style>
