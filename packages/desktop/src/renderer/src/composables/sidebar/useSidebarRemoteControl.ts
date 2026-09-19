import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { tryOnMounted, tryOnScopeDispose, useDocumentVisibility, useTimeoutFn } from '@vueuse/core'
import type { Router } from 'vue-router'
import { createRemoteControlClient } from '@api/RemoteControlClient'
import type { createSettingsClient } from '@api/SettingsClient'
import type { RemoteChannel, RemoteRuntimeState } from '@shared/types/remote'
import type { usePluginCatalogStore } from '@/stores/pluginCatalog'

const REMOTE_STATUS_ACTIVE_POLL_MS = 2_000
const REMOTE_STATUS_IDLE_POLL_MS = 30_000

/**
 * 'applied' committed a fresh snapshot; 'discarded' fetched fine but lost to a newer
 * refresh or a concurrent store mutation (not an error, no backoff); 'failed' is a
 * fetch error that counts toward backoff.
 */
type RemoteRefreshOutcome = 'applied' | 'discarded' | 'failed'

interface UseSidebarRemoteControlOptions {
  pluginCatalogStore: ReturnType<typeof usePluginCatalogStore>
  settingsClient: ReturnType<typeof createSettingsClient>
  router: Router | undefined
  t: (key: string) => string
}

/**
 * Remote-control button state for the sidebar rail: polls channel statuses (fast while a
 * channel is enabled, slow otherwise, exponential backoff on errors, paused while the
 * document is hidden) and derives the aggregate button presentation.
 */
export function useSidebarRemoteControl(options: UseSidebarRemoteControlOptions) {
  const { pluginCatalogStore, settingsClient, router, t } = options
  const remoteControlClient = createRemoteControlClient()
  const { remoteChannels: remoteChannelDescriptors, remoteStatuses: remoteControlStatus } =
    storeToRefs(pluginCatalogStore)

  let statusRefreshErrors = 0
  /**
   * Increments per refresh run. A run that is no longer current (e.g. superseded by a
   * hide/show-triggered refresh) must not write its snapshot, count toward backoff,
   * or schedule the next poll — the newer run owns the outcome.
   */
  let statusRefreshSequence = 0
  let disposed = false

  const remoteChannelIds = computed(() =>
    remoteChannelDescriptors.value.map((descriptor) => descriptor.id)
  )
  const getRemoteChannelStatus = (channel: RemoteChannel) => remoteControlStatus.value[channel]
  const showRemoteControlButton = computed(() =>
    remoteChannelIds.value.some((channel) => Boolean(getRemoteChannelStatus(channel)?.enabled))
  )
  const firstEnabledRemoteChannel = computed<RemoteChannel | null>(
    () =>
      remoteChannelIds.value.find((channel) => Boolean(getRemoteChannelStatus(channel)?.enabled)) ??
      null
  )
  const aggregatedRemoteControlState = computed<RemoteRuntimeState>(() => {
    const states = remoteChannelIds.value
      .map((channel) => getRemoteChannelStatus(channel))
      .filter((status) => status?.enabled)
      .map((status) => status?.state as RemoteRuntimeState)

    if (states.length === 0) {
      return 'disabled'
    }
    if (states.includes('error')) {
      return 'error'
    }
    if (states.includes('backoff')) {
      return 'backoff'
    }
    if (states.includes('starting')) {
      return 'starting'
    }
    if (states.includes('running')) {
      return 'running'
    }
    if (states.includes('stopped')) {
      return 'stopped'
    }
    return 'disabled'
  })
  const remoteControlTooltip = computed(() => {
    return remoteChannelIds.value
      .map((channel) => {
        const descriptor = remoteChannelDescriptors.value.find((item) => item.id === channel)
        const title = descriptor ? t(descriptor.titleKey) : channel
        const status = getRemoteChannelStatus(channel)
        const statusText =
          status?.enabled && status.state
            ? t(`chat.sidebar.remoteControlStatus.${status.state}`)
            : t('chat.sidebar.remoteControlDisabled')
        return `${title}: ${statusText}`
      })
      .join('\n')
  })
  const remoteControlButtonClass = computed(() => {
    const state = aggregatedRemoteControlState.value

    if (state === 'error') {
      return 'border-red-500/40 bg-red-500/10 hover:bg-red-500/15'
    }

    return 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15'
  })
  const remoteControlIconClass = computed(() => {
    const state = aggregatedRemoteControlState.value

    if (state === 'error') {
      return 'text-red-600 dark:text-red-400'
    }

    return ['text-emerald-600 dark:text-emerald-400', state === 'starting' ? 'animate-pulse' : '']
  })

  const hasEnabledRemoteChannelStatus = () =>
    Object.values(remoteControlStatus.value).some((status) => status?.enabled === true)

  const refreshRemoteControlStatus = async (requestId: number): Promise<RemoteRefreshOutcome> => {
    const version = pluginCatalogStore.captureRemoteRefresh()
    try {
      const descriptors = await remoteControlClient.listRemoteChannels()
      const channels = descriptors.map((descriptor) => descriptor.id)
      const statuses = await Promise.all(
        channels.map((channel) => remoteControlClient.getChannelStatus(channel))
      )
      if (requestId !== statusRefreshSequence) {
        return 'discarded'
      }
      return pluginCatalogStore.replaceRemoteSnapshot(descriptors, statuses, version)
        ? 'applied'
        : 'discarded'
    } catch (error) {
      console.warn('[WindowSideBar] Failed to refresh remote control status:', error)
      return 'failed'
    }
  }

  const documentVisibility = useDocumentVisibility()
  const pollDelayMs = ref(0)
  const pollTimeout = useTimeoutFn(() => void runStatusRefresh(), pollDelayMs, { immediate: false })

  const scheduleStatusRefresh = (delayMs = 0) => {
    pollTimeout.stop()
    if (disposed || documentVisibility.value === 'hidden') {
      return
    }

    if (delayMs <= 0) {
      void runStatusRefresh()
      return
    }

    pollDelayMs.value = delayMs
    pollTimeout.start()
  }

  async function runStatusRefresh(): Promise<void> {
    const requestId = ++statusRefreshSequence
    const outcome = await refreshRemoteControlStatus(requestId)
    if (requestId !== statusRefreshSequence) {
      return
    }
    if (outcome !== 'discarded') {
      statusRefreshErrors = outcome === 'applied' ? 0 : statusRefreshErrors + 1
    }

    if (disposed || documentVisibility.value === 'hidden') {
      return
    }
    const backoffMs = Math.min(30_000, 2_000 * 2 ** statusRefreshErrors)
    scheduleStatusRefresh(
      hasEnabledRemoteChannelStatus()
        ? outcome === 'failed'
          ? backoffMs
          : REMOTE_STATUS_ACTIVE_POLL_MS
        : REMOTE_STATUS_IDLE_POLL_MS
    )
  }

  watch(documentVisibility, (visibility) => {
    if (visibility === 'hidden') {
      pollTimeout.stop()
      return
    }

    scheduleStatusRefresh()
  })

  const openRemoteSettings = async () => {
    if (router?.hasRoute?.('plugins-detail') && firstEnabledRemoteChannel.value) {
      await router.push({
        name: 'plugins-detail',
        params: { pluginId: `remote:${firstEnabledRemoteChannel.value}` }
      })
      return
    }

    await settingsClient.openSettings({ routeName: 'settings-remote' })
  }

  tryOnMounted(() => {
    scheduleStatusRefresh()
  })

  tryOnScopeDispose(() => {
    disposed = true
    pollTimeout.stop()
  })

  return {
    showRemoteControlButton,
    remoteControlTooltip,
    remoteControlButtonClass,
    remoteControlIconClass,
    openRemoteSettings
  }
}
