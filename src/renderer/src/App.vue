<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { RouterView, useRoute, useRouter } from 'vue-router'
import UpdateDialog from './components/ui/UpdateDialog.vue'
import { usePresenter } from './composables/usePresenter'
import SelectedTextContextMenu from './components/message/SelectedTextContextMenu.vue'
import { useChatStore } from '@/stores/chat'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useWindowStore } from '@/stores/windowStore'
import { NOTIFICATION_EVENTS, SHORTCUT_EVENTS, THREAD_VIEW_EVENTS } from './events'
import { Toaster } from '@shadcn/components/ui/sonner'
import { useToast } from '@/components/use-toast'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import TranslatePopup from '@/components/popup/TranslatePopup.vue'
import ThreadView from '@/components/ThreadView.vue'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { useModelCheckStore } from '@/stores/modelCheck'
import MessageDialog from './components/ui/MessageDialog.vue'
import McpSamplingDialog from '@/components/mcp/McpSamplingDialog.vue'
import { initAppStores, useMcpInstallDeeplinkHandler } from '@/lib/storeInitializer'
import 'vue-sonner/style.css' // vue-sonner v2 requires this import
import { useFontManager } from './composables/useFontManager'
import IconSidebar from '@/components/sidebar/IconSidebar.vue'
import ChatAppBar from '@/components/ChatAppBar.vue'
import { useConversationNavigation } from '@/composables/useConversationNavigation'

// Sidebar width management
const MIN_SIDEBAR_WIDTH = 8 * 9 // Minimum width to accommodate macOS traffic lights
const MAX_SIDEBAR_WIDTH = 300
const DEFAULT_SIDEBAR_WIDTH = 8 * 9
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH)
const isResizing = ref(false)

const route = useRoute()
const configPresenter = usePresenter('configPresenter')
const chatStore = useChatStore()
const { toast } = useToast()
const uiSettingsStore = useUiSettingsStore()
const { setupFontListener } = useFontManager()
setupFontListener()

const themeStore = useThemeStore()
const langStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()
const sidebarStore = useSidebarStore()
const windowStore = useWindowStore()
const { isMacOS } = storeToRefs(windowStore)
const { t } = useI18n()
const { navigateToConversation, navigateToHome } = useConversationNavigation()
const toasterTheme = computed(() =>
  themeStore.themeMode === 'system' ? (themeStore.isDark ? 'dark' : 'light') : themeStore.themeMode
)
// Error notification queue and currently displayed error
const errorQueue = ref<Array<{ id: string; title: string; message: string; type: string }>>([])
const currentErrorId = ref<string | null>(null)
const errorDisplayTimer = ref<number | null>(null)
const { setup: setupMcpDeeplink, cleanup: cleanupMcpDeeplink } = useMcpInstallDeeplinkHandler()
// Watch theme and font size changes, update body class directly
watch(
  [() => themeStore.themeMode, () => uiSettingsStore.fontSizeClass],
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

const getInitComplete = async () => {
  const initComplete = await configPresenter.getSetting('init_complete')
  if (!initComplete) {
    router.push({ name: 'welcome' })
  }
}

// Handle font scaling
const handleZoomIn = () => {
  // Font size increase logic
  const currentLevel = uiSettingsStore.fontSizeLevel
  uiSettingsStore.updateFontSizeLevel(currentLevel + 1)
}

const handleZoomOut = () => {
  // Font size decrease logic
  const currentLevel = uiSettingsStore.fontSizeLevel
  uiSettingsStore.updateFontSizeLevel(currentLevel - 1)
}

const handleZoomResume = () => {
  // Reset font size
  uiSettingsStore.updateFontSizeLevel(1) // 1 corresponds to 'text-base', default font size
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

const handleThreadViewToggle = () => {
  if (router.currentRoute.value.name !== 'chat') {
    void router.push({ name: 'chat' })
    chatStore.isSidebarOpen = true
    return
  }
  chatStore.isSidebarOpen = !chatStore.isSidebarOpen
}

// Sidebar event handlers for Single WebContents Architecture
const handleSidebarConversationSelect = (conversationId: string) => {
  navigateToConversation(conversationId)
}

const handleSidebarConversationClose = (conversationId: string) => {
  sidebarStore.closeConversation(conversationId)
}

const handleSidebarHome = () => {
  navigateToHome()
}

const handleSidebarReorder = (payload: {
  conversationId: string
  fromIndex: number
  toIndex: number
}) => {
  sidebarStore.reorderConversations(payload.fromIndex, payload.toIndex)
}

// Removed GO_SETTINGS handler; now handled in main via tab logic

// Handle ESC key - close floating chat window
const handleEscKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    window.electron.ipcRenderer.send('close-floating-window')
  }
}

// Sidebar resize handlers
const startResize = (e: MouseEvent) => {
  isResizing.value = true
  e.preventDefault()
}

const handleMouseMove = (e: MouseEvent) => {
  if (!isResizing.value) return

  const newWidth = e.clientX
  if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
    sidebarWidth.value = newWidth
  }
}

const stopResize = () => {
  isResizing.value = false
}

getInitComplete()

onMounted(() => {
  // Set initial body class
  document.body.classList.add(themeStore.themeMode)
  document.body.classList.add(uiSettingsStore.fontSizeClass)

  window.addEventListener('keydown', handleEscKey)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', stopResize)

  // initialize store data
  initAppStores()
  setupMcpDeeplink()

  // Restore sidebar state for Single WebContents Architecture
  sidebarStore.restoreState()

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

  // GO_SETTINGS is now handled in main process (open/focus Settings tab)

  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.DATA_RESET_COMPLETE_DEV, () => {
    toast({
      title: t('settings.data.resetCompleteDevTitle'),
      description: t('settings.data.resetCompleteDevMessage'),
      variant: 'default',
      duration: 15000
    })
  })

  window.electron.ipcRenderer.on(THREAD_VIEW_EVENTS.TOGGLE, handleThreadViewToggle)

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
})

// Clear timers and event listeners before component unmounts
onBeforeUnmount(() => {
  if (errorDisplayTimer.value) {
    clearTimeout(errorDisplayTimer.value)
    errorDisplayTimer.value = null
  }

  window.removeEventListener('keydown', handleEscKey)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', stopResize)

  // Remove shortcut key event listeners
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.ZOOM_IN)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.ZOOM_OUT)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.ZOOM_RESUME)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION)
  // GO_SETTINGS listener removed; handled in main
  window.electron.ipcRenderer.removeAllListeners(NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED)
  window.electron.ipcRenderer.removeAllListeners(NOTIFICATION_EVENTS.DATA_RESET_COMPLETE_DEV)
  window.electron.ipcRenderer.removeListener(THREAD_VIEW_EVENTS.TOGGLE, handleThreadViewToggle)
  cleanupMcpDeeplink()
})
</script>

<template>
  <div
    class="flex flex-row h-screen"
    :class="[isMacOS ? 'bg-background/80' : 'bg-window-background/10']"
  >
    <!-- Left: Resizable IconSidebar -->
    <div class="relative h-full pt-8 border-r bg-black/10" :style="{ width: sidebarWidth + 'px' }">
      <IconSidebar
        :conversations="sidebarStore.sortedConversations"
        :active-conversation-id="(route.params.id as string) || undefined"
        @conversation-select="handleSidebarConversationSelect"
        @conversation-close="handleSidebarConversationClose"
        @conversation-reorder="handleSidebarReorder"
        @home="handleSidebarHome"
      />
      <!-- Resize handle -->
      <div
        class="absolute top-0 right-0 bottom-0 w-0.5 cursor-col-resize hover:bg-primary/20 transition-colors"
        :class="{ 'bg-primary/40': isResizing }"
        @mousedown="startResize"
      ></div>
    </div>

    <!-- Right: Main content with ChatAppBar on top -->
    <div class="flex flex-col flex-1 overflow-hidden bg-background" :dir="langStore.dir">
      <!-- App Bar for window controls -->
      <ChatAppBar />
      <div class="flex-1 overflow-hidden">
        <!-- Main content area -->
        <RouterView />
      </div>
    </div>

    <!-- Window border overlay -->
    <div
      class="border border-window-inner-border rounded-[10px] fixed z-10 top-0 left-0 bottom-0 right-0 pointer-events-none"
    ></div>

    <!-- Global update dialog -->
    <UpdateDialog />
    <!-- Global message dialog -->
    <MessageDialog />
    <McpSamplingDialog />
    <!-- Global Toast notifications -->
    <Toaster :theme="toasterTheme" />
    <SelectedTextContextMenu />
    <TranslatePopup />
    <ThreadView />
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
