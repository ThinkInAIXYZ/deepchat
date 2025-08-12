<template>
  <div
    class="w-screen h-screen bg-transparent overflow-hidden select-none flex items-center justify-center drag-region"
  >
    <div
      ref="floatingButton"
      class="w-15 h-15 rounded-full border-2 border-white/30 flex items-center justify-center cursor-pointer transition-all duration-300 relative overflow-hidden select-none floating-button no-drag"
      :class="{ 'floating-button-pulse': isPulsing }"
      @click="handleClick"
      @contextmenu="handleRightClick"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
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

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()
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
  // 清理配置更新监听器
  if (window.floatingButtonAPI) {
    window.floatingButtonAPI.removeAllListeners()
  }
})
</script>

<style scoped>
/* 拖拽区域 */
.drag-region {
  -webkit-app-region: drag;
}

/* 禁用拖拽的元素 */
.no-drag {
  -webkit-app-region: no-drag;
}

/* 确保图片不会阻止点击事件 */
.pointer-events-none {
  pointer-events: none;
}

/* 悬浮按钮基础样式 */
.floating-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  /* 按钮本身不可拖拽，只响应点击 */
  -webkit-app-region: no-drag;
  /* 确保按钮可以接收鼠标事件 */
  pointer-events: auto;
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
