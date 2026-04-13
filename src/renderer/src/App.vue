<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount, computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { usePresenter } from './composables/usePresenter'
import SelectedTextContextMenu from './components/message/SelectedTextContextMenu.vue'
import { useArtifactStore } from './stores/artifact'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useDraftStore, type StartDeeplinkPayload } from '@/stores/ui/draft'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { Toaster } from '@shadcn/components/ui/sonner'
import { useToast } from '@/components/use-toast'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import TranslatePopup from '@/components/popup/TranslatePopup.vue'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { useModelCheckStore } from '@/stores/modelCheck'
import MessageDialog from './components/ui/MessageDialog.vue'
import McpSamplingDialog from '@/components/mcp/McpSamplingDialog.vue'
import { initAppStores, useMcpInstallDeeplinkHandler } from '@/lib/storeInitializer'
import 'vue-sonner/style.css' // vue-sonner v2 requires this import
import { useFontManager } from './composables/useFontManager'
import AppBar from '@/components/AppBar.vue'
import { useDeviceVersion } from '@/composables/useDeviceVersion'
import WindowSideBar from './components/WindowSideBar.vue'
import SpotlightOverlay from '@/components/spotlight/SpotlightOverlay.vue'
import { useSpotlightStore } from '@/stores/ui/spotlight'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSidebarStore } from '@/stores/ui/sidebar'
import { useAppIpcRuntime } from '@/composables/useAppIpcRuntime'

const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

const route = useRoute()
const configPresenter = usePresenter('configPresenter')
const artifactStore = useArtifactStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const draftStore = useDraftStore()
const pageRouterStore = usePageRouterStore()
const sidepanelStore = useSidepanelStore()
const sidebarStore = useSidebarStore()
const spotlightStore = useSpotlightStore()
const { toast } = useToast()
const uiSettingsStore = useUiSettingsStore()
const { setupFontListener } = useFontManager()
setupFontListener()

const { isWinMacOS } = useDeviceVersion()

const themeStore = useThemeStore()
const langStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()
const { t } = useI18n()
const toasterTheme = computed(() =>
  themeStore.themeMode === 'system' ? (themeStore.isDark ? 'dark' : 'light') : themeStore.themeMode
)
// Error notification queue and currently displayed error
const errorQueue = ref<Array<{ id: string; title: string; message: string; type: string }>>([])
const currentErrorId = ref<string | null>(null)
const errorDisplayTimer = ref<number | null>(null)

const { setup: setupMcpDeeplink, cleanup: cleanupMcpDeeplink } = useMcpInstallDeeplinkHandler()

const resolveThemeName = (themeMode: ThemeMode, isDark: boolean) => {
  return themeMode === 'system' ? (isDark ? 'dark' : 'light') : themeMode
}

const syncAppearanceClasses = (themeName: string, fontSizeClass: string) => {
  if (typeof document === 'undefined') {
    return
  }

  for (const target of [document.documentElement, document.body]) {
    target.classList.remove('light', 'dark', 'system')
    target.classList.add(themeName)
    target.classList.remove('text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl')
    target.classList.add(fontSizeClass)
  }
}

watch(
  [() => themeStore.themeMode, () => themeStore.isDark, () => uiSettingsStore.fontSizeClass],
  ([themeMode, isDark, fontSizeClass]) => {
    const nextThemeName = resolveThemeName(themeMode, isDark)
    syncAppearanceClasses(nextThemeName, fontSizeClass)
    console.log('newTheme', nextThemeName)
  },
  { immediate: true }
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
const isStartupRouteReady = ref(false)
const processingStartDeeplinkToken = ref<number | null>(null)
const processedStartDeeplinkToken = ref<number | null>(null)

const isDevWelcomeOverrideEnabled = () => {
  if (!import.meta.env.DEV) return false

  try {
    return window.sessionStorage.getItem(DEV_WELCOME_OVERRIDE_KEY) === '1'
  } catch {
    return false
  }
}

const ensureStartupWelcomeState = async () => {
  try {
    await router.isReady()

    const currentRoute = router.currentRoute.value
    const isWelcomeRoute = currentRoute.name === 'welcome' || currentRoute.path === '/welcome'

    if (isDevWelcomeOverrideEnabled()) {
      if (!isWelcomeRoute) {
        await router.replace({ name: 'welcome' })
      }
      return
    }

    const initComplete = Boolean(await configPresenter.getSetting('init_complete'))
    if (!initComplete) {
      if (!isWelcomeRoute) {
        await router.replace({ name: 'welcome' })
      }
      return
    }

    if (isWelcomeRoute) {
      await router.replace({ name: 'chat' })
    }
  } finally {
    isStartupRouteReady.value = true
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
const handleCreateNewConversation = async () => {
  try {
    await sessionStore.startNewConversation({ refresh: true })
  } catch (error) {
    console.error('Failed to create new conversation:', error)
  }
}

// Removed GO_SETTINGS handler; now handled in main via tab logic

const activatePendingStartDeeplink = async () => {
  const pendingStartDeeplink = draftStore.pendingStartDeeplink
  if (!pendingStartDeeplink || !isStartupRouteReady.value) {
    return
  }

  const token = pendingStartDeeplink.token
  if (processingStartDeeplinkToken.value === token || processedStartDeeplinkToken.value === token) {
    return
  }

  processingStartDeeplinkToken.value = token

  try {
    const initComplete = Boolean(await configPresenter.getSetting('init_complete'))
    if (!initComplete) {
      return
    }

    await router.isReady()
    if (router.currentRoute.value.name !== 'chat') {
      await router.push({ name: 'chat' })
    }

    agentStore.setSelectedAgent('deepchat')
    if (sessionStore.hasActiveSession) {
      await sessionStore.closeSession()
      processedStartDeeplinkToken.value = token
      return
    }

    pageRouterStore.goToNewThread({ refresh: true })
    processedStartDeeplinkToken.value = token
  } finally {
    if (processingStartDeeplinkToken.value === token) {
      processingStartDeeplinkToken.value = null
    }
  }
}

const handleStartDeeplink = (_event: unknown, payload?: Omit<StartDeeplinkPayload, 'token'>) => {
  if (!payload?.msg) {
    return
  }

  draftStore.setPendingStartDeeplink({
    msg: payload.msg,
    modelId: payload.modelId ?? null,
    systemPrompt: payload.systemPrompt ?? '',
    mentions: Array.isArray(payload.mentions) ? payload.mentions : [],
    autoSend: Boolean(payload.autoSend)
  })
  void activatePendingStartDeeplink()
}

const { setup: setupAppIpcRuntime, cleanup: cleanupAppIpcRuntime } = useAppIpcRuntime({
  handleStartDeeplink: (event, payload) => {
    handleStartDeeplink(event, payload as Omit<StartDeeplinkPayload, 'token'> | undefined)
  },
  showErrorToast,
  handleZoomIn,
  handleZoomOut,
  handleZoomResume,
  handleCreateNewConversation,
  handleToggleSidebar: () => {
    sidebarStore.toggleSidebar()
  },
  handleToggleWorkspace: () => {
    if (pageRouterStore.currentRoute !== 'chat' || !pageRouterStore.chatSessionId) {
      return
    }

    sidepanelStore.toggleWorkspace(pageRouterStore.chatSessionId)
  },
  openSpotlight: () => {
    spotlightStore.openSpotlight()
  },
  handleDataResetComplete: () => {
    toast({
      title: t('settings.data.resetCompleteDevTitle'),
      description: t('settings.data.resetCompleteDevMessage'),
      variant: 'default',
      duration: 15000
    })
  },
  handleSystemNotificationClick: (msg) => {
    let sessionId: string | null = null

    if (typeof msg === 'string' && msg.startsWith('chat/')) {
      const parts = msg.split('/')
      if (parts.length === 3) {
        sessionId = parts[1]
      }
    } else if (msg && typeof msg === 'object' && 'threadId' in msg) {
      sessionId = (msg as { threadId?: string }).threadId ?? null
    }

    if (sessionId) {
      void sessionStore.selectSession(sessionId)
    }
  },
  getCurrentRouteName: () => router.currentRoute.value.name
})

// Handle ESC key - close floating chat window
const handleEscKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    window.electron.ipcRenderer.send('close-floating-window')
  }
}

void ensureStartupWelcomeState()

watch(
  () =>
    [isStartupRouteReady.value, route.name, draftStore.pendingStartDeeplink?.token ?? 0] as const,
  () => {
    void activatePendingStartDeeplink()
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', handleEscKey)

  // initialize store data
  void initAppStores()
  setupMcpDeeplink()
  setupAppIpcRuntime()

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
    () => sessionStore.activeSessionId,
    () => {
      // Close artifacts page when switching conversations
      artifactStore.hideArtifact()
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
  cleanupAppIpcRuntime()
  cleanupMcpDeeplink()
})
</script>

<template>
  <div
    class="flex flex-col h-screen"
    :class="isWinMacOS ? 'bg-window-background' : 'bg-background'"
  >
    <AppBar />
    <div class="flex flex-row h-0 grow relative overflow-hidden px-px py-px" :dir="langStore.dir">
      <div class="flex flex-row w-full h-full">
        <WindowSideBar></WindowSideBar>

        <!-- Main content area -->
        <div
          class="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden rounded-tl-xl border-l border-t border-black/20 bg-background dark:border-white/10"
        >
          <div class="min-h-0 flex-1">
            <RouterView v-if="isStartupRouteReady" />
          </div>
        </div>
      </div>
    </div>
    <!-- Global message dialog -->
    <MessageDialog />
    <McpSamplingDialog />
    <!-- Global Toast notifications -->
    <Toaster :theme="toasterTheme" />
    <SelectedTextContextMenu />
    <TranslatePopup />
    <SpotlightOverlay />
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
