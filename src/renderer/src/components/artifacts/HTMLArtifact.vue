<template>
  <div class="w-full h-full overflow-auto">
    <div
      class="relative w-full h-full"
      :class="viewportSize !== 'desktop' ? 'flex items-center justify-center' : ''"
    >
      <div :class="viewportSize === 'desktop' ? 'relative w-full h-full' : 'relative'">
        <iframe
          ref="iframeRef"
          :srcdoc="block.content"
          :class="viewportClasses"
          :style="viewportStyles"
          sandbox="allow-scripts allow-same-origin"
        ></iframe>
        <!-- iframe拖拽遮罩层 -->
        <div
          ref="iframeMaskRef"
          class="absolute inset-0 bg-transparent pointer-events-none"
          :class="{ 'pointer-events-auto': isDragging }"
          style="z-index: 1000"
        ></div>
      </div>

      <!-- 左侧拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute top-1/2 transform -translate-y-1/2 w-2 cursor-col-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="handleLeftDragStart"
        :style="{
          left: `calc(50% - ${(viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680) / 2}px - 1px)`,
          height: `${viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800}px`
        }"
      >
        <div
          class="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-0.5 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 右侧拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute top-1/2 transform -translate-y-1/2 w-2 cursor-col-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="handleRightDragStart"
        :style="{
          right: `calc(50% - ${(viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680) / 2}px - 1px)`,
          height: `${viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800}px`
        }"
      >
        <div
          class="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-0.5 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 上侧拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute left-1/2 transform -translate-x-1/2 h-2 cursor-row-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="handleTopDragStart"
        :style="{
          top: `calc(50% - ${(viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800) / 2}px - 1px)`,
          width: `${viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680}px`
        }"
      >
        <div
          class="absolute inset-x-0 top-1/2 transform -translate-y-1/2 h-0.5 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 下侧拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute left-1/2 transform -translate-x-1/2 h-2 cursor-row-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="handleBottomDragStart"
        :style="{
          bottom: `calc(50% - ${(viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800) / 2}px - 1px)`,
          width: `${viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680}px`
        }"
      >
        <div
          class="absolute inset-x-0 top-1/2 transform -translate-y-1/2 h-0.5 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 左上角拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute w-3 h-3 cursor-nw-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="(e) => handleCornerDragStart(e, 'nw')"
        :style="{
          left: `calc(50% - ${(viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680) / 2}px - 1px)`,
          top: `calc(50% - ${(viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800) / 2}px - 1px)`
        }"
      >
        <div
          class="absolute inset-0 border-l-2 border-t-2 border-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 右上角拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute w-3 h-3 cursor-ne-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="(e) => handleCornerDragStart(e, 'ne')"
        :style="{
          right: `calc(50% - ${(viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680) / 2}px - 1px)`,
          top: `calc(50% - ${(viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800) / 2}px - 1px)`
        }"
      >
        <div
          class="absolute inset-0 border-r-2 border-t-2 border-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 左下角拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute w-3 h-3 cursor-sw-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="(e) => handleCornerDragStart(e, 'sw')"
        :style="{
          left: `calc(50% - ${(viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680) / 2}px - 1px)`,
          bottom: `calc(50% - ${(viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800) / 2}px - 1px)`
        }"
      >
        <div
          class="absolute inset-0 border-l-2 border-b-2 border-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>

      <!-- 右下角拖动手柄 -->
      <div
        v-if="viewportSize !== 'desktop'"
        class="absolute w-3 h-3 cursor-se-resize transition-all duration-200 group"
        :class="{
          'bg-blue-500 bg-opacity-30': isDragging,
          'hover:bg-blue-500 hover:bg-opacity-20': !isDragging
        }"
        @mousedown="(e) => handleCornerDragStart(e, 'se')"
        :style="{
          right: `calc(50% - ${(viewportSize === 'mobile' ? mobileWidth || 390 : tabletWidth || 680) / 2}px - 1px)`,
          bottom: `calc(50% - ${(viewportSize === 'mobile' ? mobileHeight || 844 : tabletHeight || 800) / 2}px - 1px)`
        }"
      >
        <div
          class="absolute inset-0 border-r-2 border-b-2 border-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          :class="{ 'opacity-100': isDragging }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
// import DOMPurify from 'dompurify'

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
  isPreview: boolean
  viewportSize?: 'desktop' | 'tablet' | 'mobile'
  tabletWidth?: number
  mobileWidth?: number
  tabletHeight?: number
  mobileHeight?: number
}>()

const iframeRef = ref<HTMLIFrameElement>()
const iframeMaskRef = ref<HTMLDivElement>()
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartWidth = ref(0)
const dragStartHeight = ref(0)
const dragDirection = ref<'left' | 'right' | 'top' | 'bottom' | 'corner'>('right')
const cornerType = ref<'nw' | 'ne' | 'sw' | 'se'>('se')

// 性能优化：缓存计算结果
const dragConstraints = ref({
  minWidth: 320,
  maxWidth: 1200,
  minHeight: 426,
  maxHeight: 1400
})

const emit = defineEmits<{
  'update:tabletWidth': [width: number]
  'update:mobileWidth': [width: number]
  'update:tabletHeight': [height: number]
  'update:mobileHeight': [height: number]
}>()

const viewportClasses = computed(() => {
  const size = props.viewportSize || 'desktop'
  const baseClasses = 'html-iframe-wrapper'
  const transitionClasses = isDragging.value ? '' : 'transition-all duration-300 ease-in-out'

  switch (size) {
    case 'mobile':
    case 'tablet':
      return `${baseClasses} ${transitionClasses} border border-gray-300 dark:border-gray-600 relative`
    default:
      return `${baseClasses} ${transitionClasses} w-full h-full`
  }
})

const viewportStyles = computed(() => {
  const size = props.viewportSize || 'desktop'

  switch (size) {
    case 'mobile':
      return {
        width: `${props.mobileWidth || 390}px`,
        height: `${props.mobileHeight || 844}px`
      }
    case 'tablet':
      return {
        width: `${props.tabletWidth || 680}px`,
        height: `${props.tabletHeight || 800}px`
      }
    default:
      return {}
  }
})

const handleLeftDragStart = (e: MouseEvent) => {
  if (props.viewportSize === 'desktop') return

  isDragging.value = true
  dragDirection.value = 'left'
  dragStartX.value = e.clientX

  const currentWidth =
    props.viewportSize === 'mobile' ? props.mobileWidth || 390 : props.tabletWidth || 680
  dragStartWidth.value = currentWidth

  // 更新约束边界
  updateConstraints()

  // 启用iframe遮罩，防止拖拽时iframe干扰
  enableIframeMask()

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  document.addEventListener('mousemove', handleHorizontalDragMove, { passive: false })
  document.addEventListener('mouseup', handleDragEnd, { passive: false })
  e.preventDefault()
}

const handleRightDragStart = (e: MouseEvent) => {
  if (props.viewportSize === 'desktop') return

  isDragging.value = true
  dragDirection.value = 'right'
  dragStartX.value = e.clientX

  const currentWidth =
    props.viewportSize === 'mobile' ? props.mobileWidth || 390 : props.tabletWidth || 680
  dragStartWidth.value = currentWidth

  updateConstraints()

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  document.addEventListener('mousemove', handleHorizontalDragMove, { passive: false })
  document.addEventListener('mouseup', handleDragEnd, { passive: false })
  e.preventDefault()
}

// 节流优化：使用更高效的方式
let lastUpdateTime = 0
const UPDATE_THROTTLE = 8 // 约125fps，比60fps更流畅

const throttledEmit = (updateFn: () => void) => {
  const now = performance.now()
  if (now - lastUpdateTime >= UPDATE_THROTTLE) {
    lastUpdateTime = now
    updateFn()
  }
}

// 计算约束边界（缓存结果）
const updateConstraints = () => {
  dragConstraints.value = {
    minWidth: 320,
    maxWidth: Math.min(window.innerWidth - 100, props.viewportSize === 'mobile' ? 480 : 1200),
    minHeight: 426,
    maxHeight: Math.min(window.innerHeight - 100, props.viewportSize === 'mobile' ? 1000 : 1400)
  }
}

// iframe遮罩控制函数
const enableIframeMask = () => {
  // 通过Vue的响应式系统，isDragging变化会自动更新DOM
  // 遮罩层的CSS类会自动应用pointer-events-auto
}

const disableIframeMask = () => {
  // 同样通过响应式系统自动处理
  // 遮罩层会自动移除pointer-events-auto类
}

const handleHorizontalDragMove = (e: MouseEvent) => {
  if (!isDragging.value) return

  const deltaX = e.clientX - dragStartX.value
  const { minWidth, maxWidth } = dragConstraints.value

  let newWidth: number
  if (dragDirection.value === 'left') {
    newWidth = dragStartWidth.value - deltaX
  } else {
    newWidth = dragStartWidth.value + deltaX
  }

  newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))

  // 使用节流但不延迟更新
  throttledEmit(() => {
    if (props.viewportSize === 'mobile') {
      emit('update:mobileWidth', Math.round(newWidth))
    } else if (props.viewportSize === 'tablet') {
      emit('update:tabletWidth', Math.round(newWidth))
    }
  })
}

const handleDragEnd = () => {
  isDragging.value = false
  lastUpdateTime = 0

  // 禁用iframe遮罩，恢复正常交互
  disableIframeMask()

  document.body.style.userSelect = ''
  document.body.style.cursor = ''

  document.removeEventListener('mousemove', handleHorizontalDragMove)
  document.removeEventListener('mousemove', handleVerticalDragMove)
  document.removeEventListener('mousemove', handleCornerDragMove)
  document.removeEventListener('mouseup', handleDragEnd)
}

const handleTopDragStart = (e: MouseEvent) => {
  if (props.viewportSize === 'desktop') return

  isDragging.value = true
  dragDirection.value = 'top'
  dragStartY.value = e.clientY

  const currentHeight =
    props.viewportSize === 'mobile' ? props.mobileHeight || 844 : props.tabletHeight || 800
  dragStartHeight.value = currentHeight

  updateConstraints()

  enableIframeMask()

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'

  document.addEventListener('mousemove', handleVerticalDragMove, { passive: false })
  document.addEventListener('mouseup', handleDragEnd, { passive: false })
  e.preventDefault()
}

const handleBottomDragStart = (e: MouseEvent) => {
  if (props.viewportSize === 'desktop') return

  isDragging.value = true
  dragDirection.value = 'bottom'
  dragStartY.value = e.clientY

  const currentHeight =
    props.viewportSize === 'mobile' ? props.mobileHeight || 844 : props.tabletHeight || 800
  dragStartHeight.value = currentHeight

  updateConstraints()

  enableIframeMask()

  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'

  document.addEventListener('mousemove', handleVerticalDragMove, { passive: false })
  document.addEventListener('mouseup', handleDragEnd, { passive: false })
  e.preventDefault()
}

const handleVerticalDragMove = (e: MouseEvent) => {
  if (!isDragging.value) return

  const deltaY = e.clientY - dragStartY.value
  const { minHeight, maxHeight } = dragConstraints.value

  let newHeight: number
  if (dragDirection.value === 'top') {
    newHeight = dragStartHeight.value - deltaY
  } else {
    newHeight = dragStartHeight.value + deltaY
  }

  newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))

  throttledEmit(() => {
    if (props.viewportSize === 'mobile') {
      emit('update:mobileHeight', Math.round(newHeight))
    } else if (props.viewportSize === 'tablet') {
      emit('update:tabletHeight', Math.round(newHeight))
    }
  })
}

const handleCornerDragStart = (e: MouseEvent, corner: 'nw' | 'ne' | 'sw' | 'se') => {
  if (props.viewportSize === 'desktop') return

  isDragging.value = true
  dragDirection.value = 'corner'
  cornerType.value = corner
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY

  const currentWidth =
    props.viewportSize === 'mobile' ? props.mobileWidth || 390 : props.tabletWidth || 680
  const currentHeight =
    props.viewportSize === 'mobile' ? props.mobileHeight || 844 : props.tabletHeight || 800

  dragStartWidth.value = currentWidth
  dragStartHeight.value = currentHeight

  updateConstraints()

  enableIframeMask()

  document.body.style.userSelect = 'none'
  document.body.style.cursor = `${corner}-resize`

  document.addEventListener('mousemove', handleCornerDragMove, { passive: false })
  document.addEventListener('mouseup', handleDragEnd, { passive: false })
  e.preventDefault()
}

const handleCornerDragMove = (e: MouseEvent) => {
  if (!isDragging.value) return

  const deltaX = e.clientX - dragStartX.value
  const deltaY = e.clientY - dragStartY.value

  const { minWidth, maxWidth, minHeight, maxHeight } = dragConstraints.value

  let newWidth = dragStartWidth.value
  let newHeight = dragStartHeight.value

  // 根据不同角落调整尺寸
  switch (cornerType.value) {
    case 'nw': // 左上角：向左上拖拽增大
      newWidth = dragStartWidth.value - deltaX
      newHeight = dragStartHeight.value - deltaY
      break
    case 'ne': // 右上角：向右上拖拽增大
      newWidth = dragStartWidth.value + deltaX
      newHeight = dragStartHeight.value - deltaY
      break
    case 'sw': // 左下角：向左下拖拽增大
      newWidth = dragStartWidth.value - deltaX
      newHeight = dragStartHeight.value + deltaY
      break
    case 'se': // 右下角：向右下拖拽增大
      newWidth = dragStartWidth.value + deltaX
      newHeight = dragStartHeight.value + deltaY
      break
  }

  // 应用边界限制
  newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))
  newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight))

  throttledEmit(() => {
    if (props.viewportSize === 'mobile') {
      emit('update:mobileWidth', Math.round(newWidth))
      emit('update:mobileHeight', Math.round(newHeight))
    } else if (props.viewportSize === 'tablet') {
      emit('update:tabletWidth', Math.round(newWidth))
      emit('update:tabletHeight', Math.round(newHeight))
    }
  })
}

// const sanitizedContent = computed(() => {
//   if (!props.block.content) return ''
//   return DOMPurify.sanitize(props.block.content, {
//     WHOLE_DOCUMENT: true,
//     ADD_TAGS: ['script', 'style'],
//     ADD_ATTR: ['src', 'style', 'onclick'],
//     ALLOWED_URI_REGEXP:
//       /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|xxx):|[^a-z]|[a-z+.]+(?:[^a-z+.:]|$))/i
//   })
// })

const setupIframe = () => {
  if (props.isPreview && iframeRef.value) {
    const iframe = iframeRef.value
    iframe.onload = () => {
      const doc = iframe.contentDocument
      if (!doc) return

      // 添加视口元标签
      const viewportSize = props.viewportSize || 'desktop'
      let viewportContent = 'width=device-width, initial-scale=1.0'

      if (viewportSize === 'mobile') {
        const width = props.mobileWidth || 375
        viewportContent = `width=${width}, initial-scale=1.0`
      } else if (viewportSize === 'tablet') {
        const width = props.tabletWidth || 768
        viewportContent = `width=${width}, initial-scale=1.0`
      }

      // 移除现有的视口元标签
      const existingViewport = doc.querySelector('meta[name="viewport"]')
      if (existingViewport) {
        existingViewport.remove()
      }

      // 添加新的视口元标签
      const viewportMeta = doc.createElement('meta')
      viewportMeta.name = 'viewport'
      viewportMeta.content = viewportContent
      doc.head.appendChild(viewportMeta)

      // 添加基础样式
      const resetCSS = `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body {
        height: 100%;
        font-family: Arial, sans-serif;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
    `
      const styleElement = doc.createElement('style')
      styleElement.textContent = resetCSS
      doc.head.appendChild(styleElement)
    }
  }
}

onMounted(() => {
  setupIframe()
})

// 监听视口尺寸变化
watch(
  () => props.viewportSize,
  () => {
    setupIframe()
  }
)

// 监听尺寸变化 - 防抖优化
let resizeTimer: NodeJS.Timeout | null = null
watch(
  () => [props.tabletWidth, props.mobileWidth, props.tabletHeight, props.mobileHeight],
  () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }
    resizeTimer = setTimeout(() => {
      setupIframe()
    }, 100) // 100ms 防抖延迟
  }
)

// 组件卸载时清理事件监听器
onUnmounted(() => {
  if (resizeTimer) {
    clearTimeout(resizeTimer)
  }

  if (isDragging.value) {
    document.removeEventListener('mousemove', handleHorizontalDragMove)
    document.removeEventListener('mousemove', handleVerticalDragMove)
    document.removeEventListener('mousemove', handleCornerDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }
})
</script>
