import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'

// 定义全局事件总线
const CLOSE_PREVIEW_EVENT = 'close-artifacts-preview'

// 定义Artifact的接口
export interface ArtifactPreviewData {
  content: string
  type: string
  title: string
  language?: string
  id?: string
}

// 扩展Window接口
declare global {
  interface Window {
    openArtifactsPreview: (artifact: ArtifactPreviewData) => void
    closeArtifactsPreview: () => void
    dispatchArtifactEvent?: (eventName: string) => void
  }
}

// 创建一个具有响应式功能的单例
let instance: ReturnType<typeof createArtifactsPreview> | null = null

// 创建预览状态和方法
function createArtifactsPreview() {
  const route = useRoute()
  
  // 预览状态
  const showArtifactsPreview = ref(false)
  const currentArtifact = ref<ArtifactPreviewData | null>(null)

  // 打开/切换预览
  const openArtifactsPreview = (artifact: ArtifactPreviewData) => {
    // 如果已经打开了预览，检查是否是同一个artifact
    if (showArtifactsPreview.value && 
        currentArtifact.value?.id === artifact.id) {
      // 如果是同一个artifact，则关闭预览
      closeArtifactsPreview()
    } else {
      // 否则打开新的预览
      currentArtifact.value = artifact
      showArtifactsPreview.value = true
    }
  }

  // 关闭预览
  const closeArtifactsPreview = () => {
    showArtifactsPreview.value = false
  }

  // 暴露方法到全局
  const exposeGlobalMethods = () => {
    window.openArtifactsPreview = openArtifactsPreview
    window.closeArtifactsPreview = closeArtifactsPreview
    
    // 添加事件分发器
    window.dispatchArtifactEvent = (eventName: string) => {
      if (eventName === CLOSE_PREVIEW_EVENT) {
        closeArtifactsPreview()
      }
    }
  }

  // 设置键盘事件监听
  const setupKeyboardListener = () => {
    window.addEventListener('keydown', handleKeyDown)
  }
  
  // 处理键盘事件
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && showArtifactsPreview.value) {
      closeArtifactsPreview()
    }
  }
  
  // 监听路由变化
  watch(
    () => route.fullPath,
    () => {
      console.log('路由完整路径变化，关闭预览')
      closeArtifactsPreview()
    }
  )
  
  // 监听页面可见性变化
  const handleVisibilityChange = () => {
    if (document.hidden) {
      closeArtifactsPreview()
    }
  }
  
  // 初始化和清理事件监听
  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // 添加自定义事件监听
    window.addEventListener(CLOSE_PREVIEW_EVENT, closeArtifactsPreview)
    
    // 监听窗口切换
    window.addEventListener('blur', closeArtifactsPreview)
  })
  
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('blur', closeArtifactsPreview)
    window.removeEventListener(CLOSE_PREVIEW_EVENT, closeArtifactsPreview)
  })

  return {
    showArtifactsPreview,
    currentArtifact,
    openArtifactsPreview,
    closeArtifactsPreview,
    exposeGlobalMethods,
    setupKeyboardListener
  }
}

// 导出单例
export function useArtifactsPreview() {
  if (!instance) {
    instance = createArtifactsPreview()
  }
  return instance
} 