<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount, computed, provide } from 'vue'
import { useEventListener } from '@vueuse/core'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { createConfigClient } from '@api/ConfigClient'
import { createNotificationClient } from '@api/NotificationClient'
import { createOnboardingClient } from '@api/OnboardingClient'
import SelectedTextContextMenu from '@/components/message/SelectedTextContextMenu.vue'
import { useArtifactStore } from '@/stores/artifact'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useDraftStore, type StartDeeplinkPayload } from '@/stores/ui/draft'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import NotificationHost from '@renderer-notifications/NotificationHost.vue'
import { rendererNotificationManager } from '@renderer-notifications/rendererNotificationRuntime'
import { SemanticNotificationController } from '@renderer-notifications/semanticNotificationController'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import TranslatePopup from '@/components/popup/TranslatePopup.vue'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { useModelCheckStore } from '@/stores/modelCheck'
import MessageDialog from '@/components/ui/MessageDialog.vue'
import McpSamplingDialog from '@/components/mcp/McpSamplingDialog.vue'
import McpElicitationDialog from '@/components/mcp/McpElicitationDialog.vue'
import McpAppConsentDialog from '@/components/mcp/McpAppConsentDialog.vue'
import CliApprovalDialog from '@/components/cli/CliApprovalDialog.vue'
import { initAppStores, useMcpInstallDeeplinkHandler } from '@/lib/storeInitializer'
import { ensureIconsLoaded } from '@/lib/iconLoader'
import { useFontManager } from '@/composables/useFontManager'
import { applyDocumentAppearance } from '@/foundation/appearance/documentAppearance'
import AppBar from '@/components/AppBar.vue'
import { useDeviceVersion } from '@/composables/useDeviceVersion'
import WindowSideBar from '@/components/WindowSideBar.vue'
import SpotlightOverlay from '@/components/spotlight/SpotlightOverlay.vue'
import { useSpotlightStore } from '@/stores/ui/spotlight'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSidebarStore } from '@/stores/ui/sidebar'
import { useAppIpcRuntime } from '@/composables/useAppIpcRuntime'
import {
  clearGuidedOnboardingResumeIntent,
  GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
  readGuidedOnboardingResumeIntent,
  type GuidedOnboardingResumeRequestDetail,
  type GuidedOnboardingResumeTrigger
} from '@/lib/onboardingResume'
import type { GuidedOnboardingStepId } from '@shared/contracts/routes'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import { createWindowClient } from '@api/WindowClient'
import {
  RENDERER_PERFORMANCE_REPORTER,
  RendererPerformanceReporter
} from '@/platform/performance/rendererPerformance'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'

const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

const performanceReporter = new RendererPerformanceReporter()
provide(RENDERER_PERFORMANCE_REPORTER, performanceReporter)

const route = useRoute()
const configClient = createConfigClient()
const notificationClient = createNotificationClient()
const onboardingClient = createOnboardingClient()
const windowClient = createWindowClient()
const artifactStore = useArtifactStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const draftStore = useDraftStore()
const pageRouterStore = usePageRouterStore()
const sidepanelStore = useSidepanelStore()
const sidebarStore = useSidebarStore()
const spotlightStore = useSpotlightStore()
const uiSettingsStore = useUiSettingsStore()
const { setupFontListener } = useFontManager()
setupFontListener()

const { isWinMacOS, isMacOS } = useDeviceVersion()

watch(
  isMacOS,
  (mac) => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.platform = mac ? 'darwin' : 'other'
  },
  { immediate: true }
)

const themeStore = useThemeStore()
const langStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()
const { t, locale } = useI18n()
const semanticNotificationController = new SemanticNotificationController({
  notifications: rendererNotificationManager,
  translate: (key, params) => t(key, params ?? {}),
  acknowledgePresentation: (episodeId) => notificationClient.acknowledgePresentation(episodeId),
  openSettings: async (navigation) => {
    await configClient.openSettings(navigation)
  }
})
let cleanupSemanticNotifications: (() => void) | undefined
const toasterTheme = computed(() =>
  themeStore.themeMode === 'system' ? (themeStore.isDark ? 'dark' : 'light') : themeStore.themeMode
)
const { setup: setupMcpDeeplink, cleanup: cleanupMcpDeeplink } = useMcpInstallDeeplinkHandler()

watch(
  [() => themeStore.themeMode, () => themeStore.isDark, () => uiSettingsStore.fontSizeClass],
  ([themeMode, isDark, fontSizeClass], previous) => {
    const theme = themeMode === 'system' ? (isDark ? 'dark' : 'light') : themeMode
    const previousTheme = previous
      ? previous[0] === 'system'
        ? previous[1]
          ? 'dark'
          : 'light'
        : previous[0]
      : null

    applyDocumentAppearance({
      theme,
      fontSizeClass,
      disableThemeTransition: previousTheme === null || previousTheme !== theme
    })
  },
  { immediate: true }
)

void langStore.initLanguage?.()

watch(
  [() => locale.value, () => langStore.dir],
  ([language, direction]) => {
    applyDocumentAppearance({ language, direction })
  },
  { immediate: true }
)

const router = useRouter()
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

    const initComplete = Boolean(await configClient.getSetting('init_complete'))
    let onboardingState: Awaited<ReturnType<typeof onboardingClient.getState>> | null = null

    try {
      onboardingState = await onboardingClient.getState()
    } catch (error) {
      console.warn('[App] Failed to load onboarding state during startup:', error)
    }

    if (onboardingState?.status === 'completed') {
      if (isWelcomeRoute) {
        await router.replace({ name: 'chat' })
      }
      return
    }

    if (!initComplete || onboardingState?.status === 'active') {
      if (!initComplete && onboardingState?.status !== 'active') {
        try {
          onboardingState = await onboardingClient.start()
        } catch (error) {
          console.warn('[App] Failed to start onboarding during startup:', error)
        }
      }

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

  const isCurrentPendingStartDeeplink = () => draftStore.pendingStartDeeplink?.token === token
  processingStartDeeplinkToken.value = token

  try {
    const initComplete = Boolean(await configClient.getSetting('init_complete'))
    if (!initComplete || !isCurrentPendingStartDeeplink()) {
      return
    }

    await router.isReady()
    if (!isCurrentPendingStartDeeplink()) {
      return
    }

    if (router.currentRoute.value.name !== 'chat') {
      await router.push({ name: 'chat' })
      if (!isCurrentPendingStartDeeplink()) {
        return
      }
    }

    agentStore.setSelectedAgent('deepchat')

    if (sessionStore.hasActiveSession) {
      await sessionStore.closeSession()
      if (!isCurrentPendingStartDeeplink()) {
        return
      }

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
    mentions: Array.isArray(payload.mentions) ? payload.mentions : []
  })
  void activatePendingStartDeeplink()
}

const handleStartGuidedOnboardingDev = async () => {
  if (!import.meta.env.DEV) {
    return
  }

  try {
    clearGuidedOnboardingResumeIntent()
    await onboardingClient.start({
      force: true,
      stepId: 'select-provider'
    })

    if (router.currentRoute.value.name !== 'welcome') {
      await router.replace({ name: 'welcome' })
    }
  } catch (error) {
    console.warn('[App] Failed to start guided onboarding from dev trigger:', error)
  }
}

const routeToGuidedOnboardingStep = async (stepId: GuidedOnboardingStepId | null) => {
  const target = resolveGuidedOnboardingStepTarget(stepId)

  if (target?.surface === 'plugins') {
    if (router.currentRoute.value.name !== target.routeName) {
      await router.replace({ name: target.routeName })
    }
    return
  }

  if (target?.surface === 'chat') {
    if (router.currentRoute.value.name !== 'chat') {
      await router.replace({ name: 'chat' })
    }

    pageRouterStore.goToNewThread({ refresh: true })
    return
  }

  if (router.currentRoute.value.name !== 'welcome') {
    await router.replace({ name: 'welcome' })
  }
}

const resumeGuidedOnboardingFromState = async () => {
  try {
    const onboardingState = await onboardingClient.getState()

    if (onboardingState.status !== 'active') {
      clearGuidedOnboardingResumeIntent()
      if (onboardingState.status === 'completed') {
        if (router.currentRoute.value.name !== 'chat') {
          await router.replace({ name: 'chat' })
        }

        pageRouterStore.goToNewThread({ refresh: true })
      }
      return
    }

    clearGuidedOnboardingResumeIntent()
    await routeToGuidedOnboardingStep(onboardingState.currentStepId)
  } catch (error) {
    console.warn('[App] Failed to resume guided onboarding:', error)
  }
}

const handleResumeGuidedOnboarding = async (trigger: GuidedOnboardingResumeTrigger) => {
  const resumeIntent = readGuidedOnboardingResumeIntent()
  if (!resumeIntent || resumeIntent.trigger !== trigger) {
    return
  }

  await resumeGuidedOnboardingFromState()
}

const handleGuidedOnboardingResumeRequested = (event: Event) => {
  const detail = (event as CustomEvent<GuidedOnboardingResumeRequestDetail>).detail
  if (!detail?.trigger) {
    return
  }

  void handleResumeGuidedOnboarding(detail.trigger)
}

const { setup: setupAppIpcRuntime, cleanup: cleanupAppIpcRuntime } = useAppIpcRuntime({
  handleStartDeeplink: (payload) => {
    handleStartDeeplink(undefined, payload as Omit<StartDeeplinkPayload, 'token'> | undefined)
  },
  handleStartGuidedOnboardingDev,
  handleResumeGuidedOnboarding: resumeGuidedOnboardingFromState,
  handleWindowFocused: () => handleResumeGuidedOnboarding('window-focus'),
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
    void windowClient.closeFloatingCurrent()
  }
}

// Same listeners as before; VueUse owns register/unregister with the component scope.
useEventListener(window, 'keydown', handleEscKey)
useEventListener(
  window,
  GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
  handleGuidedOnboardingResumeRequested as EventListener
)

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
  performanceReporter.recordStartup('shell-mounted')
  cleanupSemanticNotifications = notificationClient.onSemanticNotification((delivery) => {
    semanticNotificationController.handle(delivery)
  })
  void notificationClient
    .notifyRendererReady()
    .then((ready) => {
      if (!ready) {
        console.warn('[Notification] Main renderer was not accepted as a delivery target')
      }
    })
    .catch((error) => {
      console.error('[Notification] Failed to register main renderer', error)
    })

  // Ensure icons are loaded (load asynchronously, can happen in parallel with store init)
  void ensureIconsLoaded()

  // Start shell-critical data directly from the main window so it does not depend on settings.
  void initAppStores()
    .then(() => {
      performanceReporter.setEnabled(uiSettingsStore.loggingEnabled)
      performanceReporter.recordStartup('app-stores-ready')
    })
    .catch(() => {
      performanceReporter.setEnabled(uiSettingsStore.loggingEnabled)
      performanceReporter.recordStartup('app-stores-ready', { outcome: 'failed' })
    })
  setupMcpDeeplink()
  setupAppIpcRuntime()

  watch(
    () => uiSettingsStore.loggingEnabled,
    (enabled) => {
      performanceReporter.setEnabled(enabled)
    }
  )

  watch(
    () => route.fullPath,
    () => {
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

onBeforeUnmount(() => {
  cleanupAppIpcRuntime()
  cleanupMcpDeeplink()
  cleanupSemanticNotifications?.()
  cleanupSemanticNotifications = undefined
  semanticNotificationController.dispose()
  performanceReporter.dispose()
})
</script>

<template>
  <div
    data-testid="app-root"
    class="flex flex-col h-screen"
    :class="isWinMacOS ? 'bg-window-background' : 'bg-background'"
  >
    <TooltipProvider :delay-duration="200" :ignore-non-keyboard-focus="true">
      <AppBar />
      <div class="flex flex-row h-0 grow relative overflow-hidden px-px py-px" :dir="langStore.dir">
        <div class="flex flex-row w-full h-full">
          <WindowSideBar></WindowSideBar>

          <!-- Main content area -->
          <div
            data-testid="app-main"
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
      <McpElicitationDialog />
      <McpAppConsentDialog />
      <CliApprovalDialog />
      <NotificationHost surface="main" :theme="toasterTheme" :dir="langStore.dir" />
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
    </TooltipProvider>
  </div>
</template>
