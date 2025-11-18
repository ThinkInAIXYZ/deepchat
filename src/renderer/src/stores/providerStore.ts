import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { CONFIG_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import type { LLM_PROVIDER } from '@shared/presenter'

const PROVIDER_ORDER_KEY = 'providerOrder'
const PROVIDER_TIMESTAMP_KEY = 'providerTimestamps'

export const useProviderStore = defineStore('provider', () => {
  const configP = usePresenter('configPresenter')

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
    const validOrder = order.filter((id) => list.some((provider) => provider.id === id))
    const missingIds = list.map((provider) => provider.id).filter((id) => !validOrder.includes(id))
    return [...validOrder, ...missingIds]
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
      providerOrder.value = ensureOrderIncludesProviders(savedOrder ?? [], providers.value)
    } catch (error) {
      console.error('Failed to load provider order:', error)
      providerOrder.value = providers.value.map((provider) => provider.id)
    }
  }

  const saveProviderOrder = async () => {
    try {
      await configP.setSetting(PROVIDER_ORDER_KEY, providerOrder.value)
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
    await providersQuery.refetch()
    await loadProviderOrder()
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

  const updateProviderTimestamp = async (providerId: string) => {
    providerTimestamps.value[providerId] = Date.now()
    await saveProviderTimestamps()
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

  const initialize = async () => {
    await loadProviderTimestamps()
    await loadProviderOrder()
    setupProviderListeners()
  }

  watch(
    providers,
    (list) => {
      if (!list || list.length === 0) return
      const ensured = ensureOrderIncludesProviders(providerOrder.value, list)
      if (JSON.stringify(ensured) !== JSON.stringify(providerOrder.value)) {
        providerOrder.value = ensured
        void saveProviderOrder()
      }
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
    updateProvidersOrder,
    optimizeProviderOrder,
    updateProviderTimestamp
  }
})
