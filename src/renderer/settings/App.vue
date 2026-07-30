<template>
  <TooltipProvider :delay-duration="200">
    <div
      data-testid="settings-page"
      class="w-full h-screen flex flex-col"
      :class="isWinMacOS ? '' : 'bg-background'"
    >
      <div
        class="w-full h-9 window-drag-region shrink-0 justify-end flex flex-row relative border border-b-0 border-window-inner-border box-border rounded-t-[10px]"
        :class="[
          isMacOS ? '' : 'rounded-t-none',
          isMacOS ? 'bg-window-background' : 'bg-window-background/10'
        ]"
      >
        <div class="absolute bottom-0 left-0 w-full h-[1px] bg-border z-10"></div>
        <Button
          v-if="!isMacOS"
          class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-red-700/80 hover:text-white text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="closeWindow"
        >
          <CloseIcon class="h-3! w-3!" />
        </Button>
      </div>
      <div class="w-full h-0 flex-1 flex flex-row bg-background relative">
        <div
          class="border-x border-b border-window-inner-border rounded-b-[10px] absolute z-10 top-0 left-0 bottom-0 right-0 pointer-events-none"
        ></div>
        <div
          data-testid="settings-navigation"
          class="w-60 h-full border-r border-border shrink-0 overflow-y-auto bg-muted/10"
        >
          <div class="flex flex-col gap-4 p-3">
            <div v-for="group in settingGroups" :key="group.key" class="flex flex-col gap-1">
              <div class="px-2 text-xs font-medium text-muted-foreground">
                {{ t(group.titleKey) }}
              </div>
              <div class="flex flex-col gap-1">
                <button
                  v-for="setting in group.items"
                  :key="setting.name"
                  type="button"
                  :data-testid="getSettingsTabTestId(setting.name)"
                  :class="[
                    'flex w-full min-w-0 flex-row items-center gap-2 rounded-md px-2 py-2 text-start transition-colors hover:bg-accent',
                    route.name === setting.name ? 'bg-accent text-accent-foreground' : '',
                    pendingRouteName === setting.name ? 'cursor-wait' : ''
                  ]"
                  :aria-busy="pendingRouteName === setting.name"
                  @pointerenter="prefetchSetting(setting.name)"
                  @focus="prefetchSetting(setting.name)"
                  @click="handleClick(setting)"
                >
                  <Spinner
                    v-if="pendingRouteName === setting.name"
                    class="size-4 shrink-0 text-muted-foreground"
                  />
                  <Icon v-else :icon="setting.icon" class="size-4 shrink-0 text-muted-foreground" />
                  <span class="min-w-0 truncate text-sm font-medium">{{ t(setting.title) }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <RouterView />
      </div>
      <ModelCheckDialog
        :open="modelCheckStore.isDialogOpen"
        :provider-id="modelCheckStore.currentProviderId"
        @update:open="
          (open) => {
            if (!open) modelCheckStore.closeDialog()
          }
        "
      />
      <ProviderDeeplinkImportDialog
        :key="pendingProviderImportToken"
        :open="Boolean(pendingProviderImportPreview)"
        :preview="pendingProviderImportPreview"
        :confirm-disabled="providerImportConfirmDisabled"
        :submitting="isImportingProvider"
        :error="providerImportError"
        @update:open="handleProviderImportDialogOpenChange"
        @confirm="confirmProviderImport"
      />
      <SettingsLeaveGuardDialog />
      <NotificationHost surface="settings" :theme="toasterTheme" :dir="languageStore.dir" />
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useRouter, useRoute, RouterView } from 'vue-router'
import { onMounted, onBeforeUnmount, Ref, ref, watch, computed, nextTick, unref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, useTitle } from '@vueuse/core'
import { createDeviceClient } from '@api/DeviceClient'
import { createNotificationClient } from '@api/NotificationClient'
import { createWindowClient } from '@api/WindowClient'
import { getRuntimeArch, getRuntimePlatform } from '@api/runtime'
import CloseIcon from './icons/CloseIcon.vue'
import { useUiSettingsStore } from '../src/stores/uiSettingsStore'
import { useLanguageStore } from '../src/stores/language'
import { useModelCheckStore } from '../src/stores/modelCheck'
import { Button } from '@shadcn/components/ui/button'
import ModelCheckDialog from '@/components/settings/ModelCheckDialog.vue'
import { useDeviceVersion } from '../src/composables/useDeviceVersion'
import NotificationHost from '@renderer-notifications/NotificationHost.vue'
import { rendererNotificationManager } from '@renderer-notifications/rendererNotificationRuntime'
import { SemanticNotificationController } from '@renderer-notifications/semanticNotificationController'
import { Spinner } from '@shadcn/components/ui/spinner'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import { useThemeStore } from '@/stores/theme'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useProviderDeeplinkImportStore } from '@/stores/providerDeeplinkImport'
import { useMcpInstallDeeplinkHandler } from '../src/lib/storeInitializer'
import { ensureIconsLoaded } from '../src/lib/iconLoader'
import { useFontManager } from '../src/composables/useFontManager'
import { applyDocumentAppearance } from '../src/foundation/appearance/documentAppearance'
import { markStartupInteractive } from '../src/lib/startupDeferred'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { ProviderInstallPreview } from '@shared/providerDeeplink'
import ProviderDeeplinkImportDialog from './components/ProviderDeeplinkImportDialog.vue'
import SettingsLeaveGuardDialog from './components/SettingsLeaveGuardDialog.vue'
import { settingsLeaveGuard } from './services/settingsLeaveGuard'
import { installSettingsRouteLeaveGuard } from './services/settingsRouteLeaveGuard'
import { nanoid } from 'nanoid'
import {
  getSettingsNavigationGroups,
  getSettingsRouteItems,
  resolveSettingsNavigationPath
} from '@shared/settingsNavigation'
import type { SettingsNavigationPayload } from '@shared/settingsNavigation'
import { useStartupWorkloadStore } from '@/stores/startupWorkloadStore'
import { preloadSettingsRoute } from './settingsRouteComponents'

const DATABASE_REPAIR_SECTION = 'database-repair'
const SETTINGS_SECTION_EVENT = 'deepchat:settings-section'
const SETTINGS_STARTUP_LOG_PREFIX = '[Startup][Settings][Renderer]'

type SettingsWindowState = Window & {
  __deepchatSettingsPendingSection?: string | null
}

const deviceClient = createDeviceClient()
const notificationClient = createNotificationClient()
const windowClient = createWindowClient()

// Initialize stores
const uiSettingsStore = useUiSettingsStore()
const { setupFontListener } = useFontManager()
setupFontListener()

const languageStore = useLanguageStore()
const modelCheckStore = useModelCheckStore()
const themeStore = useThemeStore()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const ollamaStore = useOllamaStore()
let startupWorkloadStore: ReturnType<typeof useStartupWorkloadStore> | null = null

try {
  startupWorkloadStore = useStartupWorkloadStore()
} catch (error) {
  console.warn('[Startup][Settings][Renderer] startupWorkloadStore unavailable', error)
}
const providerDeeplinkImportStore = useProviderDeeplinkImportStore()
const { setup: setupMcpDeeplink, cleanup: cleanupMcpDeeplink } = useMcpInstallDeeplinkHandler()
// Register MCP deeplink listener immediately to avoid race with incoming IPC
setupMcpDeeplink()

const isImportingProvider = ref(false)
const providerImportError = ref<string | null>(null)
const toasterTheme = computed(() =>
  themeStore.themeMode === 'system' ? (themeStore.isDark ? 'dark' : 'light') : themeStore.themeMode
)

// Detect platform to apply proper styling
const { isMacOS, isWinMacOS } = useDeviceVersion()
const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const removeSettingsRouteGuard = installSettingsRouteLeaveGuard(router, settingsLeaveGuard)
const title = useTitle()
const pendingProviderImportPreview = computed(() => providerDeeplinkImportStore.preview)
const pendingProviderImportToken = computed(() => providerDeeplinkImportStore.previewToken)
const isProcessingProviderPreview = ref(false)
const startupTimeOrigin = typeof performance !== 'undefined' ? performance.now() : Date.now()
const hasLoggedFirstRouteResolved = ref(false)
const pendingRouteName = ref<string | null>(null)

const logSettingsStartup = (phase: string) => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const elapsed = Math.round(now - startupTimeOrigin)
  console.info(`${SETTINGS_STARTUP_LOG_PREFIX} ${phase} elapsed=${elapsed}ms`)
}

const isProviderStoreInitialized = () => Boolean(unref(providerStore.initialized))

const providerImportConfirmDisabled = computed(() => {
  const preview = pendingProviderImportPreview.value
  if (!preview) {
    return true
  }

  if (preview.kind === 'builtin') {
    return !providerStore.providers.some((provider) => provider.id === preview.id)
  }

  return false
})

const navigateToProviderSettings = async (providerId?: string) => {
  await router.push({
    name: 'settings-provider',
    params: providerId ? { providerId } : undefined
  })
}

const normalizeRouteParams = (params?: Record<string, string>) =>
  Object.entries(params ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})

const hasSameRouteParams = (
  currentParams: Record<string, unknown>,
  nextParams: Record<string, string>
): boolean => {
  const currentEntries = Object.entries(currentParams).filter(
    ([, value]) => typeof value === 'string'
  )
  const nextEntries = Object.entries(nextParams)

  if (currentEntries.length !== nextEntries.length) {
    return false
  }

  return nextEntries.every(([key, value]) => currentParams[key] === value)
}

const publishSettingsSection = async (section?: string) => {
  if (!section) {
    return
  }

  ;(window as SettingsWindowState).__deepchatSettingsPendingSection = section
  await nextTick()
  window.dispatchEvent(
    new CustomEvent(SETTINGS_SECTION_EVENT, {
      detail: { section }
    })
  )
}

const openDatabaseRepairSection = async () => {
  await router.push({
    name: 'settings-database'
  })
  await publishSettingsSection(DATABASE_REPAIR_SECTION)
}

const semanticNotificationController = new SemanticNotificationController({
  notifications: rendererNotificationManager,
  translate: (key, params) => t(key, params ?? {}),
  acknowledgePresentation: (episodeId) => notificationClient.acknowledgePresentation(episodeId),
  openSettings: () => openDatabaseRepairSection()
})
let cleanupSemanticNotifications: (() => void) | undefined

const handleSettingsNavigate = async (payload?: SettingsNavigationPayload) => {
  const routeName = payload?.routeName
  const params = normalizeRouteParams(payload?.params)
  if (!routeName || !router.hasRoute(routeName)) return
  await router.isReady()
  if (
    router.currentRoute.value.name !== routeName ||
    !hasSameRouteParams(router.currentRoute.value.params, params)
  ) {
    await router.push({
      name: routeName,
      params: Object.keys(params).length > 0 ? params : undefined
    })
  }
  if (routeName === 'settings-provider') {
    await syncPendingProviderInstall()
  }

  await publishSettingsSection(payload?.section)
}

let providerStoreInitializePromise: Promise<void> | null = null

const ensureProviderStoreReady = async () => {
  if (isProviderStoreInitialized()) {
    return
  }

  if (!providerStoreInitializePromise) {
    providerStoreInitializePromise = Promise.resolve(
      providerStore.ensureInitialized?.() ?? providerStore.initialize?.()
    )
      .then(() => {
        logSettingsStartup('providerStore ready')
      })
      .catch((error) => {
        providerStoreInitializePromise = null
        throw error
      })
  }

  await providerStoreInitializePromise
}

const ensureProviderRouteReady = async (providerId?: string) => {
  await ensureProviderStoreReady()
  if (!providerId) {
    return
  }

  const provider = providerStore.providers.find((item) => item.id === providerId)
  if (!provider) {
    return
  }

  await modelStore.ensureProviderModelsReady(providerId)

  if (provider.apiType === 'ollama') {
    await ollamaStore.ensureProviderReady?.(providerId)
  }
}

const applyProviderInstallPreview = async (preview: ProviderInstallPreview) => {
  console.log(
    'Applying provider install preview in settings renderer:',
    preview.kind === 'builtin' ? preview.id : preview.name
  )

  await ensureProviderStoreReady()
  await router.isReady()

  if (preview.kind === 'builtin') {
    await navigateToProviderSettings(preview.id)
  } else if (router.currentRoute.value.name !== 'settings-provider') {
    await navigateToProviderSettings()
  }

  await nextTick()
  providerImportError.value = null
  providerDeeplinkImportStore.openPreview(preview)
}

const releaseProviderPreviewProcessing = () => {
  isProcessingProviderPreview.value = false
  if (!pendingProviderImportPreview.value) {
    void syncPendingProviderInstall()
  }
}

const syncPendingProviderInstall = async () => {
  if (isProcessingProviderPreview.value || pendingProviderImportPreview.value) {
    return
  }

  isProcessingProviderPreview.value = true
  let preview: ProviderInstallPreview | null = null

  try {
    preview = await windowClient.consumePendingSettingsProviderInstall()
    if (!preview) {
      return
    }

    await applyProviderInstallPreview(preview)
  } catch (error) {
    if (preview) {
      try {
        windowClient.requeuePendingSettingsProviderInstall(preview)
      } catch (requeueError) {
        console.error('[SettingsApp] Failed to requeue provider install preview', requeueError)
      }
    }

    console.error('[SettingsApp] Failed to sync provider install preview', error)
  } finally {
    isProcessingProviderPreview.value = false
  }
}

const handleProviderInstall = async () => {
  await syncPendingProviderInstall()
}

const handleProviderImportDialogOpenChange = (open: boolean) => {
  if (!open) {
    providerImportError.value = null
    providerDeeplinkImportStore.clearPreview()
    releaseProviderPreviewProcessing()
  }
}

const notifyProviderImportWarning = (code: string, title: string, description?: string) => {
  try {
    rendererNotificationManager.notify({
      kind: 'warning',
      code,
      title,
      description
    })
  } catch (error) {
    console.error('[SettingsApp] Failed to present provider import warning', error)
  }
}

const refreshImportedProviderModels = async (providerId: string) => {
  try {
    await modelStore.refreshProviderModels(providerId)
  } catch (error) {
    console.error('[SettingsApp] Imported provider model refresh failed', error)
    notifyProviderImportWarning(
      'settings.provider.importModelRefreshFailed',
      t('settings.provider.toast.refreshModelsFailedTitle'),
      t('settings.provider.toast.refreshModelsFailedDescription')
    )
  }
}

const navigateAfterProviderImport = async (providerId: string) => {
  try {
    await navigateToProviderSettings(providerId)
  } catch (error) {
    console.error('[SettingsApp] Imported provider navigation failed', error)
    notifyProviderImportWarning(
      'settings.provider.importNavigationFailed',
      t('common.error.operationFailed')
    )
  }
}

const confirmProviderImport = async () => {
  const preview = pendingProviderImportPreview.value
  if (!preview || isImportingProvider.value) {
    return
  }

  isImportingProvider.value = true
  providerImportError.value = null

  try {
    let importedProviderId: string
    if (preview.kind === 'builtin') {
      const targetProvider = providerStore.providers.find((provider) => provider.id === preview.id)
      if (!targetProvider) {
        providerImportError.value = t('common.error.operationFailed')
        return
      }

      await providerStore.updateProviderApi(preview.id, preview.apiKey, preview.baseUrl)
      if (!targetProvider.enable) {
        await providerStore.updateProviderStatus(preview.id, true)
      }

      importedProviderId = preview.id
    } else {
      const providerId = nanoid()
      const newProvider: LLM_PROVIDER = {
        id: providerId,
        name: preview.name,
        apiType: preview.type,
        apiKey: preview.apiKey,
        baseUrl: preview.baseUrl,
        enable: true,
        custom: true
      }

      await providerStore.addCustomProvider(newProvider)
      importedProviderId = providerId
    }

    await navigateAfterProviderImport(importedProviderId)
    providerImportError.value = null
    providerDeeplinkImportStore.clearPreview()
    releaseProviderPreviewProcessing()
    void refreshImportedProviderModels(importedProviderId)
  } catch (error) {
    console.error('[SettingsApp] Provider import failed', error)
    providerImportError.value = t('common.error.operationFailed')
  } finally {
    isImportingProvider.value = false
  }
}

const cleanupSettingsNavigate = windowClient.onSettingsNavigate(handleSettingsNavigate)
const cleanupSettingsProviderInstall = windowClient.onSettingsProviderInstall(() => {
  void handleProviderInstall()
})

const notifySettingsReady = () => {
  void windowClient.notifySettingsReady()
}
const runtimePlatform = getRuntimePlatform()
const runtimeArch = getRuntimeArch()
const settings: Ref<
  {
    title: string
    name: string
    icon: string
    path: string
  }[]
> = ref(
  getSettingsRouteItems(runtimePlatform, runtimeArch, import.meta.env.DEV).map((item) => ({
    title: item.titleKey,
    name: item.routeName,
    icon: item.icon,
    path: resolveSettingsNavigationPath(
      item.routeName,
      undefined,
      runtimePlatform,
      runtimeArch,
      import.meta.env.DEV
    )
  }))
)

const settingGroups = ref(
  getSettingsNavigationGroups(runtimePlatform, runtimeArch, import.meta.env.DEV).map((group) => ({
    key: group.key,
    titleKey: group.titleKey,
    items: group.items.map((item) => ({
      title: item.titleKey,
      name: item.routeName,
      icon: item.icon,
      path: resolveSettingsNavigationPath(
        item.routeName,
        undefined,
        runtimePlatform,
        runtimeArch,
        import.meta.env.DEV
      )
    }))
  }))
)

onMounted(() => {
  // Ensure icons are loaded
  void ensureIconsLoaded()
  logSettingsStartup('app mounted')
})

// Update title function
const updateTitle = () => {
  const currentRoute = route.name as string
  const currentSetting = settings.value.find((s) => s.name === currentRoute)
  if (currentSetting) {
    title.value = t('routes.settings') + ' - ' + t(currentSetting.title)
  } else {
    title.value = t('routes.settings')
  }
}

// Watch route changes
watch(
  () => [route.name, route.params.providerId],
  async ([routeName, providerId]) => {
    updateTitle()
    if (!hasLoggedFirstRouteResolved.value && routeName) {
      hasLoggedFirstRouteResolved.value = true
      logSettingsStartup(`first route resolved route=${String(routeName)}`)
    }

    if (routeName === 'settings-provider') {
      await ensureProviderRouteReady(typeof providerId === 'string' ? providerId : undefined)
    }
  },
  { immediate: true }
)

type SettingsNavigationItem = {
  name: string
  path: string
}

const handleClick = async (setting: SettingsNavigationItem) => {
  if (pendingRouteName.value || route.path === setting.path) return

  pendingRouteName.value = setting.name
  try {
    await router.push(setting.path)
  } catch (error) {
    console.error(`[Settings] Failed to navigate to ${setting.name}:`, error)
  } finally {
    if (pendingRouteName.value === setting.name) {
      pendingRouteName.value = null
    }
  }
}

const prefetchSetting = (routeName: string) => {
  const preload = preloadSettingsRoute(routeName)
  if (preload) {
    void preload.catch((error) => {
      console.debug(`[Settings] Failed to prefetch ${routeName}:`, error)
    })
  }
}

const SETTINGS_TAB_TEST_IDS: Record<string, string> = {
  'settings-overview': 'settings-tab-overview',
  'settings-common': 'settings-tab-general',
  'settings-display': 'settings-tab-appearance',
  'settings-provider': 'settings-tab-model-providers',
  'settings-mcp': 'settings-tab-mcp',
  'settings-acp': 'settings-tab-acp-agents',
  'settings-memory': 'settings-tab-memory'
}

const getSettingsTabTestId = (name: string) =>
  SETTINGS_TAB_TEST_IDS[name] ?? `settings-tab-${name.replace(/^settings-/, '')}`

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

// The language store owns the sole initial IPC snapshot and its change listener.
// Settings only projects that resolved state onto this window's document.
void languageStore.initLanguage?.()

watch(
  [() => locale.value, () => languageStore.dir],
  ([language, direction]) => {
    applyDocumentAppearance({ language, direction })
  },
  { immediate: true }
)

const handleWindowFocus = () => {
  void syncPendingProviderInstall()
}

onMounted(async () => {
  startupWorkloadStore?.connect()
  cleanupSemanticNotifications = notificationClient.onSemanticNotification((delivery) => {
    semanticNotificationController.handle(delivery)
  })
  void notificationClient
    .notifyRendererReady()
    .then((ready) => {
      if (!ready) {
        console.warn('[Notification] Settings renderer was not accepted as a delivery target')
      }
    })
    .catch((error) => {
      console.error('[Notification] Failed to register settings renderer', error)
    })

  // Listen for window maximize/unmaximize events
  deviceClient.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })

  const [settingsLoadResult, routerReadyResult] = await Promise.allSettled([
    uiSettingsStore.loadSettings(),
    router.isReady()
  ])

  if (settingsLoadResult.status === 'rejected') {
    console.error(
      `${SETTINGS_STARTUP_LOG_PREFIX} failed to load UI settings during startup:`,
      settingsLoadResult.reason
    )
  }

  if (routerReadyResult.status === 'rejected') {
    console.error(
      `${SETTINGS_STARTUP_LOG_PREFIX} router ready failed during startup:`,
      routerReadyResult.reason
    )
  }

  try {
    await providerStore.initialize()
    logSettingsStartup('provider summaries ready')
  } catch (error) {
    console.error(`${SETTINGS_STARTUP_LOG_PREFIX} provider summaries failed:`, error)
  }

  try {
    await modelStore.initialize()
    logSettingsStartup('enabled models ready')
  } catch (error) {
    console.error(`${SETTINGS_STARTUP_LOG_PREFIX} enabled models failed:`, error)
  }

  markStartupInteractive()
  await syncPendingProviderInstall()
  notifySettingsReady()
  logSettingsStartup('settings window ready IPC sent')
})

// Same focus handler as before; VueUse manages lifecycle cleanup.
useEventListener(window, 'focus', handleWindowFocus)

const performWindowClose = async () => {
  try {
    await windowClient.closeSettings()
  } catch (error) {
    console.error('[Settings] Failed to close settings window:', error)
  }
}

const closeWindow = async () => {
  if (await settingsLeaveGuard.requestLeave()) {
    await performWindowClose()
  }
}

let nativeCloseRetryPending = false
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!settingsLeaveGuard.isBlocking()) return

  event.preventDefault()
  event.returnValue = false
  if (nativeCloseRetryPending) return

  nativeCloseRetryPending = true
  void settingsLeaveGuard
    .requestLeave()
    .then((allowed) => {
      if (allowed) void performWindowClose()
    })
    .finally(() => {
      nativeCloseRetryPending = false
    })
}
useEventListener(window, 'beforeunload', handleBeforeUnload)

onBeforeUnmount(() => {
  cleanupSettingsNavigate()
  cleanupSettingsProviderInstall()
  removeSettingsRouteGuard()
  cleanupMcpDeeplink()
  cleanupSemanticNotifications?.()
  cleanupSemanticNotifications = undefined
  semanticNotificationController.dispose()
})
</script>

<style>
html,
body {
  background-color: transparent;
}
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}
</style>
