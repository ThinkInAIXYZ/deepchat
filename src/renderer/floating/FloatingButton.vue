<template>
  <div
    class="w-screen h-screen bg-transparent overflow-hidden select-none flex items-center justify-center"
  >
    <div
      ref="floatingButton"
      class="w-15 h-15 rounded-full border-2 border-white/30 flex items-center justify-center cursor-pointer transition-all duration-300 relative overflow-hidden select-none floating-button"
      :class="{
        'floating-button-pulse': isPulsing,
        dragging: isDragging
      }"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @mouseenter="handleMouseEnter"
      @contextmenu="handleRightClick"
    >
      <img
        src="../src/assets/logo.png"
        alt="Floating Button Icon"
        class="w-10 h-10 pointer-events-none"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 响应式状态
const isPulsing = ref(true)
const isDragging = ref(false)
const floatingButton = ref<HTMLElement>()

// 拖拽状态
interface DragState {
  isDragging: boolean
  isMouseDown: boolean
  startX: number
  startY: number
  startScreenX: number
  startScreenY: number
  dragTimer: number | null
  lastMoveTime: number
}

const dragState = ref<DragState>({
  isDragging: false,
  isMouseDown: false,
  startX: 0,
  startY: 0,
  startScreenX: 0,
  startScreenY: 0,
  dragTimer: null,
  lastMoveTime: 0
})

// 常量配置
const DRAG_DELAY = 200
const DRAG_THRESHOLD = 5

// 鼠标按下处理
const handleMouseDown = (event: MouseEvent) => {
  if (event.button !== 0) {
    return
  }
  event.preventDefault()

  dragState.value.isMouseDown = true
  dragState.value.startX = event.clientX
  dragState.value.startY = event.clientY
  dragState.value.startScreenX = event.screenX
  dragState.value.startScreenY = event.screenY
  dragState.value.lastMoveTime = Date.now()

  // 设置延迟定时器
  dragState.value.dragTimer = window.setTimeout(() => {
    if (dragState.value.isMouseDown) {
      startDragging(event)
    }
  }, DRAG_DELAY)

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

// 鼠标移动处理
const handleMouseMove = (event: MouseEvent) => {
  if (!dragState.value.isMouseDown) return

  const deltaX = Math.abs(event.clientX - dragState.value.startX)
  const deltaY = Math.abs(event.clientY - dragState.value.startY)

  if (!dragState.value.isDragging && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
    // 位移启动拖拽时，立即清除定时器，防止二次触发
    clearDragTimer()

    startDragging(event)
  }

  if (dragState.value.isDragging) {
    const now = Date.now()
    if (now - dragState.value.lastMoveTime >= 16) {
      dragState.value.lastMoveTime = now
      window.floatingButtonAPI?.onDragMove(event.screenX, event.screenY)
    }
  }
}

// 鼠标释放处理
const handleMouseUp = (event: MouseEvent) => {
  if (event.button !== 0) {
    return
  }
  const wasDragging = dragState.value.isDragging

  // 清理状态
  clearDragTimer()
  dragState.value.isMouseDown = false

  if (wasDragging) {
    dragState.value.isDragging = false
    isDragging.value = false
    window.floatingButtonAPI?.onDragEnd(event.screenX, event.screenY)
  } else {
    handleClick()
  }

  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// 开始拖拽
const startDragging = (_event: MouseEvent) => {
  dragState.value.isDragging = true
  isDragging.value = true
  // 使用初始记录的屏幕坐标，避免跳跃
  window.floatingButtonAPI?.onDragStart(dragState.value.startScreenX, dragState.value.startScreenY)
}

// 清理拖拽定时器
const clearDragTimer = () => {
  if (dragState.value.dragTimer) {
    clearTimeout(dragState.value.dragTimer)
    dragState.value.dragTimer = null
  }
}

// 点击处理
const handleClick = () => {
  // 点击反馈动画
  if (floatingButton.value) {
    floatingButton.value.style.transform = 'scale(0.9)'
    setTimeout(() => {
      if (floatingButton.value) {
        floatingButton.value.style.transform = ''
      }
    }, 150)
  }

  if (window.floatingButtonAPI) {
    try {
      window.floatingButtonAPI.onClick()
    } catch (error) {
      console.error('=== FloatingButton: Error calling onClick API ===:', error)
    }
  } else {
    console.error('=== FloatingButton: floatingButtonAPI not available ===')
  }
}

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()

  // 重置拖拽状态，防止右键后左键被误认为拖拽
  clearDragTimer()
  dragState.value.isMouseDown = false
  dragState.value.isDragging = false
  isDragging.value = false

  // 清理全局事件监听
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)

  if (floatingButton.value) {
    floatingButton.value.style.transform = 'scale(0.9)'
    setTimeout(() => {
      if (floatingButton.value) {
        floatingButton.value.style.transform = ''
      }
    }, 150)
  }

  if (window.floatingButtonAPI) {
    try {
      window.floatingButtonAPI.onRightClick()
    } catch (error) {
      console.error('=== FloatingButton: Error calling onRightClick API ===:', error)
    }
  } else {
    console.error('=== FloatingButton: floatingButtonAPI not available ===')
  }
}

// 鼠标事件处理
const handleMouseEnter = () => {
  isPulsing.value = false
}

const handleMouseLeave = () => {
  // 延迟恢复脉冲动画
  setTimeout(() => {
    isPulsing.value = true
  }, 3000)
}

// 配置更新处理
const handleConfigUpdate = (config: any) => {
  // 根据配置更新按钮样式
  if (config.opacity !== undefined && document.body) {
    document.body.style.opacity = config.opacity.toString()
  }
}

onMounted(() => {
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.onConfigUpdate(handleConfigUpdate)
  }
})

onUnmounted(() => {
  // 清理拖拽定时器
  clearDragTimer()

  // 清理全局事件监听
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)

  // 清理配置更新监听器
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.removeAllListeners()
  }
})
</script>

<style scoped>
/* 确保图片不会阻止点击事件 */
.pointer-events-none {
  pointer-events: none;
}

/* 悬浮按钮基础样式 */
.floating-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  /* 确保按钮可以接收鼠标事件 */
  pointer-events: auto;
  /* 禁止文本选择 */
  user-select: none;
  -webkit-user-select: none;
}

/* 拖拽状态样式 */
.floating-button.dragging {
  cursor: grabbing;
  transform: scale(1.05);
  box-shadow: 0 12px 30px rgba(102, 126, 234, 0.5);
  transition: none; /* 拖拽时禁用过渡动画 */
}

/* 悬浮按钮悬停效果 */
.floating-button:hover {
  transform: scale(1.1);
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

/* 悬浮按钮激活效果 */
.floating-button:active {
  transform: scale(0.95);
}

/* 悬浮按钮光泽效果 */
.floating-button::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  opacity: 0;
  transition: all 0.6s ease;
  background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transform: rotate(45deg);
}

.floating-button:hover::before {
  opacity: 1;
  animation: shine 1.5s ease-in-out infinite;
}

/* 光泽动画 */
@keyframes shine {
  0% {
    transform: rotate(45deg) translate(-100%, -100%);
  }
  50% {
    transform: rotate(45deg) translate(0%, 0%);
  }
  100% {
    transform: rotate(45deg) translate(100%, 100%);
  }
}

/* 脉冲动画 */
.floating-button-pulse {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(102, 126, 234, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0);
  }
}

/* 工具提示箭头 */
.tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.8);
}

/* 工具提示显示 */
.floating-button:hover .tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
