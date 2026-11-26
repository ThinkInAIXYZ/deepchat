import { useRouter } from 'vue-router'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useProviderStore } from '@/stores/providerStore'
import { useMcpStore } from '@/stores/mcp'
import { useStartupWorkloadStore } from '@/stores/startupWorkloadStore'
import { createAppRuntimeClient } from '@api/AppRuntimeClient'

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

  const handleMcpInstall = async (data: { mcpConfig?: string }) => {
    const { mcpConfig } = data ?? {}
    if (!mcpConfig) return

    if (!mcpStore.mcpEnabled) {
      await mcpStore.setMcpEnabled(true)
    }

    await router.isReady()
    await router.push({ name: 'settings-mcp' })

    mcpStore.setMcpInstallCache(mcpConfig)
  }

  const setup = () => {
    cleanupIpcListeners?.()
    const appRuntimeClient = createAppRuntimeClient()
    cleanupIpcListeners = appRuntimeClient.onMcpInstallRequested((payload) => {
      void handleMcpInstall(payload)
    })
  }

  const cleanup = () => {
    cleanupIpcListeners?.()
    cleanupIpcListeners = null
  }

  return { setup, cleanup }
}
