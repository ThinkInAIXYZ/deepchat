import type {
  ChannelAdapterConfig,
  ChannelFactory,
  ChannelStatusSnapshot,
  IChannelAdapter
} from './types/channel'

type ChannelManagerHandlers = {
  onMessage?: (adapter: IChannelAdapter, event: unknown) => Promise<void> | void
  onCommand?: (adapter: IChannelAdapter, event: unknown) => Promise<void> | void
}

const factoryKey = (channelType: string, source: string): string => `${source}:${channelType}`
const adapterKey = (channelType: string, channelId: string): string => `${channelType}:${channelId}`

export class AdapterRegistry {
  private readonly factories = new Map<string, ChannelFactory>()

  registerFactory(factory: ChannelFactory): void {
    this.factories.set(factoryKey(factory.channelType, factory.source), factory)
  }

  unregisterFactory(channelType: string, source: string = 'builtin'): void {
    this.factories.delete(factoryKey(channelType, source))
  }

  getFactory(channelType: string, source: string = 'builtin'): ChannelFactory | null {
    return this.factories.get(factoryKey(channelType, source)) ?? null
  }

  listFactories(): ChannelFactory[] {
    return [...this.factories.values()]
  }
}

export class ChannelManager {
  private readonly adapters = new Map<string, IChannelAdapter>()
  private readonly statusSnapshots = new Map<string, ChannelStatusSnapshot>()
  private readonly listenerCleanup = new Map<string, () => void>()

  constructor(
    private readonly registry: AdapterRegistry = new AdapterRegistry(),
    private readonly handlers: ChannelManagerHandlers = {}
  ) {}

  registerFactory(factory: ChannelFactory): void {
    this.registry.registerFactory(factory)
  }

  unregisterFactory(channelType: string, source: string = 'builtin'): void {
    this.registry.unregisterFactory(channelType, source)
  }

  getFactory(channelType: string, source: string = 'builtin'): ChannelFactory | null {
    return this.registry.getFactory(channelType, source)
  }

  async createAdapter(config: ChannelAdapterConfig): Promise<IChannelAdapter> {
    const factory = this.registry.getFactory(config.channelType, config.source ?? 'builtin')
    if (!factory) {
      throw new Error(
        `No channel factory is registered for ${config.source ?? 'builtin'}:${config.channelType}.`
      )
    }

    return await factory.create(config)
  }

  registerAdapter(adapter: IChannelAdapter): void {
    const key = adapterKey(adapter.channelType, adapter.channelId)
    if (this.adapters.has(key)) {
      throw new Error(`Channel adapter "${key}" is already registered.`)
    }

    const handleStatusChange = (
      snapshot: ChannelStatusSnapshot & {
        channelId?: string
        channelType?: string
      }
    ) => {
      this.statusSnapshots.set(key, {
        connected: snapshot.connected,
        state: snapshot.state,
        lastError: snapshot.lastError,
        botUser: snapshot.botUser
      })
    }
    const handleMessage = (event: unknown) => {
      return this.handlers.onMessage?.(adapter, event)
    }
    const handleCommand = (event: unknown) => {
      return this.handlers.onCommand?.(adapter, event)
    }

    adapter.on('statusChange', handleStatusChange)
    adapter.on('message', handleMessage)
    adapter.on('command', handleCommand)

    this.adapters.set(key, adapter)
    this.statusSnapshots.set(key, adapter.getStatusSnapshot())
    this.listenerCleanup.set(key, () => {
      adapter.off('statusChange', handleStatusChange)
      adapter.off('message', handleMessage)
      adapter.off('command', handleCommand)
    })
  }

  async unregisterAdapter(channelType: string, channelId: string): Promise<void> {
    const key = adapterKey(channelType, channelId)
    const adapter = this.adapters.get(key)
    if (!adapter) {
      return
    }

    this.listenerCleanup.get(key)?.()
    this.listenerCleanup.delete(key)
    this.adapters.delete(key)
    this.statusSnapshots.delete(key)
    await adapter.disconnect()
  }

  getAdapter(channelType: string, channelId: string): IChannelAdapter | null {
    return this.adapters.get(adapterKey(channelType, channelId)) ?? null
  }

  getStatusSnapshot(channelType: string, channelId: string): ChannelStatusSnapshot | null {
    const snapshot = this.statusSnapshots.get(adapterKey(channelType, channelId))
    return snapshot ? { ...snapshot } : null
  }

  async connectAll(): Promise<void> {
    await Promise.all([...this.adapters.values()].map(async (adapter) => await adapter.connect()))
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      [...this.adapters.values()].map(async (adapter) => await adapter.disconnect())
    )
  }

  async unregisterAll(): Promise<void> {
    const keys = [...this.adapters.keys()].map((key) => {
      const [channelType, ...channelIdParts] = key.split(':')
      return {
        channelType,
        channelId: channelIdParts.join(':')
      }
    })

    for (const key of keys) {
      await this.unregisterAdapter(key.channelType, key.channelId)
    }
  }

  getStatus(): Record<string, { connected: boolean; state: string; error?: string }> {
    return Object.fromEntries(
      [...this.statusSnapshots.entries()].map(([key, snapshot]) => [
        key,
        {
          connected: snapshot.connected,
          state: snapshot.state,
          ...(snapshot.lastError ? { error: snapshot.lastError } : {})
        }
      ])
    )
  }

  async dispatchTextUpdate(
    channelType: string,
    channelId: string,
    chatId: string,
    fullText: string
  ): Promise<void> {
    const adapter = this.getAdapter(channelType, channelId)
    if (!adapter) {
      return
    }

    await adapter.onTextUpdate(chatId, fullText)
  }

  async dispatchStreamComplete(
    channelType: string,
    channelId: string,
    chatId: string,
    finalText: string
  ): Promise<boolean> {
    const adapter = this.getAdapter(channelType, channelId)
    if (!adapter) {
      return false
    }

    return await adapter.onStreamComplete(chatId, finalText)
  }

  async dispatchStreamError(
    channelType: string,
    channelId: string,
    chatId: string,
    error: string
  ): Promise<void> {
    const adapter = this.getAdapter(channelType, channelId)
    if (!adapter) {
      return
    }

    await adapter.onStreamError(chatId, error)
  }
}
