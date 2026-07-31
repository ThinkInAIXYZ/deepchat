import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  RemoteChannel,
  RemoteChannelDescriptor,
  RemoteChannelStatus
} from '@shared/types/remote'
import type { PluginListItem } from '@shared/types/plugin'
import type { OcrRuntimeStatus } from '@shared/contracts/routes/ocr.routes'

type RemoteStatusCache = Partial<Record<RemoteChannel, RemoteChannelStatus>>

export const usePluginCatalogStore = defineStore('pluginCatalog', () => {
  const plugins = ref<PluginListItem[]>([])
  const remoteChannels = ref<RemoteChannelDescriptor[]>([])
  const remoteStatuses = ref<RemoteStatusCache>({})
  const ocrStatus = ref<OcrRuntimeStatus | null>(null)
  const ocrStatusHasError = ref(false)
  let pluginMutationVersion = 0
  let remoteMutationVersion = 0
  let ocrRefreshVersion = 0

  const getPlugin = (pluginId: string): PluginListItem | null =>
    plugins.value.find((plugin) => plugin.id === pluginId) ?? null

  const upsertPlugin = (plugin: PluginListItem) => {
    const index = plugins.value.findIndex((item) => item.id === plugin.id)
    plugins.value =
      index < 0
        ? [...plugins.value, plugin]
        : plugins.value.map((item) => (item.id === plugin.id ? plugin : item))
  }

  const capturePluginRefresh = (): number => pluginMutationVersion

  const replacePlugins = (nextPlugins: PluginListItem[], version: number): boolean => {
    if (version !== pluginMutationVersion) {
      return false
    }
    plugins.value = nextPlugins
    return true
  }

  const replacePlugin = (plugin: PluginListItem, version: number): boolean => {
    if (version !== pluginMutationVersion) {
      return false
    }
    upsertPlugin(plugin)
    return true
  }

  const beginPluginEnabledMutation = (
    pluginId: string,
    enabled: boolean
  ): PluginListItem | null => {
    const previous = getPlugin(pluginId)
    pluginMutationVersion += 1
    if (previous) {
      upsertPlugin({ ...previous, enabled })
    }
    return previous
  }

  const commitPluginMutation = (plugin?: PluginListItem) => {
    pluginMutationVersion += 1
    if (plugin) {
      upsertPlugin(plugin)
    }
  }

  const rollbackPluginMutation = (previous: PluginListItem | null) => {
    pluginMutationVersion += 1
    if (previous) {
      upsertPlugin(previous)
    }
  }

  const captureRemoteRefresh = (): number => remoteMutationVersion

  const replaceRemoteSnapshot = (
    channels: RemoteChannelDescriptor[],
    statuses: RemoteChannelStatus[],
    version: number
  ): boolean => {
    if (version !== remoteMutationVersion) {
      return false
    }
    remoteChannels.value = channels
    remoteStatuses.value = Object.fromEntries(
      statuses.map((status) => [status.channel, status])
    ) as RemoteStatusCache
    return true
  }

  const replaceRemoteStatus = (status: RemoteChannelStatus, version: number): boolean => {
    if (version !== remoteMutationVersion) {
      return false
    }
    remoteStatuses.value = { ...remoteStatuses.value, [status.channel]: status }
    return true
  }

  const beginRemoteEnabledMutation = (
    channel: RemoteChannel,
    enabled: boolean
  ): RemoteChannelStatus | null => {
    const previous = remoteStatuses.value[channel] ?? null
    remoteMutationVersion += 1
    if (previous) {
      remoteStatuses.value = {
        ...remoteStatuses.value,
        [channel]: {
          ...previous,
          enabled,
          state: enabled ? 'starting' : 'disabled'
        }
      }
    }
    return previous
  }

  const commitRemoteMutation = (status: RemoteChannelStatus) => {
    remoteMutationVersion += 1
    remoteStatuses.value = { ...remoteStatuses.value, [status.channel]: status }
  }

  const rollbackRemoteMutation = (channel: RemoteChannel, previous: RemoteChannelStatus | null) => {
    remoteMutationVersion += 1
    if (previous) {
      remoteStatuses.value = { ...remoteStatuses.value, [channel]: previous }
      return
    }

    const nextStatuses = { ...remoteStatuses.value }
    delete nextStatuses[channel]
    remoteStatuses.value = nextStatuses
  }

  const beginOcrRefresh = (): number => {
    ocrRefreshVersion += 1
    return ocrRefreshVersion
  }

  const replaceOcrStatus = (status: OcrRuntimeStatus, version: number): boolean => {
    if (version !== ocrRefreshVersion) {
      return false
    }
    ocrStatus.value = status
    ocrStatusHasError.value = false
    return true
  }

  const markOcrStatusRefreshFailed = (version: number): boolean => {
    if (version !== ocrRefreshVersion) {
      return false
    }
    ocrStatusHasError.value = true
    return true
  }

  return {
    plugins,
    remoteChannels,
    remoteStatuses,
    ocrStatus,
    ocrStatusHasError,
    getPlugin,
    capturePluginRefresh,
    replacePlugins,
    replacePlugin,
    beginPluginEnabledMutation,
    commitPluginMutation,
    rollbackPluginMutation,
    captureRemoteRefresh,
    replaceRemoteSnapshot,
    replaceRemoteStatus,
    beginRemoteEnabledMutation,
    commitRemoteMutation,
    rollbackRemoteMutation,
    beginOcrRefresh,
    replaceOcrStatus,
    markOcrStatusRefreshFailed
  }
})
