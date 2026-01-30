import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { CONFIG_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER, VERTEX_PROVIDER } from '@shared/presenter'

type VoiceAIConfig = {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
  agentId: string
}

const PROVIDER_ORDER_KEY = 'providerOrder'
const PROVIDER_TIMESTAMP_KEY = 'providerTimestamps'

export const useProviderStore = defineStore('provider', () => {
  const configP = usePresenter('configPresenter')
  const llmP = usePresenter('llmproviderPresenter')

  const providersQuery = useIpcQuery({
    presenter: 'configPresenter',
    method: 'getProviders',
    key: () => ['providers'],
    staleTime: 30_000
  })

  const defaultProvidersQuery = useIpcQuery({
    presenter: 'configPresenter',
    method: 'getDefaultProviders',
    key: () => ['providers', 'defaults'],
    staleTime: 60_000,
    gcTime: 300_000
  })

  const providerOrder = ref<string[]>([])
  const providerTimestamps = ref<Record<string, number>>({})
  const listenersRegistered = ref(false)
  const voiceAIConfig = ref<VoiceAIConfig | null>(null)

  const providers = computed<LLM_PROVIDER[]>(() => {
    const data = providersQuery.data.value as LLM_PROVIDER[] | undefined
    return data ?? []
  })
  const defaultProviders = computed<LLM_PROVIDER[]>(() => {
    const data = defaultProvidersQuery.data.value as LLM_PROVIDER[] | undefined
    return data ?? []
  })
  const enabledProviders = computed(() => providers.value.filter((provider) => provider.enable))
  const disabledProviders = computed(() => providers.value.filter((provider) => !provider.enable))

  const ensureOrderIncludesProviders = (order: string[], list: LLM_PROVIDER[]) => {
    const seen = new Set<string>()
    // Keep existing order (including ids that may be temporarily missing from the current list)
    const cleanedOrder: string[] = []
    order.forEach((id) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      cleanedOrder.push(id)
    })

    // Append any providers that are not yet in the order
    list.forEach((provider) => {
      if (!seen.has(provider.id)) {
        seen.add(provider.id)
        cleanedOrder.push(provider.id)
      }
    })

    return cleanedOrder
  }

  const sortProviders = (providerList: LLM_PROVIDER[], useAscendingTime: boolean) => {
    return [...providerList].sort((a, b) => {
      const aOrderIndex = providerOrder.value.indexOf(a.id)
      const bOrderIndex = providerOrder.value.indexOf(b.id)
      if (aOrderIndex !== -1 && bOrderIndex !== -1) {
        return aOrderIndex - bOrderIndex
      }
      if (aOrderIndex !== -1) {
        return -1
      }
      if (bOrderIndex !== -1) {
        return 1
      }
      const aTime = providerTimestamps.value[a.id] || 0
      const bTime = providerTimestamps.value[b.id] || 0
      return useAscendingTime ? aTime - bTime : bTime - aTime
    })
  }

  const sortedProviders = computed(() => {
    const sortedEnabled = sortProviders(enabledProviders.value, true)
    const sortedDisabled = sortProviders(disabledProviders.value, false)
    return [...sortedEnabled, ...sortedDisabled]
  })

  const loadProviderOrder = async () => {
    try {
      const savedOrder = await configP.getSetting<string[]>(PROVIDER_ORDER_KEY)
      // Only use ensureOrderIncludesProviders if we have a valid savedOrder or if providerOrder is empty
      if (savedOrder && savedOrder.length > 0) {
        // If we have a saved order, valid or not, we trust it as the base and append missing ones
        // This prevents resetting to default list order when provider list is temporarily incomplete
        providerOrder.value = ensureOrderIncludesProviders(savedOrder, providers.value)
      } else if (providerOrder.value.length === 0 && providers.value.length > 0) {
        // Only if we have no saved order AND no current order, we initialize from current list
        providerOrder.value = providers.value.map((provider) => provider.id)
      }
    } catch (error) {
      console.error('Failed to load provider order:', error)
      if (providerOrder.value.length === 0) {
        providerOrder.value = providers.value.map((provider) => provider.id)
      }
    }
  }

  const saveProviderOrder = async () => {
    try {
      if (providerOrder.value.length > 0) {
        await configP.setSetting(PROVIDER_ORDER_KEY, providerOrder.value)
      }
    } catch (error) {
      console.error('Failed to save provider order:', error)
    }
  }

  const loadProviderTimestamps = async () => {
    try {
      const savedTimestamps =
        await configP.getSetting<Record<string, number>>(PROVIDER_TIMESTAMP_KEY)
      providerTimestamps.value = savedTimestamps ?? {}
    } catch (error) {
      console.error('Failed to load provider timestamps:', error)
      providerTimestamps.value = {}
    }
  }

  const saveProviderTimestamps = async () => {
    try {
      await configP.setSetting(PROVIDER_TIMESTAMP_KEY, providerTimestamps.value)
    } catch (error) {
      console.error('Failed to save provider timestamps:', error)
    }
  }

  const refreshProviders = async () => {
    // Load order first to ensure we have the latest saved order before processing provider list updates
    await loadProviderOrder()
    await providersQuery.refetch()
    await defaultProvidersQuery.refetch()
  }

  const setupProviderListeners = () => {
    if (listenersRegistered.value) return
    listenersRegistered.value = true

    window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_CHANGED, async () => {
      await refreshProviders()
    })

    window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, async () => {
      await refreshProviders()
    })

    window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE, async () => {
      await refreshProviders()
    })

    window.electron.ipcRenderer.on(PROVIDER_DB_EVENTS.UPDATED, async () => {
      await refreshProviders()
    })

    window.electron.ipcRenderer.on(PROVIDER_DB_EVENTS.LOADED, async () => {
      await refreshProviders()
    })
  }

  const updateProvider = async (id: string, provider: LLM_PROVIDER) => {
    const current = providers.value.find((item) => item.id === id)
    const previousEnable = current?.enable
    const next = { ...provider }
    delete (next as any).websites
    await configP.setProviderById(id, next)
    await refreshProviders()
    return { previousEnable, next }
  }

  const updateProviderConfig = async (providerId: string, updates: Partial<LLM_PROVIDER>) => {
    const currentProvider = providers.value.find((p) => p.id === providerId)
    if (!currentProvider) {
      throw new Error(`Provider ${providerId} not found`)
    }

    const requiresRebuild = await configP.updateProviderAtomic(providerId, updates)
    await refreshProviders()
    return { requiresRebuild, updated: { ...currentProvider, ...updates } }
  }

  const updateProviderApi = async (providerId: string, apiKey?: string, baseUrl?: string) => {
    const updates: Partial<LLM_PROVIDER> = {}
    if (apiKey !== undefined) updates.apiKey = apiKey
    if (baseUrl !== undefined) updates.baseUrl = baseUrl
    return updateProviderConfig(providerId, updates)
  }

  const updateProviderAuth = async (
    providerId: string,
    authMode?: 'apikey' | 'oauth',
    oauthToken?: string
  ) => {
    const updates: Partial<LLM_PROVIDER> = {}
    if (authMode !== undefined) updates.authMode = authMode
    if (oauthToken !== undefined) updates.oauthToken = oauthToken
    return updateProviderConfig(providerId, updates)
  }

  const updateProvidersOrder = async (newProviders: LLM_PROVIDER[]) => {
    try {
      const enabledList = newProviders.filter((provider) => provider.enable)
      const disabledList = newProviders.filter((provider) => !provider.enable)
      const newOrder = [...enabledList.map((p) => p.id), ...disabledList.map((p) => p.id)]
      const allIds = providers.value.map((provider) => provider.id)
      const missingIds = allIds.filter((id) => !newOrder.includes(id))
      providerOrder.value = [...newOrder, ...missingIds]
      await saveProviderOrder()
      await configP.reorderProvidersAtomic(newProviders)
      await refreshProviders()
    } catch (error) {
      console.error('Failed to update provider order:', error)
      throw error
    }
  }

  const optimizeProviderOrder = async (providerId: string, enable: boolean) => {
    try {
      const currentOrder = [...providerOrder.value]
      const index = currentOrder.indexOf(providerId)
      if (index !== -1) {
        currentOrder.splice(index, 1)
      }
      const availableProviders = providers.value
      const enabledOrder: string[] = []
      const disabledOrder: string[] = []
      currentOrder.forEach((id) => {
        const provider = availableProviders.find((item) => item.id === id)
        if (!provider || provider.id === providerId) return
        if (provider.enable) {
          enabledOrder.push(id)
        } else {
          disabledOrder.push(id)
        }
      })
      const newOrder = enable
        ? [...enabledOrder, providerId, ...disabledOrder]
        : [...enabledOrder, providerId, ...disabledOrder]
      const missingIds = availableProviders.map((p) => p.id).filter((id) => !newOrder.includes(id))
      providerOrder.value = [...newOrder, ...missingIds]
      await saveProviderOrder()
    } catch (error) {
      console.error('Failed to optimize provider order:', error)
    }
  }

  const updateProviderStatus = async (providerId: string, enable: boolean) => {
    const previousTimestamp = providerTimestamps.value[providerId]
    providerTimestamps.value[providerId] = Date.now()
    try {
      await saveProviderTimestamps()
      await updateProviderConfig(providerId, { enable })
      await optimizeProviderOrder(providerId, enable)
    } catch (error) {
      if (previousTimestamp === undefined) {
        delete providerTimestamps.value[providerId]
      } else {
        providerTimestamps.value[providerId] = previousTimestamp
      }
      await saveProviderTimestamps()
      throw error
    }
  }

  const addCustomProvider = async (provider: LLM_PROVIDER) => {
    const newProvider = { ...provider, custom: true }
    delete (newProvider as any).websites
    await configP.addProviderAtomic(newProvider)
    await refreshProviders()
  }

  const removeProvider = async (providerId: string) => {
    await configP.removeProviderAtomic(providerId)
    providerOrder.value = providerOrder.value.filter((id) => id !== providerId)
    await saveProviderOrder()
    await refreshProviders()
  }

  const updateAwsBedrockProviderConfig = async (
    providerId: string,
    updates: Partial<AWS_BEDROCK_PROVIDER>
  ) => {
    return updateProviderConfig(providerId, updates)
  }

  const updateVertexProviderConfig = async (
    providerId: string,
    updates: Partial<VERTEX_PROVIDER>
  ) => {
    return updateProviderConfig(providerId, updates)
  }

  const checkProvider = async (providerId: string, modelId?: string) => {
    return llmP.check(providerId, modelId)
  }

  const setAzureApiVersion = async (version: string) => {
    await configP.setSetting('azureApiVersion', version)
  }

  const getAzureApiVersion = async (): Promise<string> => {
    return (await configP.getSetting<string>('azureApiVersion')) || '2024-02-01'
  }

  const setGeminiSafety = async (
    key: string,
    value:
      | 'BLOCK_NONE'
      | 'BLOCK_ONLY_HIGH'
      | 'BLOCK_MEDIUM_AND_ABOVE'
      | 'BLOCK_LOW_AND_ABOVE'
      | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
  ) => {
    await configP.setSetting(`geminiSafety_${key}`, value)
  }

  const getGeminiSafety = async (key: string): Promise<string> => {
    return (
      (await configP.getSetting<string>(`geminiSafety_${key}`)) ||
      'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
    )
  }

  const setAwsBedrockCredential = async (credential: unknown) => {
    await configP.setSetting('awsBedrockCredential', JSON.stringify({ credential }))
  }

  const getAwsBedrockCredential = async () => {
    return await configP.getSetting('awsBedrockCredential')
  }

  const getVoiceAIConfig = async (): Promise<VoiceAIConfig> => {
    const config = {
      audioFormat: (await configP.getSetting<string>('voiceAI_audioFormat')) || 'mp3',
      model: (await configP.getSetting<string>('voiceAI_model')) || 'voiceai-tts-v1-latest',
      language: (await configP.getSetting<string>('voiceAI_language')) || 'en',
      temperature: (await configP.getSetting<number>('voiceAI_temperature')) ?? 1,
      topP: (await configP.getSetting<number>('voiceAI_topP')) ?? 0.8,
      agentId: (await configP.getSetting<string>('voiceAI_agentId')) || ''
    }
    voiceAIConfig.value = config
    return config
  }

  const updateVoiceAIConfig = async (updates: Partial<VoiceAIConfig>) => {
    if (updates.audioFormat !== undefined) {
      await configP.setSetting('voiceAI_audioFormat', updates.audioFormat)
    }
    if (updates.model !== undefined) {
      await configP.setSetting('voiceAI_model', updates.model)
    }
    if (updates.language !== undefined) {
      await configP.setSetting('voiceAI_language', updates.language)
    }
    if (updates.temperature !== undefined) {
      await configP.setSetting('voiceAI_temperature', updates.temperature)
    }
    if (updates.topP !== undefined) {
      await configP.setSetting('voiceAI_topP', updates.topP)
    }
    if (updates.agentId !== undefined) {
      await configP.setSetting('voiceAI_agentId', updates.agentId)
    }
    await getVoiceAIConfig()
  }

  const updateProviderTimestamp = async (providerId: string) => {
    providerTimestamps.value[providerId] = Date.now()
    await saveProviderTimestamps()
  }

  const initialize = async () => {
    await loadProviderTimestamps()
    await loadProviderOrder()
    setupProviderListeners()
    await refreshProviders()
    await defaultProvidersQuery.refetch()
  }

  let providerOrderSyncTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    providers,
    (list) => {
      if (!list || list.length === 0) return
      // Only update order if we already have an order established
      if (providerOrder.value.length === 0) {
        // If no order yet, try to load it first (or init from list if load fails/empty)
        void loadProviderOrder()
        return
      }

      if (providerOrderSyncTimer) {
        clearTimeout(providerOrderSyncTimer)
      }

      providerOrderSyncTimer = setTimeout(() => {
        const ensured = ensureOrderIncludesProviders(providerOrder.value, list)

        const isSameLength = ensured.length === providerOrder.value.length
        const isSameOrder =
          isSameLength && ensured.every((id, idx) => id === providerOrder.value[idx])

        if (!isSameOrder) {
          providerOrder.value = ensured
          void saveProviderOrder()
        }
      }, 80)
    },
    { immediate: true }
  )

  return {
    providers,
    defaultProviders,
    sortedProviders,
    providerOrder,
    providerTimestamps,
    initialize,
    refreshProviders,
    updateProvider,
    updateProviderConfig,
    updateProviderApi,
    updateProviderAuth,
    updateProviderStatus,
    updateProvidersOrder,
    optimizeProviderOrder,
    updateProviderTimestamp,
    loadProviderOrder,
    saveProviderOrder,
    loadProviderTimestamps,
    saveProviderTimestamps,
    addCustomProvider,
    removeProvider,
    updateAwsBedrockProviderConfig,
    updateVertexProviderConfig,
    checkProvider,
    setAzureApiVersion,
    getAzureApiVersion,
    setGeminiSafety,
    getGeminiSafety,
    setAwsBedrockCredential,
    getAwsBedrockCredential,
    getVoiceAIConfig,
    updateVoiceAIConfig,
    voiceAIConfig
  }
})
