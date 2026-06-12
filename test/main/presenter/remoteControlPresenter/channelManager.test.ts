import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { AdapterRegistry, ChannelManager } from '@/presenter/remoteControlPresenter/channelManager'
import type {
  ChannelAdapterConfig,
  ChannelFactory,
  ChannelStatusSnapshot,
  IChannelAdapter,
  SendMessageOptions
} from '@/presenter/remoteControlPresenter/types/channel'

class FakeAdapter extends EventEmitter implements IChannelAdapter {
  notifyChatIds: string[] = []
  connected = false

  constructor(
    readonly channelType: string,
    readonly channelId: string,
    readonly agentId: string,
    readonly configSignature?: string
  ) {
    super()
  }

  readonly connect = vi.fn(async () => {
    this.connected = true
  })
  readonly disconnect = vi.fn(async () => {
    this.connected = false
  })
  readonly sendMessage = vi.fn(
    async (_chatId: string, _text: string, _opts?: SendMessageOptions) => {}
  )
  readonly sendTypingIndicator = vi.fn(async (_chatId: string) => {})
  readonly onTextUpdate = vi.fn(async (_chatId: string, _fullText: string) => {})
  readonly onStreamComplete = vi.fn(async (_chatId: string, _finalText: string) => false)
  readonly onStreamError = vi.fn(async (_chatId: string, _error: string) => {})

  getStatusSnapshot(): ChannelStatusSnapshot {
    return {
      connected: this.connected,
      state: this.connected ? 'running' : 'stopped',
      lastError: null,
      botUser: null
    }
  }
}

const createConfig = (
  channelType: string,
  source: 'builtin' | 'plugin' = 'builtin'
): ChannelAdapterConfig => ({
  channelId: 'default',
  channelType,
  agentId: 'deepchat',
  channelConfig: {},
  source,
  configSignature: `${source}:${channelType}`
})

describe('ChannelManager', () => {
  it('creates adapters from both builtin and plugin registries', async () => {
    const registry = new AdapterRegistry()
    const builtinFactory: ChannelFactory = {
      source: 'builtin',
      channelType: 'telegram',
      create: (config) =>
        new FakeAdapter(
          config.channelType,
          config.channelId,
          config.agentId,
          config.configSignature
        )
    }
    const pluginFactory: ChannelFactory = {
      source: 'plugin',
      channelType: 'custom-im',
      create: (config) =>
        new FakeAdapter(
          config.channelType,
          config.channelId,
          config.agentId,
          config.configSignature
        )
    }

    registry.registerFactory(builtinFactory)
    registry.registerFactory(pluginFactory)

    const manager = new ChannelManager(registry)
    const builtinAdapter = await manager.createAdapter(createConfig('telegram'))
    const pluginAdapter = await manager.createAdapter(createConfig('custom-im', 'plugin'))

    expect(builtinAdapter.channelType).toBe('telegram')
    expect(pluginAdapter.channelType).toBe('custom-im')
  })

  it('tracks adapter status and dispatches stream hooks', async () => {
    const manager = new ChannelManager()
    const adapter = new FakeAdapter('telegram', 'default', 'deepchat')
    manager.registerAdapter(adapter)

    adapter.emit('statusChange', {
      channelId: 'default',
      channelType: 'telegram',
      connected: true,
      state: 'running',
      lastError: null,
      botUser: { id: 1 }
    })

    expect(manager.getStatusSnapshot('telegram', 'default')).toEqual({
      connected: true,
      state: 'running',
      lastError: null,
      botUser: { id: 1 }
    })

    await manager.dispatchTextUpdate('telegram', 'default', '100:0', 'draft')
    await manager.dispatchStreamComplete('telegram', 'default', '100:0', 'final')
    await manager.dispatchStreamError('telegram', 'default', '100:0', 'boom')

    expect(adapter.onTextUpdate).toHaveBeenCalledWith('100:0', 'draft')
    expect(adapter.onStreamComplete).toHaveBeenCalledWith('100:0', 'final')
    expect(adapter.onStreamError).toHaveBeenCalledWith('100:0', 'boom')
  })

  it('unregisters adapters and disconnects them', async () => {
    const manager = new ChannelManager()
    const adapter = new FakeAdapter('telegram', 'default', 'deepchat')
    manager.registerAdapter(adapter)

    await manager.unregisterAdapter('telegram', 'default')

    expect(adapter.disconnect).toHaveBeenCalledTimes(1)
    expect(manager.getAdapter('telegram', 'default')).toBeNull()
    expect(manager.getStatusSnapshot('telegram', 'default')).toBeNull()
  })
})
