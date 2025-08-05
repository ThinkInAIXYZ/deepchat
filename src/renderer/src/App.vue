<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import UpdateDialog from './components/ui/UpdateDialog.vue'
import { usePresenter } from './composables/usePresenter'
import SelectedTextContextMenu from './components/message/SelectedTextContextMenu.vue'
import { useArtifactStore } from './stores/artifact'
import { useChatStore } from '@/stores/chat'
import { NOTIFICATION_EVENTS, SHORTCUT_EVENTS } from './events'
import Toaster from './components/ui/toast/Toaster.vue'
import { useToast } from './components/ui/toast/use-toast'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import TranslatePopup from '@/components/popup/TranslatePopup.vue'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { useModelCheckStore } from '@/stores/modelCheck'
import MessageDialog from './components/ui/MessageDialog.vue'

const route = useRoute()
const configPresenter = usePresenter('configPresenter')
const artifactStore = useArtifactStore()
const chatStore = useChatStore()
const { toast } = useToast()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const langStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()
const { t } = useI18n()
// 错误通知队列及当前正在显示的错误
const errorQueue = ref<Array<{ id: string; title: string; message: string; type: string }>>([])
const currentErrorId = ref<string | null>(null)
const errorDisplayTimer = ref<number | null>(null)

const isMacOS = ref(false)
const devicePresenter = usePresenter('devicePresenter')
// 监听主题和字体大小变化，直接更新 body class
watch(
  [() => themeStore.themeMode, () => settingsStore.fontSizeClass],
  ([newTheme, newFontSizeClass], [oldTheme, oldFontSizeClass]) => {
    if (oldTheme) {
      document.documentElement.classList.remove(oldTheme)
    }
    if (oldFontSizeClass) {
      document.documentElement.classList.remove(oldFontSizeClass)
    }
    document.documentElement.classList.add(newTheme)
    document.documentElement.classList.add(newFontSizeClass)
    console.log('newTheme', themeStore.themeMode)
  },
  { immediate: false } // 初始化在 onMounted 中处理
)

// 处理错误通知
const showErrorToast = (error: { id: string; title: string; message: string; type: string }) => {
  // 查找队列中是否已存在相同ID的错误，防止重复
  const existingErrorIndex = errorQueue.value.findIndex((e) => e.id === error.id)

  if (existingErrorIndex === -1) {
    // 如果当前有错误正在展示，将新错误放入队列
    if (currentErrorId.value) {
      if (errorQueue.value.length > 5) {
        errorQueue.value.shift()
      }
      errorQueue.value.push(error)
    } else {
      // 否则直接展示这个错误
      displayError(error)
    }
  }
}

// 显示指定的错误
const displayError = (error: { id: string; title: string; message: string; type: string }) => {
  // 更新当前显示的错误ID
  currentErrorId.value = error.id

  // 显示错误通知
  const { dismiss } = toast({
    title: error.title,
    description: error.message,
    variant: 'destructive',
    onOpenChange: (open) => {
      if (!open) {
        // 用户手动关闭时也显示下一个错误
        handleErrorClosed()
      }
    }
  })

  // 设置定时器，3秒后自动关闭当前错误
  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
  }

  errorDisplayTimer.value = window.setTimeout(() => {
    console.log('errorDisplayTimer.value', errorDisplayTimer.value)
    // 处理错误关闭后的逻辑
    dismiss()
    handleErrorClosed()
  }, 3000)
}

// 处理错误关闭后的逻辑
const handleErrorClosed = () => {
  // 清除当前错误ID
  currentErrorId.value = null

  // 显示队列中的下一个错误（如果有）
  if (errorQueue.value.length > 0) {
    const nextError = errorQueue.value.shift()
    if (nextError) {
      displayError(nextError)
    }
  } else {
    // 队列为空，清除定时器
    if (errorDisplayTimer.value) {
      clearTimeout(errorDisplayTimer.value)
      errorDisplayTimer.value = null
    }
  }
}

const router = useRouter()
const activeTab = ref('chat')

const getInitComplete = async () => {
  const initComplete = await configPresenter.getSetting('init_complete')
  if (!initComplete) {
    router.push({ name: 'welcome' })
  }
}

// 处理字体缩放
const handleZoomIn = () => {
  // 字体大小增加逻辑
  const currentLevel = settingsStore.fontSizeLevel
  settingsStore.updateFontSizeLevel(currentLevel + 1)
}

const handleZoomOut = () => {
  // 字体大小减小逻辑
  const currentLevel = settingsStore.fontSizeLevel
  settingsStore.updateFontSizeLevel(currentLevel - 1)
}

const handleZoomResume = () => {
  // 重置字体大小
  settingsStore.updateFontSizeLevel(1) // 1 对应 'text-base'，默认字体大小
}

// 处理创建新会话
const handleCreateNewConversation = () => {
  try {
    chatStore.createNewEmptyThread()
    // 简化处理，只记录日志，实际功能待实现
  } catch (error) {
    console.error('创建新会话失败:', error)
  }
}

// 处理进入设置页面
const handleGoSettings = () => {
  const currentRoute = router.currentRoute.value
  // 检查当前路由或其父路由是否已经是settings
  if (!currentRoute.path.startsWith('/settings')) {
    router.push({ name: 'settings' })
  }
}

getInitComplete()

onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
  // 设置初始 body class
  document.body.classList.add(themeStore.themeMode)
  document.body.classList.add(settingsStore.fontSizeClass)

  // 监听全局错误通知事件
  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SHOW_ERROR, (_event, error) => {
    showErrorToast(error)
  })

  // 监听快捷键事件
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.ZOOM_IN, () => {
    handleZoomIn()
  })

  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.ZOOM_OUT, () => {
    handleZoomOut()
  })

  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.ZOOM_RESUME, () => {
    handleZoomResume()
  })

  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION, () => {
    // 检查当前路由是否为聊天页面
    const currentRoute = router.currentRoute.value
    if (currentRoute.name !== 'chat') {
      return
    }
    handleCreateNewConversation()
  })

  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.GO_SETTINGS, () => {
    handleGoSettings()
  })

  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.DATA_RESET_COMPLETE_DEV, () => {
    toast({
      title: t('settings.data.resetCompleteDevTitle'),
      description: t('settings.data.resetCompleteDevMessage'),
      variant: 'default',
      duration: 15000
    })
  })

  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED, (_, msg) => {
    let threadId: string | null = null

    // 检查msg是否为字符串且是否以chat/开头
    if (typeof msg === 'string' && msg.startsWith('chat/')) {
      // 按/分割，检查是否有三段数据
      const parts = msg.split('/')
      if (parts.length === 3) {
        // 提取中间部分作为threadId
        threadId = parts[1]
      }
    } else if (msg && msg.threadId) {
      // 兼容原有格式，如果msg是对象且包含threadId属性
      threadId = msg.threadId
    }

    if (threadId) {
      chatStore.setActiveThread(threadId)
    }
  })

  watch(
    () => activeTab.value,
    (newVal) => {
      router.push({ name: newVal })
    }
  )

  watch(
    () => route.fullPath,
    (newVal) => {
      const pathWithoutQuery = newVal.split('?')[0]
      const newTab =
        pathWithoutQuery === '/'
          ? (route.name as string)
          : pathWithoutQuery.split('/').filter(Boolean)[0] || ''
      if (newTab !== activeTab.value) {
        activeTab.value = newTab
      }
      // 路由变化时关闭 artifacts 页面
      artifactStore.hideArtifact()
    }
  )

  // 监听当前对话的变化
  watch(
    () => chatStore.getActiveThreadId(),
    () => {
      // 当切换对话时关闭 artifacts 页面
      artifactStore.hideArtifact()
    }
  )

  watch(
    () => artifactStore.isOpen,
    () => {
      chatStore.isSidebarOpen = false
    }
  )
})

// 在组件卸载前清除定时器和事件监听
onBeforeUnmount(() => {
  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
    errorDisplayTimer.value = null
  }

  // 移除快捷键事件监听
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.ZOOM_IN)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.ZOOM_OUT)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.ZOOM_RESUME)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.GO_SETTINGS)
  window.electron.ipcRenderer.removeAllListeners(NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED)
  window.electron.ipcRenderer.removeAllListeners(NOTIFICATION_EVENTS.DATA_RESET_COMPLETE_DEV)
})
</script>

<template>
  <div class="flex flex-col h-screen bg-container">
    <div
      class="flex flex-row h-0 flex-grow relative overflow-hidden px-[1px] py-[1px]"
      :dir="langStore.dir"
    >
      <!-- 主内容区域 -->

      <RouterView />
    </div>
    <!-- 全局更新弹窗 -->
    <UpdateDialog />
    <!-- 全局消息弹窗 -->
    <MessageDialog />
    <!-- 全局Toast提示 -->
    <Toaster />
    <SelectedTextContextMenu />
    <TranslatePopup />
    <!-- 全局模型检查弹窗 -->
    <ModelCheckDialog
      :open="modelCheckStore.isDialogOpen"
      :provider-id="modelCheckStore.currentProviderId"
      @update:open="
        (open) => {
          if (!open) modelCheckStore.closeDialog()
        }
      "
    />
  </div>
</template>
