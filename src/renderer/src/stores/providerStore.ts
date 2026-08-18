import { computed, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { defineStore } from 'pinia'
import { createProviderClient } from '../../api/ProviderClient'
import { createConfigClient } from '../../api/ConfigClient'
import { useIpcQuery } from '@/composables/useIpcQuery'
import type { ProviderHealthEntry } from '@shared/contracts/routes'
import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER, VERTEX_PROVIDER } from '@shared/types/provider'

type VoiceAIConfig = {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
  agentId: string
}

export type ProviderHealthStatus = 'not_checked' | 'checking' | 'verified' | 'needs_attention'

export type ProviderHealthView = {
  status: ProviderHealthStatus
  checkedAt?: number
  errorMsg?: string
}

const PROVIDER_ORDER_KEY = 'providerOrder'
const PROVIDER_TIMESTAMP_KEY = 'providerTimestamps'
const PROVIDER_CONFIGURED_KEY = 'configuredProviders'
const PROVIDER_HEALTH_KEY = 'providerHealth'

const hashString = (input: string): string => {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

export const useProviderStore = defineStore('provider', () => {
  const configClient = createConfigClient()
  const providerClient = createProviderClient()

  const providersQuery = useIpcQuery({
    key: () => ['providers'],
    query: () => providerClient.getProviderSummaries(),
    staleTime: 30_000
  })

  const defaultProvidersQuery = useIpcQuery({
    key: () => ['providers', 'defaults'],
    query: () => providerClient.getDefaultProviders(),
    staleTime: 60_000,
    gcTime: 300_000
  })

  const providerOrder = ref<string[]>([])
  const providerTimestamps = ref<Record<string, number>>({})
  const configuredProviderIds = ref<string[]>([])
  const configuredLoaded = ref(false)
  const providerHealthCache = ref<Record<string, ProviderHealthEntry>>({})
  const checkingProviderIds = ref<Set<string>>(new Set())
  const listenersRegistered = ref(false)
  const voiceAIConfig = ref<VoiceAIConfig | null>(null)
  const initialized = ref(false)
  const initializationPromise = ref<Promise<void> | null>(null)

  const providers = computed<LLM_PROVIDER[]>(() => {
    const data = providersQuery.data.value as LLM_PROVIDER[] | undefined
    return data ?? []
  })
  const defaultProviders = computed<LLM_PROVIDER[]>(() => {
    const data = defaultProvidersQuery.data.value as LLM_PROVIDER[] | undefined
    return data ?? []
  })

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

  const sortedProviders = computed(() => sortProviders(providers.value, true))

  const hasStoredCredentials = (provider: LLM_PROVIDER) =>
    Boolean(provider.apiKey?.trim() || provider.oauthToken)

  // "Configured" is sidebar membership: it is sticky (kept while disabled or failing)
  // and only ever leaves through an explicit removal, never through a transient failure.
  const isProviderConfiguredByState = (provider: LLM_PROVIDER) =>
    provider.enable || Boolean(provider.custom) || hasStoredCredentials(provider)

  const configuredIdSet = computed(() => new Set(configuredProviderIds.value))

  const isProviderConfigured = (providerId: string) => configuredIdSet.value.has(providerId)

  const configuredProviders = computed(() =>
    sortedProviders.value.filter((provider) => configuredIdSet.value.has(provider.id))
  )

  const unconfiguredProviders = computed(() =>
    sortedProviders.value.filter((provider) => !configuredIdSet.value.has(provider.id))
  )

  const loadConfiguredProviders = async () => {
    try {
      const saved = await configClient.getSetting(PROVIDER_CONFIGURED_KEY)
      if (saved) {
        configuredProviderIds.value = saved
      }
    } catch (error) {
      console.error('Failed to load configured providers:', error)
    } finally {
      configuredLoaded.value = true
    }
    await syncConfiguredFromProviders(providers.value)
  }

  const saveConfiguredProviders = async () => {
    try {
      await configClient.setSetting(PROVIDER_CONFIGURED_KEY, [...configuredProviderIds.value])
    } catch (error) {
      console.error('Failed to save configured providers:', error)
    }
  }

  const markProviderConfigured = async (providerId: string) => {
    if (configuredIdSet.value.has(providerId)) {
      return
    }
    configuredProviderIds.value = [...configuredProviderIds.value, providerId]
    await saveConfiguredProviders()
  }

  const unmarkProviderConfigured = async (providerId: string) => {
    if (!configuredIdSet.value.has(providerId)) {
      return
    }
    configuredProviderIds.value = configuredProviderIds.value.filter((id) => id !== providerId)
    await saveConfiguredProviders()
  }

  const syncConfiguredFromProviders = async (list: LLM_PROVIDER[]) => {
    if (!configuredLoaded.value) {
      return
    }
    const missing = list
      .filter((provider) => isProviderConfiguredByState(provider))
      .map((provider) => provider.id)
      .filter((id) => !configuredIdSet.value.has(id))
    if (missing.length === 0) {
      return
    }
    configuredProviderIds.value = [...configuredProviderIds.value, ...missing]
    await saveConfiguredProviders()
  }

  const computeHealthFingerprint = (provider: LLM_PROVIDER): string => {
    const bedrock = provider as AWS_BEDROCK_PROVIDER
    const vertex = provider as VERTEX_PROVIDER
    const material = [
      provider.apiType,
      provider.baseUrl ?? '',
      provider.apiKey ? hashString(provider.apiKey) : '',
      provider.oauthToken ? hashString(provider.oauthToken) : '',
      // Bedrock keeps its secrets in provider.credential, not apiKey.
      bedrock.credential
        ? hashString(
            [
              bedrock.credential.authMode ?? '',
              bedrock.credential.accessKeyId ?? '',
              bedrock.credential.secretAccessKey ?? '',
              bedrock.credential.region ?? '',
              bedrock.credential.profile ?? ''
            ].join('|')
          )
        : '',
      // Vertex keeps its secrets in dedicated fields.
      vertex.projectId ? hashString(vertex.projectId) : '',
      vertex.accountPrivateKey ? hashString(vertex.accountPrivateKey) : ''
    ].join('|')
    return hashString(material)
  }

  const loadProviderHealth = async () => {
    try {
      const saved = await configClient.getSetting(PROVIDER_HEALTH_KEY)
      providerHealthCache.value = saved ?? {}
    } catch (error) {
      console.error('Failed to load provider health cache:', error)
      providerHealthCache.value = {}
    }
  }

  const saveProviderHealth = async () => {
    try {
      await configClient.setSetting(PROVIDER_HEALTH_KEY, { ...providerHealthCache.value })
    } catch (error) {
      console.error('Failed to save provider health cache:', error)
    }
  }

  // Health is a cached verification result for the current configuration, not a live
  // connection state: a stale fingerprint (config changed since the check) degrades to
  // not_checked instead of showing a misleading verified/failed result.
  const getProviderHealth = (providerId: string): ProviderHealthView => {
    if (checkingProviderIds.value.has(providerId)) {
      return { status: 'checking' }
    }
    const entry = providerHealthCache.value[providerId]
    const provider = providers.value.find((item) => item.id === providerId)
    if (!entry || !provider || entry.fingerprint !== computeHealthFingerprint(provider)) {
      return { status: 'not_checked' }
    }
    return { status: entry.status, checkedAt: entry.checkedAt, errorMsg: entry.errorMsg }
  }

  const recordProviderHealth = async (
    providerId: string,
    fingerprint: string,
    ok: boolean,
    errorMsg?: string
  ) => {
    providerHealthCache.value = {
      ...providerHealthCache.value,
      [providerId]: {
        status: ok ? 'verified' : 'needs_attention',
        fingerprint,
        checkedAt: Date.now(),
        ...(ok || !errorMsg ? {} : { errorMsg })
      }
    }
    await saveProviderHealth()
  }

  const clearProviderHealth = async (providerId: string) => {
    if (!(providerId in providerHealthCache.value)) {
      return
    }
    const next = { ...providerHealthCache.value }
    delete next[providerId]
    providerHealthCache.value = next
    await saveProviderHealth()
  }

  const loadProviderOrder = async () => {
    try {
      const savedOrder = await configClient.getSetting(PROVIDER_ORDER_KEY)
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
        await configClient.setSetting(PROVIDER_ORDER_KEY, [...providerOrder.value])
      }
    } catch (error) {
      console.error('Failed to save provider order:', error)
    }
  }

  const loadProviderTimestamps = async () => {
    try {
      const savedTimestamps = await configClient.getSetting(PROVIDER_TIMESTAMP_KEY)
      providerTimestamps.value = savedTimestamps ?? {}
    } catch (error) {
      console.error('Failed to load provider timestamps:', error)
      providerTimestamps.value = {}
    }
  }

  const saveProviderTimestamps = async () => {
    try {
      await configClient.setSetting(PROVIDER_TIMESTAMP_KEY, { ...providerTimestamps.value })
    } catch (error) {
      console.error('Failed to save provider timestamps:', error)
    }
  }

  const refreshProviders = async () => {
    // Load order first to ensure we have the latest saved order before processing provider list updates
    await loadProviderOrder()
    await providersQuery.refetch()
  }

  const ensureDefaultProvidersReady = async () => {
    if (defaultProvidersQuery.data.value) {
      return
    }

    await defaultProvidersQuery.refetch()
  }

  const setupProviderListeners = () => {
    if (listenersRegistered.value) return
    listenersRegistered.value = true

    providerClient.onProvidersChanged(async () => {
      await refreshProviders()
    })
  }

  const updateProvider = async (id: string, provider: LLM_PROVIDER) => {
    const current = providers.value.find((item) => item.id === id)
    const previousEnable = current?.enable
    const next = { ...provider }
    delete (next as any).websites
    await providerClient.setProviderById(id, next)
    await refreshProviders()
    return { previousEnable, next }
  }

  const updateProviderConfig = async (providerId: string, updates: Partial<LLM_PROVIDER>) => {
    const currentProvider = providers.value.find((p) => p.id === providerId)
    if (!currentProvider) {
      throw new Error(`Provider ${providerId} not found`)
    }

    const requiresRebuild = await providerClient.updateProviderAtomic(providerId, updates)
    await refreshProviders()
    return { requiresRebuild, updated: { ...currentProvider, ...updates } }
  }

  const updateProviderApi = async (providerId: string, apiKey?: string, baseUrl?: string) => {
    const updates: Partial<LLM_PROVIDER> = {}
    if (apiKey !== undefined) updates.apiKey = apiKey
    if (baseUrl !== undefined) updates.baseUrl = baseUrl
    return updateProviderConfig(providerId, updates)
  }

  const updateProvidersOrder = async (newProviders: LLM_PROVIDER[]) => {
    try {
      // Preserve the caller-supplied sequence (including interleaved enabled
      // and disabled entries) instead of re-partitioning into groups.
      const newOrder = newProviders.map((provider) => provider.id)
      const allIds = providers.value.map((provider) => provider.id)
      const missingIds = allIds.filter((id) => !newOrder.includes(id))
      providerOrder.value = [...newOrder, ...missingIds]
      await saveProviderOrder()
      await providerClient.reorderProvidersAtomic(newProviders)
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
      if (enable) {
        await markProviderConfigured(providerId)
      }
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
    await providerClient.addProviderAtomic(newProvider)
    await refreshProviders()
  }

  // Runs "Connect and load models" against a draft configuration. Nothing is
  // persisted and no enable flag is toggled; the typed main-process boundary
  // validates the draft with a transient provider instance.
  const validateDraftProvider = async (draft: LLM_PROVIDER) => {
    return await providerClient.validateDraftProvider(draft)
  }

  // Persists a successfully validated draft as a configured, available provider
  // and records its verified health for the validated configuration.
  const commitValidatedDraft = async (draft: LLM_PROVIDER) => {
    const provider = { ...draft, enable: true }
    await addCustomProvider(provider)
    await markProviderConfigured(provider.id)
    await recordProviderHealth(provider.id, computeHealthFingerprint(provider), true)
  }

  const removeProvider = async (providerId: string) => {
    await providerClient.removeProviderAtomic(providerId)
    providerOrder.value = providerOrder.value.filter((id) => id !== providerId)
    await saveProviderOrder()
    await unmarkProviderConfigured(providerId)
    await clearProviderHealth(providerId)
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
    const provider = providers.value.find((item) => item.id === providerId)
    // Capture the fingerprint of the configuration actually being tested so a
    // mid-flight config change cannot attach this result to the new configuration.
    const fingerprint = provider ? computeHealthFingerprint(provider) : null
    checkingProviderIds.value.add(providerId)
    try {
      const result = await providerClient.testConnection({ providerId, modelId })
      if (fingerprint) {
        await recordProviderHealth(
          providerId,
          fingerprint,
          result.isOk,
          result.errorMsg ?? undefined
        )
      }
      return result
    } catch (error) {
      if (fingerprint) {
        await recordProviderHealth(
          providerId,
          fingerprint,
          false,
          error instanceof Error ? error.message : String(error)
        )
      }
      throw error
    } finally {
      checkingProviderIds.value.delete(providerId)
    }
  }

  const setAzureApiVersion = async (version: string) => {
    await configClient.setAzureApiVersion(version)
  }

  const getAzureApiVersion = async (): Promise<string> => {
    return await configClient.getAzureApiVersion()
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
    await configClient.setGeminiSafety(key, value)
  }

  const getGeminiSafety = async (key: string): Promise<string> => {
    return await configClient.getGeminiSafety(key)
  }

  const setAwsBedrockCredential = async (credential: unknown) => {
    await configClient.setAwsBedrockCredential(credential)
  }

  const getAwsBedrockCredential = async () => {
    return await configClient.getAwsBedrockCredential()
  }

  const getVoiceAIConfig = async (): Promise<VoiceAIConfig> => {
    const config = await configClient.getVoiceAIConfig()
    voiceAIConfig.value = config
    return config
  }

  const updateVoiceAIConfig = async (updates: Partial<VoiceAIConfig>) => {
    await configClient.updateVoiceAIConfig(updates)
    await getVoiceAIConfig()
  }

  const updateProviderTimestamp = async (providerId: string) => {
    providerTimestamps.value[providerId] = Date.now()
    await saveProviderTimestamps()
  }

  const initialize = async () => {
    if (initialized.value) {
      return
    }

    if (initializationPromise.value) {
      await initializationPromise.value
      return
    }

    initializationPromise.value = (async () => {
      await loadProviderTimestamps()
      await loadProviderOrder()
      await loadProviderHealth()
      setupProviderListeners()
      await refreshProviders()
      await loadConfiguredProviders()
      initialized.value = true
    })()

    try {
      await initializationPromise.value
    } finally {
      if (!initialized.value) {
        initializationPromise.value = null
      }
    }
  }

  const ensureInitialized = async () => {
    await initialize()
  }

  const primeProviders = async () => {
    setupProviderListeners()
    await providersQuery.refetch()
    await loadProviderOrder()
    await loadProviderTimestamps()
    await loadProviderHealth()
    await loadConfiguredProviders()
  }

  // Equivalent to the previous 80ms setTimeout debounce; only the API changes.
  const syncProviderOrderFromList = useDebounceFn((list: LLM_PROVIDER[]) => {
    const ensured = ensureOrderIncludesProviders(providerOrder.value, list)

    const isSameLength = ensured.length === providerOrder.value.length
    const isSameOrder = isSameLength && ensured.every((id, idx) => id === providerOrder.value[idx])

    if (!isSameOrder) {
      providerOrder.value = ensured
      void saveProviderOrder()
    }
  }, 80)

  watch(
    providers,
    (list) => {
      if (!list || list.length === 0) return
      void syncConfiguredFromProviders(list)
      // Only update order if we already have an order established
      if (providerOrder.value.length === 0) {
        // If no order yet, try to load it first (or init from list if load fails/empty)
        void loadProviderOrder()
        return
      }

      syncProviderOrderFromList(list)
    },
    { immediate: true }
  )

  return {
    providers,
    defaultProviders,
    sortedProviders,
    configuredProviders,
    unconfiguredProviders,
    configuredProviderIds,
    isProviderConfigured,
    markProviderConfigured,
    unmarkProviderConfigured,
    getProviderHealth,
    providerOrder,
    providerTimestamps,
    initialized,
    initialize,
    ensureInitialized,
    primeProviders,
    refreshProviders,
    ensureDefaultProvidersReady,
    updateProvider,
    updateProviderConfig,
    updateProviderApi,
    updateProviderStatus,
    updateProvidersOrder,
    optimizeProviderOrder,
    updateProviderTimestamp,
    loadProviderOrder,
    saveProviderOrder,
    loadProviderTimestamps,
    saveProviderTimestamps,
    addCustomProvider,
    validateDraftProvider,
    commitValidatedDraft,
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
