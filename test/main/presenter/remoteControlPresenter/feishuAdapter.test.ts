import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeishuRuntimeStatusSnapshot } from '@/presenter/remoteControlPresenter/types'

type MockRuntimeDeps = {
  onStatusChange?: (snapshot: FeishuRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

const runtimeInstances: Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  getStatusSnapshot: ReturnType<typeof vi.fn>
  deps: MockRuntimeDeps
}> = []
const clientInstances: Array<{
  sendText: ReturnType<typeof vi.fn>
}> = []

vi.mock('@/presenter/remoteControlPresenter/feishu/feishuRuntime', () => ({
  FeishuRuntime: class MockFeishuRuntime {
    readonly start = vi.fn(async () => {
      this.deps.onStatusChange?.({
        state: 'running',
        lastError: null,
        botUser: {
          openId: 'ou_bot',
          name: 'DeepChat Bot'
        }
      })
    })
    readonly stop = vi.fn().mockResolvedValue(undefined)
    readonly getStatusSnapshot = vi.fn().mockReturnValue({
      state: 'stopped',
      lastError: null,
      botUser: null
    })

    constructor(readonly deps: MockRuntimeDeps) {
      runtimeInstances.push(this)
    }
  }
}))

vi.mock('@/presenter/remoteControlPresenter/feishu/feishuClient', () => ({
  FeishuClient: class MockFeishuClient {
    readonly sendText = vi.fn().mockResolvedValue('om_1')

    constructor(_credentials: unknown) {
      clientInstances.push(this)
    }
  }
}))

import { FeishuAdapter } from '@/presenter/remoteControlPresenter/adapters/feishu/FeishuAdapter'

describe('FeishuAdapter', () => {
  beforeEach(() => {
    runtimeInstances.length = 0
    clientInstances.length = 0
  })

  it('starts the wrapped feishu runtime', async () => {
    const adapter = new FeishuAdapter(
      {
        channelId: 'default',
        channelType: 'feishu',
        agentId: 'deepchat',
        channelConfig: {
          appId: 'cli_a',
          appSecret: 'secret',
          verificationToken: 'verify',
          encryptKey: 'encrypt'
        },
        configSignature: 'feishu:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any
      }
    )

    await adapter.connect()

    expect(runtimeInstances).toHaveLength(1)
    expect(runtimeInstances[0].start).toHaveBeenCalledTimes(1)
    expect(adapter.getStatusSnapshot()).toEqual(
      expect.objectContaining({
        connected: true,
        state: 'running'
      })
    )
  })

  it('forwards fatal errors from the wrapped runtime', async () => {
    const onFatalError = vi.fn().mockResolvedValue(undefined)
    const adapter = new FeishuAdapter(
      {
        channelId: 'default',
        channelType: 'feishu',
        agentId: 'deepchat',
        channelConfig: {
          appId: 'cli_a',
          appSecret: 'secret',
          verificationToken: 'verify',
          encryptKey: 'encrypt'
        },
        configSignature: 'feishu:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any,
        onFatalError
      }
    )

    await adapter.connect()
    runtimeInstances[0].deps.onFatalError?.('fatal feishu error')

    expect(onFatalError).toHaveBeenCalledWith('fatal feishu error')
  })
})
