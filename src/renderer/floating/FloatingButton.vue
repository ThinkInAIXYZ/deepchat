<template>
  <div class="floating-button-container">
    <div 
      ref="floatingButton"
      class="floating-button" 
      :class="{ pulse: isPulsing }"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
      @mousedown="handleMouseDown"
    >
      <svg class="icon" viewBox="0 0 24 24">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
      <div class="tooltip">打开 DeepChat</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 响应式状态
const isPulsing = ref(true)
const floatingButton = ref<HTMLElement>()
let dragStartPos = { x: 0, y: 0 }
let isDragging = false

// 鼠标按下处理 - 记录起始位置
const handleMouseDown = (event: MouseEvent) => {
  dragStartPos.x = event.clientX
  dragStartPos.y = event.clientY
  isDragging = false
  
  // 添加鼠标释放监听器
  document.addEventListener('mouseup', handleMouseUp)
  document.addEventListener('mousemove', handleMouseMove)
}

// 鼠标移动处理 - 检测是否为拖拽
const handleMouseMove = (event: MouseEvent) => {
  const deltaX = Math.abs(event.clientX - dragStartPos.x)
  const deltaY = Math.abs(event.clientY - dragStartPos.y)
  
  // 如果移动超过5像素，认为是拖拽
  if (deltaX > 5 || deltaY > 5) {
    isDragging = true
  }
}

// 鼠标释放处理 - 判断是点击还是拖拽
const handleMouseUp = () => {
  // 移除监听器
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('mousemove', handleMouseMove)
  
  // 如果不是拖拽，则处理点击
  if (!isDragging) {
    handleClick()
  }
  
  isDragging = false
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

  // 通知主进程
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.onClick()
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
  console.log('Config updated:', config)
  // 根据配置更新按钮样式
  if (config.opacity !== undefined && document.body) {
    document.body.style.opacity = config.opacity.toString()
  }
}

onMounted(() => {
  // 监听配置更新
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.onConfigUpdate(handleConfigUpdate)
  }

  // 添加初始动画延迟
  setTimeout(() => {
    isPulsing.value = true
  }, 1000)
})

onUnmounted(() => {
  // 清理拖拽事件监听器
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('mousemove', handleMouseMove)
  
  // 清理配置更新监听器
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.removeAllListeners()
  }
})
</script>

<style scoped>
.floating-button-container {
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.floating-button {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: 2px solid rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  -webkit-app-region: drag; /* 让按钮可拖拽 */
}

.floating-button:hover {
  transform: scale(1.1);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
  border-color: rgba(255, 255, 255, 0.6);
}

.floating-button:active {
  transform: scale(0.95);
}

.floating-button::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transform: rotate(45deg);
  transition: all 0.6s ease;
  opacity: 0;
}

.floating-button:hover::before {
  opacity: 1;
  animation: shine 1.5s ease-in-out infinite;
}

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

.icon {
  width: 24px;
  height: 24px;
  fill: white;
  z-index: 1;
  position: relative;
}

/* 脉冲动画 */
.floating-button.pulse {
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

/* 工具提示 */
.tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
  pointer-events: none;
  margin-bottom: 8px;
}

.tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.8);
}

.floating-button:hover .tooltip {
  opacity: 1;
  visibility: visible;
}
</style>
