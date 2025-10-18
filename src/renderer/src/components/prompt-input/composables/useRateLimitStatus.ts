// === Vue Core ===
import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

// === Types ===
import type { CONVERSATION_SETTINGS } from '@shared/presenter'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

// === Stores ===
import { useSettingsStore } from '@/stores/settings'

// === Events ===
import { RATE_LIMIT_EVENTS } from '@/events'

/**
 * Rate limit status interface
 */
export interface RateLimitStatus {
  config: {
    enabled: boolean
    qpsLimit: number
  }
  currentQps: number
  queueLength: number
  lastRequestTime: number
}

/**
 * Composable for managing rate limit status display and polling
 * Handles status loading, icon/class/tooltip computation, and event listeners
 */
export function useRateLimitStatus(
  chatConfig: Ref<CONVERSATION_SETTINGS>,
  t: (key: string, params?: any) => string
) {
  // === Presenters ===
  const llmPresenter = usePresenter('llmproviderPresenter')

  // === Stores ===
  const settingsStore = useSettingsStore()

  // === Local State ===
  const rateLimitStatus = ref<RateLimitStatus | null>(null)
  let statusInterval: ReturnType<typeof setInterval> | null = null

  // === Computed ===
  const canSendImmediately = computed(() => {
    if (!rateLimitStatus.value?.config.enabled) return true

    const now = Date.now()
    const intervalMs = (1 / rateLimitStatus.value.config.qpsLimit) * 1000
    const timeSinceLastRequest = now - rateLimitStatus.value.lastRequestTime

    return timeSinceLastRequest >= intervalMs
  })

  // === Internal Helper Functions ===
  /**
   * Check if rate limit is enabled for current provider
   */
  const isRateLimitEnabled = (): boolean => {
    const currentProviderId = chatConfig.value.providerId
    if (!currentProviderId) return false

    const provider = settingsStore.providers.find((p) => p.id === currentProviderId)
    return provider?.rateLimit?.enabled ?? false
  }

  /**
   * Load rate limit status from presenter
   */
  const loadRateLimitStatus = async () => {
    const currentProviderId = chatConfig.value.providerId
    if (!currentProviderId) return

    if (!isRateLimitEnabled()) {
      rateLimitStatus.value = null
      return
    }

    try {
      const status = await llmPresenter.getProviderRateLimitStatus(currentProviderId)
      rateLimitStatus.value = status
    } catch (error) {
      console.error('Failed to load rate limit status:', error)
    }
  }

  /**
   * Start polling rate limit status
   */
  const startRateLimitPolling = () => {
    if (statusInterval) {
      clearInterval(statusInterval)
    }
    if (isRateLimitEnabled()) {
      statusInterval = setInterval(loadRateLimitStatus, 1000)
    }
  }

  /**
   * Stop polling rate limit status
   */
  const stopRateLimitPolling = () => {
    if (statusInterval) {
      clearInterval(statusInterval)
      statusInterval = null
    }
  }

  /**
   * Handle rate limit events from IPC
   */
  const handleRateLimitEvent = (data: any) => {
    if (data.providerId === chatConfig.value.providerId) {
      if (data.config && !data.config.enabled) {
        rateLimitStatus.value = null
      } else {
        loadRateLimitStatus()
      }
      startRateLimitPolling()
    }
  }

  // === Public Methods ===
  /**
   * Get rate limit status icon
   */
  const getRateLimitStatusIcon = (): string => {
    if (!rateLimitStatus.value?.config.enabled) return ''

    if (rateLimitStatus.value.queueLength > 0) {
      return 'lucide:clock'
    }

    return canSendImmediately.value ? 'lucide:check-circle' : 'lucide:timer'
  }

  /**
   * Get rate limit status CSS class
   */
  const getRateLimitStatusClass = (): string => {
    if (!rateLimitStatus.value?.config.enabled) return ''

    if (rateLimitStatus.value.queueLength > 0) {
      return 'text-orange-500'
    }

    return canSendImmediately.value ? 'text-green-500' : 'text-yellow-500'
  }

  /**
   * Get rate limit status tooltip text
   */
  const getRateLimitStatusTooltip = (): string => {
    if (!rateLimitStatus.value?.config.enabled) return ''

    const intervalSeconds = 1 / rateLimitStatus.value.config.qpsLimit

    if (rateLimitStatus.value.queueLength > 0) {
      return t('chat.input.rateLimitQueueTooltip', {
        count: rateLimitStatus.value.queueLength,
        interval: intervalSeconds
      })
    }

    if (canSendImmediately.value) {
      return t('chat.input.rateLimitReadyTooltip', { interval: intervalSeconds })
    }

    const waitTime = Math.ceil(
      (rateLimitStatus.value.lastRequestTime + intervalSeconds * 1000 - Date.now()) / 1000
    )
    return t('chat.input.rateLimitWaitingTooltip', { seconds: waitTime, interval: intervalSeconds })
  }

  /**
   * Format wait time text
   */
  const formatWaitTime = (): string => {
    if (!rateLimitStatus.value?.config.enabled) return ''

    const intervalSeconds = 1 / rateLimitStatus.value.config.qpsLimit
    const waitTime = Math.ceil(
      (rateLimitStatus.value.lastRequestTime + intervalSeconds * 1000 - Date.now()) / 1000
    )

    return t('chat.input.rateLimitWait', { seconds: Math.max(0, waitTime) })
  }

  // === Lifecycle Hooks ===
  onMounted(() => {
    loadRateLimitStatus()
    startRateLimitPolling()

    // Register IPC event listeners
    window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.CONFIG_UPDATED, handleRateLimitEvent)
    window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, handleRateLimitEvent)
    window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_QUEUED, handleRateLimitEvent)
  })

  onUnmounted(() => {
    stopRateLimitPolling()

    // Remove IPC event listeners
    window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.CONFIG_UPDATED)
    window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_EXECUTED)
    window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_QUEUED)
  })

  // === Return Public API ===
  return {
    // State (readonly)
    rateLimitStatus: computed(() => rateLimitStatus.value),
    canSendImmediately,

    // Methods
    loadRateLimitStatus,
    startRateLimitPolling,
    stopRateLimitPolling,
    getRateLimitStatusIcon,
    getRateLimitStatusClass,
    getRateLimitStatusTooltip,
    formatWaitTime
  }
}
