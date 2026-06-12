import { useRouter } from 'vue-router'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useProviderStore } from '@/stores/providerStore'
import { useMcpStore } from '@/stores/mcp'
import { useStartupWorkloadStore } from '@/stores/startupWorkloadStore'
import { DEEPLINK_EVENTS } from '@/events'
import { createIpcSubscriptionScope } from '@/lib/ipcSubscription'

export const initAppStores = async () => {
  const uiSettingsStore = useUiSettingsStore()
  const providerStore = useProviderStore()
  let startupWorkloadStore: ReturnType<typeof useStartupWorkloadStore> | null = null

  try {
    startupWorkloadStore = useStartupWorkloadStore()
  } catch (error) {
    console.warn('[Startup][Renderer] startupWorkloadStore unavailable during initAppStores', error)
  }

  console.info('[Startup][Renderer] initAppStores begin')
  startupWorkloadStore?.connect()

  // Run both in parallel since they don't depend on each other
  await Promise.all([uiSettingsStore.loadSettings(), providerStore.initialize()])
  console.info('[Startup][Renderer] initAppStores critical stores ready')
}

export const useMcpInstallDeeplinkHandler = () => {
  const router = useRouter()
  const mcpStore = useMcpStore()
  let cleanupIpcListeners: (() => void) | null = null

  const navigateToMcpSettings = async () => {
    await router.isReady()

    const currentRoute = router.currentRoute.value
    const hasSettingsMcpRoute = router.hasRoute('settings-mcp')
    const hasSettingsRootRoute = router.hasRoute('settings')

    if (hasSettingsMcpRoute) {
      if (currentRoute.name !== 'settings-mcp') {
        await router.push({ name: 'settings-mcp' })
      } else {
        await router.replace({
          name: 'settings-mcp',
          query: { ...currentRoute.query }
        })
      }
      return
    }

    if (hasSettingsRootRoute) {
      if (currentRoute.name !== 'settings') {
        await router.push({ name: 'settings' })
      }
      if (router.hasRoute('settings-mcp')) {
        await router.push({ name: 'settings-mcp' })
      }
      return
    }

    const resolvedMcpRoute = router.resolve('/mcp')
    if (resolvedMcpRoute.matched.length) {
      await router.push(resolvedMcpRoute.fullPath)
    } else {
      console.warn('Received MCP install deeplink but MCP settings route is unavailable')
    }
  }

  const handleMcpInstall = async (_: unknown, data: Record<string, any>) => {
    const { mcpConfig } = data ?? {}
    if (!mcpConfig) return

    if (!mcpStore.mcpEnabled) {
      await mcpStore.setMcpEnabled(true)
    }

    await navigateToMcpSettings()

    mcpStore.setMcpInstallCache(mcpConfig)
  }

  const setup = () => {
    cleanupIpcListeners?.()
    const scope = createIpcSubscriptionScope()
    scope.on(DEEPLINK_EVENTS.MCP_INSTALL, handleMcpInstall)
    cleanupIpcListeners = scope.cleanup
  }

  const cleanup = () => {
    cleanupIpcListeners?.()
    cleanupIpcListeners = null
  }

  return { setup, cleanup }
}
