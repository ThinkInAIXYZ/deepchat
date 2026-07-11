import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RemoteChannelDescriptor, TelegramRemoteStatus } from '@shared/presenter'
import type { PluginListItem } from '@shared/types/plugin'
import { usePluginCatalogStore } from '@/stores/pluginCatalog'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const plugin = (enabled = false): PluginListItem => ({
  id: 'com.deepchat.plugins.test',
  name: 'Test plugin',
  version: '1.0.0',
  publisher: 'DeepChat',
  installed: true,
  enabled,
  trusted: true,
  trustState: 'trusted',
  official: true,
  capabilities: []
})

const telegramDescriptor: RemoteChannelDescriptor = {
  id: 'telegram',
  titleKey: 'settings.remote.telegram.title',
  descriptionKey: 'settings.remote.telegram.description',
  supportsCronDelivery: true
}

const telegramStatus = (enabled = false): TelegramRemoteStatus => ({
  channel: 'telegram',
  enabled,
  state: enabled ? 'running' : 'disabled',
  pollOffset: 0,
  bindingCount: 0,
  allowedUserCount: 0,
  lastError: null,
  botUser: null
})

describe('pluginCatalogStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shares successful plugin and remote snapshots across consumers', () => {
    const store = usePluginCatalogStore()

    store.replacePlugins([plugin()], store.capturePluginRefresh())
    store.replaceRemoteSnapshot(
      [telegramDescriptor],
      [telegramStatus()],
      store.captureRemoteRefresh()
    )

    const secondConsumer = usePluginCatalogStore()
    expect(secondConsumer.getPlugin('com.deepchat.plugins.test')?.enabled).toBe(false)
    expect(secondConsumer.remoteChannels).toEqual([telegramDescriptor])
    expect(secondConsumer.remoteStatuses.telegram?.state).toBe('disabled')
  })

  it('keeps an optimistic plugin update when an older refresh completes', () => {
    const store = usePluginCatalogStore()
    store.replacePlugins([plugin()], store.capturePluginRefresh())
    const staleRefresh = store.capturePluginRefresh()

    const previous = store.beginPluginEnabledMutation('com.deepchat.plugins.test', true)

    expect(store.getPlugin('com.deepchat.plugins.test')?.enabled).toBe(true)
    expect(store.replacePlugins([plugin()], staleRefresh)).toBe(false)
    expect(store.getPlugin('com.deepchat.plugins.test')?.enabled).toBe(true)

    store.rollbackPluginMutation(previous)
    expect(store.getPlugin('com.deepchat.plugins.test')?.enabled).toBe(false)
  })

  it('keeps an optimistic remote update when a refresh spans the mutation', () => {
    const store = usePluginCatalogStore()
    store.replaceRemoteSnapshot(
      [telegramDescriptor],
      [telegramStatus()],
      store.captureRemoteRefresh()
    )
    const staleRefresh = store.captureRemoteRefresh()

    store.beginRemoteEnabledMutation('telegram', true)
    const refreshDuringMutation = store.captureRemoteRefresh()

    expect(store.remoteStatuses.telegram).toMatchObject({ enabled: true, state: 'starting' })
    expect(
      store.replaceRemoteSnapshot([telegramDescriptor], [telegramStatus()], staleRefresh)
    ).toBe(false)

    store.commitRemoteMutation(telegramStatus(true))

    expect(
      store.replaceRemoteSnapshot([telegramDescriptor], [telegramStatus()], refreshDuringMutation)
    ).toBe(false)
    expect(store.remoteStatuses.telegram).toMatchObject({ enabled: true, state: 'running' })
  })
})
