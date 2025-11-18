import { useRouter } from 'vue-router'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useSearchEngineStore } from '@/stores/searchEngineStore'
import { useSearchAssistantStore } from '@/stores/searchAssistantStore'
import { useMcpStore } from '@/stores/mcp'
import { DEEPLINK_EVENTS } from '@/events'

export const initAppStores = async () => {
  const uiSettingsStore = useUiSettingsStore()
  const providerStore = useProviderStore()
  const modelStore = useModelStore()
  const ollamaStore = useOllamaStore()
  const searchEngineStore = useSearchEngineStore()
  const searchAssistantStore = useSearchAssistantStore()

  await uiSettingsStore.loadSettings()

  await providerStore.initialize()
  await providerStore.refreshProviders()

  modelStore.setupModelListeners()
  await modelStore.refreshAllModels()

  await searchEngineStore.initialize()

  await ollamaStore.initialize()

  await searchAssistantStore.initOrUpdateSearchAssistantModel()
}

export const useMcpInstallDeeplinkHandler = () => {
  const router = useRouter()
  const mcpStore = useMcpStore()

  const handleMcpInstall = async (_: unknown, data: Record<string, any>) => {
    const { mcpConfig } = data ?? {}
    if (!mcpConfig) return

    if (!mcpStore.mcpEnabled) {
      await mcpStore.setMcpEnabled(true)
    }

    const currentRoute = router.currentRoute.value
    if (currentRoute.name !== 'settings') {
      await router.push({ name: 'settings' })
      await router.push({ name: 'settings-mcp' })
    } else {
      await router.replace({
        name: 'settings-mcp',
        query: { ...currentRoute.query }
      })
    }

    mcpStore.setMcpInstallCache(mcpConfig)
  }

  const setup = () => {
    window.electron.ipcRenderer.on(DEEPLINK_EVENTS.MCP_INSTALL, handleMcpInstall)
  }

  const cleanup = () => {
    window.electron.ipcRenderer.removeAllListeners(DEEPLINK_EVENTS.MCP_INSTALL)
  }

  return { setup, cleanup }
}
