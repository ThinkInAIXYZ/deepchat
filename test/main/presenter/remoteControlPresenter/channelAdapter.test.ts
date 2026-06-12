import { describe, expect, it, vi } from 'vitest'
import { ChannelAdapter } from '@/presenter/remoteControlPresenter/channelAdapter'
import type {
  ChannelAdapterConfig,
  SendMessageOptions
} from '@/presenter/remoteControlPresenter/types/channel'

class TestChannelAdapter extends ChannelAdapter {
  readonly performConnectSpy = vi.fn(async () => {
    this.setStatus({
      connected: true,
      state: 'running',
      lastError: null
    })
  })
  readonly performDisconnectSpy = vi.fn(async () => {
    this.setStatus({
      connected: false,
      state: 'stopped'
    })
  })
  readonly sendMessage = vi.fn(
    async (_chatId: string, _text: string, _opts?: SendMessageOptions) => {}
  )
  readonly sendTypingIndicator = vi.fn(async (_chatId: string) => {})

  protected async performConnect(_signal: AbortSignal): Promise<void> {
    await this.performConnectSpy()
  }

  protected async performDisconnect(): Promise<void> {
    await this.performDisconnectSpy()
  }
}

const createConfig = (): ChannelAdapterConfig => ({
  channelId: 'default',
  channelType: 'telegram',
  agentId: 'deepchat',
  channelConfig: {},
  source: 'builtin'
})

describe('ChannelAdapter', () => {
  it('connects idempotently and exposes status snapshots', async () => {
    const adapter = new TestChannelAdapter(createConfig())
    const statusChange = vi.fn()
    adapter.on('statusChange', statusChange)

    await Promise.all([adapter.connect(), adapter.connect()])

    expect(adapter.performConnectSpy).toHaveBeenCalledTimes(1)
    expect(adapter.connected).toBe(true)
    expect(adapter.getStatusSnapshot()).toEqual(
      expect.objectContaining({
        connected: true,
        state: 'running',
        lastError: null
      })
    )
    expect(statusChange).toHaveBeenCalled()
  })

  it('disconnects idempotently', async () => {
    const adapter = new TestChannelAdapter(createConfig())
    await adapter.connect()

    await Promise.all([adapter.disconnect(), adapter.disconnect()])

    expect(adapter.performDisconnectSpy).toHaveBeenCalledTimes(1)
    expect(adapter.connected).toBe(false)
    expect(adapter.getStatusSnapshot()).toEqual(
      expect.objectContaining({
        connected: false,
        state: 'stopped'
      })
    )
  })

  it('marks status as error when connect fails', async () => {
    const adapter = new TestChannelAdapter(createConfig())
    adapter.performConnectSpy.mockRejectedValueOnce(new Error('connect failed'))

    await expect(adapter.connect()).rejects.toThrow('connect failed')
    expect(adapter.connected).toBe(false)
    expect(adapter.getStatusSnapshot()).toEqual(
      expect.objectContaining({
        connected: false,
        state: 'error',
        lastError: 'connect failed'
      })
    )
  })
})
