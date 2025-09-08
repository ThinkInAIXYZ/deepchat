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
// Error notification queue and currently displayed error
const errorQueue = ref<Array<{ id: string; title: string; message: string; type: string }>>([])
const currentErrorId = ref<string | null>(null)
const errorDisplayTimer = ref<number | null>(null)

const isMacOS = ref(false)
const devicePresenter = usePresenter('devicePresenter')
// Watch theme and font size changes, update body class directly
watch(
  [() => themeStore.themeMode, () => settingsStore.fontSizeClass],
  ([newTheme, newFontSizeClass], [oldTheme, oldFontSizeClass]) => {
    let newThemeName = newTheme
    if (newTheme === 'system') {
      newThemeName = themeStore.isDark ? 'dark' : 'light'
    }
    if (oldTheme) {
      document.documentElement.classList.remove(oldTheme)
    }
    if (oldFontSizeClass) {
      document.documentElement.classList.remove(oldFontSizeClass)
    }
    document.documentElement.classList.add(newThemeName)
    document.documentElement.classList.add(newFontSizeClass)
    console.log('newTheme', newThemeName)
  },
  { immediate: false } // Initialization is handled in onMounted
)

// Handle error notifications
const showErrorToast = (error: { id: string; title: string; message: string; type: string }) => {
  // Check if error with same ID already exists in queue to prevent duplicates
  const existingErrorIndex = errorQueue.value.findIndex((e) => e.id === error.id)

  if (existingErrorIndex === -1) {
    // If there's currently an error being displayed, add new error to queue
    if (currentErrorId.value) {
      if (errorQueue.value.length > 5) {
        errorQueue.value.shift()
      }
      errorQueue.value.push(error)
    } else {
      // Otherwise display this error directly
      displayError(error)
    }
  }
}

// Display specified error
const displayError = (error: { id: string; title: string; message: string; type: string }) => {
  // Update currently displayed error ID
  currentErrorId.value = error.id

  // Show error notification
  const { dismiss } = toast({
    title: error.title,
    description: error.message,
    variant: 'destructive',
    onOpenChange: (open) => {
      if (!open) {
        // Also show next error when user manually closes
        handleErrorClosed()
      }
    }
  })

  // Set timer to automatically close current error after 3 seconds
  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
  }

  errorDisplayTimer.value = window.setTimeout(() => {
    console.log('errorDisplayTimer.value', errorDisplayTimer.value)
    // Handle logic after error is closed
    dismiss()
    handleErrorClosed()
  }, 3000)
}

// Handle logic after error is closed
const handleErrorClosed = () => {
  // Clear current error ID
  currentErrorId.value = null

  // Display next error in queue (if any)
  if (errorQueue.value.length > 0) {
    const nextError = errorQueue.value.shift()
    if (nextError) {
      displayError(nextError)
    }
  } else {
    // Queue is empty, clear timer
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

// Handle font scaling
const handleZoomIn = () => {
  // Font size increase logic
  const currentLevel = settingsStore.fontSizeLevel
  settingsStore.updateFontSizeLevel(currentLevel + 1)
}

const handleZoomOut = () => {
  // Font size decrease logic
  const currentLevel = settingsStore.fontSizeLevel
  settingsStore.updateFontSizeLevel(currentLevel - 1)
}

const handleZoomResume = () => {
  // Reset font size
  settingsStore.updateFontSizeLevel(1) // 1 corresponds to 'text-base', default font size
}

// Handle creating new conversation
const handleCreateNewConversation = () => {
  try {
    chatStore.createNewEmptyThread()
    // Simplified handling, just log, actual functionality to be implemented
  } catch (error) {
    console.error('Failed to create new conversation:', error)
  }
}

// Handle going to settings page
const handleGoSettings = () => {
  const currentRoute = router.currentRoute.value
  // Check if current route or its parent route is already settings
  if (!currentRoute.path.startsWith('/settings')) {
    router.push({ name: 'settings' })
  }
}

// Handle ESC key - close floating chat window
const handleEscKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    window.electron.ipcRenderer.send('close-floating-window')
  }
}

getInitComplete()

onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
  // Set initial body class
  document.body.classList.add(themeStore.themeMode)
  document.body.classList.add(settingsStore.fontSizeClass)

  window.addEventListener('keydown', handleEscKey)

  // Listen for global error notification events
  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SHOW_ERROR, (_event, error) => {
    showErrorToast(error)
  })

  // Listen for shortcut key events
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
    // Check if current route is chat page
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

    // Check if msg is string and starts with chat/
    if (typeof msg === 'string' && msg.startsWith('chat/')) {
      // Split by /, check if there are three segments
      const parts = msg.split('/')
      if (parts.length === 3) {
        // Extract middle part as threadId
        threadId = parts[1]
      }
    } else if (msg && msg.threadId) {
      // Compatible with original format, if msg is object and contains threadId property
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
      // Close artifacts page when route changes
      artifactStore.hideArtifact()
    }
  )

  // Listen for changes to current conversation
  watch(
    () => chatStore.getActiveThreadId(),
    () => {
      // Close artifacts page when switching conversations
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

// Clear timers and event listeners before component unmounts
onBeforeUnmount(() => {
  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
    errorDisplayTimer.value = null
  }

  window.removeEventListener('keydown', handleEscKey)

  // Remove shortcut key event listeners
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
      <!-- Main content area -->

      <RouterView />
    </div>
    <!-- Global update dialog -->
    <UpdateDialog />
    <!-- Global message dialog -->
    <MessageDialog />
    <!-- Global Toast notifications -->
    <Toaster />
    <SelectedTextContextMenu />
    <TranslatePopup />
    <!-- Global model check dialog -->
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
