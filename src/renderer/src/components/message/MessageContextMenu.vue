<!-- eslint-disable vue/no-v-html -->
<template>
  <div>
    <div
      v-if="isTranslateDialogOpen"
      ref="translateRef"
      class="fixed z-50 w-[500px] bg-background border rounded-lg shadow-lg"
      :style="{ top: translatePosition.y + 'px', left: translatePosition.x + 'px' }"
    >
      <div class="flex items-center justify-between p-4 border-b cursor-move" @mousedown="startDrag('translate')">
        <h3 class="text-lg font-semibold">{{ t('contextMenu.translate.title') }}</h3>
        <Button variant="ghost" size="icon" @click="isTranslateDialogOpen = false">
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>
      <div class="p-4">
        <div class="mb-4">
          <div class="p-2 bg-muted text-muted-foreground">{{ selectedText }}</div>
        </div>
        <div class="h-px bg-border my-2"></div>
        <div>
          <div class="p-2 bg-muted text-sm">{{ translatedText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'

const { t } = useI18n()

const threadPresenter = usePresenter('threadPresenter')

const isTranslateDialogOpen = ref(false)
const selectedText = ref('')
const translatedText = ref('')

// 窗口位置状态
const translatePosition = ref({ x: 100, y: 100 })

// 拖动相关状态
const isDragging = ref(false)
const currentDragType = ref<'translate' | null>(null)
const dragStart = ref({ x: 0, y: 0 })
const translateRef = ref<HTMLElement | null>(null)

const VISIBLE_EDGE = 40 // 保证至少40px可见

// 开始拖动
const startDrag = (type: 'translate') => {
  isDragging.value = true
  currentDragType.value = type
  const event = window.event as MouseEvent
  dragStart.value = {
    x: event.clientX - translatePosition.value.x,
    y: event.clientY - translatePosition.value.y
  }
}

// 处理拖动
const getMaxX = () => window.innerWidth - VISIBLE_EDGE
const getMinX = () => -(500 - VISIBLE_EDGE)
const getMaxY = (ref: HTMLElement | null) => window.innerHeight - VISIBLE_EDGE
const getMinY = (ref: HTMLElement | null) => -((ref?.offsetHeight || 300) - VISIBLE_EDGE)

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value || !currentDragType.value) return

  let newX = event.clientX - dragStart.value.x
  let newY = event.clientY - dragStart.value.y

  if (currentDragType.value === 'translate') {
    newX = Math.max(getMinX(), Math.min(newX, getMaxX()))
    newY = Math.max(getMinY(translateRef.value), Math.min(newY, getMaxY(translateRef.value)))
    translatePosition.value = { x: newX, y: newY }
  }
}

// 结束拖动
const stopDrag = () => {
  isDragging.value = false
  currentDragType.value = null
}

// 处理翻译事件
const handleTranslate = async (text: string) => {
  selectedText.value = text
  isTranslateDialogOpen.value = true
  try {
    const result = await threadPresenter.translateText(text)
    translatedText.value = result
  } catch (error) {
    console.error('Translation failed:', error)
    translatedText.value = t('contextMenu.translate.error')
  }
}

// 处理AI询问事件
const handleAskAI = (text: string) => {
  window.dispatchEvent(new CustomEvent('context-menu-ask-ai', { detail: text }))
}

// 监听主进程发送的事件
onMounted(() => {
  window.electron.ipcRenderer.on('context-menu-translate', (_, text: string) => {
    handleTranslate(text)
  })
  window.electron.ipcRenderer.on('context-menu-ask-ai', (_, text: string) => {
    handleAskAI(text)
  })

  // 添加全局鼠标事件监听
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', stopDrag)
})

// 清理事件监听器
onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners('context-menu-translate')
  window.electron.ipcRenderer.removeAllListeners('context-menu-ask-ai')
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped>
.cursor-move {
  cursor: move;
}
</style> 