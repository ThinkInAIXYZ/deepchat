<template>
  <div class="w-screen h-screen bg-transparent overflow-hidden select-none flex items-center justify-center">
    <div 
      ref="floatingButton" 
      class="w-15 h-15 rounded-full border-2 border-white/30 flex items-center justify-center cursor-pointer transition-all duration-300 relative overflow-hidden select-none floating-button"
      :class="{ 'floating-button-pulse': isPulsing }"
      @click="handleClick"
      @mouseenter="handleMouseEnter" 
      @mouseleave="handleMouseLeave"
    >
      <svg class="w-6 h-6 fill-white z-1 relative" viewBox="0 0 24 24">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
      </svg>
      <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-3 py-2 rounded-md text-xs whitespace-nowrap opacity-0 invisible transition-all duration-300 pointer-events-none mb-2 tooltip">
        点击打开 DeepChat
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 响应式状态
const isPulsing = ref(true)
const floatingButton = ref<HTMLElement>()

// 点击处理 - 专注于唤起主窗口
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
    window.floatingButtonAPI.onConfigUpdate(handleConfigUpdate);
  }
})

onUnmounted(() => {
  // 清理配置更新监听器
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.removeAllListeners()
  }
})
</script>

<style scoped>
/* 悬浮按钮基础样式 */
.floating-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
