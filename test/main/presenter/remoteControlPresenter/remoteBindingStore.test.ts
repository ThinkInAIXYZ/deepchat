import { describe, expect, it, vi } from 'vitest'
import { RemoteBindingStore } from '@/presenter/remoteControlPresenter/services/remoteBindingStore'

const createConfigPresenter = () => {
  const store = new Map<string, unknown>()
  return {
    getSetting: vi.fn((key: string) => store.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
    })
  }
}

describe('RemoteBindingStore', () => {
  it('persists endpoint bindings through config storage', () => {
    const configPresenter = createConfigPresenter()
    const firstStore = new RemoteBindingStore(configPresenter as any)

    firstStore.setBinding('telegram:100:0', 'session-1')

    const secondStore = new RemoteBindingStore(configPresenter as any)
    expect(secondStore.getBinding('telegram:100:0')).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        updatedAt: expect.any(Number)
      })
    )
  })

  it('clears bindings and returns the cleared count', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setBinding('telegram:100:0', 'session-1')
    store.setBinding('telegram:200:0', 'session-2')

    expect(store.clearBindings()).toBe(2)
    expect(store.countBindings()).toBe(0)
  })

  it('removes a single binding without touching others', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setBinding('telegram:100:0', 'session-1')
    store.setBinding('telegram:200:0', 'session-2')

    store.clearBinding('telegram:100:0')

    expect(store.getBinding('telegram:100:0')).toBeNull()
    expect(store.getBinding('telegram:200:0')).toEqual(
      expect.objectContaining({
        sessionId: 'session-2',
        updatedAt: expect.any(Number)
      })
    )
  })

  it('stores and restores poll offset', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setPollOffset(42)

    const reloaded = new RemoteBindingStore(configPresenter as any)
    expect(reloaded.getPollOffset()).toBe(42)
  })

  it('normalizes empty defaultAgentId to deepchat while preserving streamMode', () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: false,
        allowlist: [],
        streamMode: 'final',
        defaultAgentId: '  ',
        pollOffset: 0,
        pairing: {
          code: null,
          expiresAt: null
        },
        bindings: {}
      }
    })

    const store = new RemoteBindingStore(configPresenter as any)

    expect(store.getDefaultAgentId()).toBe('deepchat')
    expect(store.getTelegramConfig().streamMode).toBe('final')
  })

  it('migrates legacy root-level telegram config into the nested structure', () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      enabled: true,
      allowlist: ['123', 456],
      streamMode: 'final',
      defaultAgentId: 'legacy-agent',
      pollOffset: 9,
      lastFatalError: 'boom',
      pairing: {
        code: '654321',
        expiresAt: 123
      },
      bindings: {
        'telegram:100:0': {
          sessionId: 'session-1',
          updatedAt: 1
        }
      }
    })

    const store = new RemoteBindingStore(configPresenter as any)

    expect(store.getTelegramConfig()).toEqual(
      expect.objectContaining({
        enabled: true,
        allowlist: [123, 456],
        defaultAgentId: 'legacy-agent',
        pollOffset: 9,
        lastFatalError: 'boom',
        pairing: expect.objectContaining({
          code: '654321',
          expiresAt: 123,
          failedAttempts: 0
        })
      })
    )
    expect(store.getBinding('telegram:100:0')).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        updatedAt: 1
      })
    )
  })

  it('migrates legacy root-level feishu config into the nested structure', () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      appId: 'cli_a',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt',
      enabled: true,
      defaultAgentId: 'deepchat',
      pairedUserOpenIds: ['ou_1', 'ou_2'],
      lastFatalError: 'fatal',
      pairing: {
        code: '123456',
        expiresAt: 456
      },
      bindings: {
        'feishu:oc_x:root': {
          sessionId: 'session-feishu',
          updatedAt: 2
        }
      }
    })

    const store = new RemoteBindingStore(configPresenter as any)

    expect(store.getFeishuConfig()).toEqual(
      expect.objectContaining({
        appId: 'cli_a',
        appSecret: 'secret',
        verificationToken: 'verify',
        encryptKey: 'encrypt',
        enabled: true,
        pairedUserOpenIds: ['ou_1', 'ou_2'],
        lastFatalError: 'fatal',
        pairing: expect.objectContaining({
          code: '123456',
          expiresAt: 456,
          failedAttempts: 0
        })
      })
    )
    expect(store.getBinding('feishu:oc_x:root')).toEqual(
      expect.objectContaining({
        sessionId: 'session-feishu',
        updatedAt: 2
      })
    )
  })

  it('removes authorized principals without touching other entries', () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: true,
        allowlist: [123, 456],
        streamMode: 'draft',
        defaultAgentId: 'deepchat',
        pollOffset: 0,
        pairing: {
          code: null,
          expiresAt: null
        },
        bindings: {}
      },
      feishu: {
        appId: 'cli_a',
        appSecret: 'secret',
        verificationToken: 'verify',
        encryptKey: 'encrypt',
        enabled: true,
        defaultAgentId: 'deepchat',
        pairedUserOpenIds: ['ou_1', 'ou_2'],
        lastFatalError: null,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        },
        bindings: {}
      },
      qqbot: {
        appId: 'app-1',
        clientSecret: 'secret',
        enabled: true,
        defaultAgentId: 'deepchat',
        pairedUserIds: ['user_openid_1', 'user_openid_2'],
        pairedGroupIds: [],
        lastFatalError: null,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        },
        bindings: {}
      }
    })

    const store = new RemoteBindingStore(configPresenter as any)

    store.removeAllowedUser(456)
    store.removeFeishuPairedUser('ou_2')
    store.removeQQBotPairedUser('user_openid_2')

    expect(store.getAllowedUserIds()).toEqual([123])
    expect(store.getFeishuPairedUserOpenIds()).toEqual(['ou_1'])
    expect(store.getQQBotPairedUserIds()).toEqual(['user_openid_1'])
  })

  it('keeps valid bindings when another binding is malformed', () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: true,
        allowlist: [123],
        streamMode: 'draft',
        defaultAgentId: 'deepchat',
        pollOffset: 7,
        pairing: {
          code: null,
          expiresAt: null
        },
        bindings: {
          'telegram:100:0': {
            sessionId: 'session-1',
            updatedAt: 1
          },
          'telegram:200:0': {
            sessionId: 123
          }
        }
      }
    })

    const store = new RemoteBindingStore(configPresenter as any)

    expect(store.getPollOffset()).toBe(7)
    expect(store.getBinding('telegram:100:0')).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        updatedAt: 1
      })
    )
    expect(store.getBinding('telegram:200:0')).toBeNull()
  })

  it('keeps model menus in memory and clears them after rebinding the endpoint', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    const token = store.createModelMenuState('telegram:100:0', 'session-1', [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [{ modelId: 'gpt-5', modelName: 'GPT-5' }]
      }
    ])

    expect(store.getModelMenuState(token, 10 * 60 * 1000)).toEqual(
      expect.objectContaining({
        endpointKey: 'telegram:100:0',
        sessionId: 'session-1'
      })
    )

    store.setBinding('telegram:100:0', 'session-2')

    expect(store.getModelMenuState(token, 10 * 60 * 1000)).toBeNull()
  })

  it('keeps pending interaction tokens in memory and clears them after rebinding the endpoint', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    const token = store.createPendingInteractionState('telegram:100:0', {
      messageId: 'assistant-1',
      toolCallId: 'tool-1'
    })

    expect(store.getPendingInteractionState(token)).toEqual(
      expect.objectContaining({
        endpointKey: 'telegram:100:0',
        messageId: 'assistant-1',
        toolCallId: 'tool-1'
      })
    )

    store.setBinding('telegram:100:0', 'session-2')

    expect(store.getPendingInteractionState(token)).toBeNull()
  })

  it('keeps remote delivery state in memory and clears it after rebinding the endpoint', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.rememberRemoteDeliveryState('telegram:100:0', {
      sourceMessageId: 'msg-1',
      segments: [
        {
          key: 'msg-1:0:process',
          kind: 'process',
          messageIds: [100],
          lastText: '💻 shell_command: "git status"'
        },
        {
          key: 'msg-1:1:answer',
          kind: 'answer',
          messageIds: [101],
          lastText: 'Draft answer'
        }
      ]
    })

    expect(store.getRemoteDeliveryState('telegram:100:0')).toEqual({
      sourceMessageId: 'msg-1',
      segments: [
        {
          key: 'msg-1:0:process',
          kind: 'process',
          messageIds: [100],
          lastText: '💻 shell_command: "git status"'
        },
        {
          key: 'msg-1:1:answer',
          kind: 'answer',
          messageIds: [101],
          lastText: 'Draft answer'
        }
      ]
    })

    store.setBinding('telegram:100:0', 'session-2')

    expect(store.getRemoteDeliveryState('telegram:100:0')).toBeNull()
  })

  it('normalizes binding meta channel from the endpoint key', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    store.setBinding('telegram:100:0', 'session-1', {
      channel: 'feishu',
      kind: 'dm',
      chatId: '100',
      threadId: null
    })

    expect(store.getBinding('telegram:100:0')).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        meta: expect.objectContaining({
          channel: 'telegram'
        })
      })
    )

    store.clearBinding('telegram:100:0')

    expect(store.getBinding('telegram:100:0')).toBeNull()
  })

  it('expires a pairing code after too many failures and resets failures for a new code', () => {
    const configPresenter = createConfigPresenter()
    const store = new RemoteBindingStore(configPresenter as any)

    const pairing = store.createPairCode('telegram')

    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(store.recordPairCodeFailure('telegram', 5)).toEqual({
        attempts: attempt,
        exhausted: false
      })
    }

    expect(store.getTelegramPairingState()).toEqual(
      expect.objectContaining({
        code: pairing.code,
        failedAttempts: 4
      })
    )

    expect(store.recordPairCodeFailure('telegram', 5)).toEqual({
      attempts: 5,
      exhausted: true
    })
    expect(store.getTelegramPairingState()).toEqual({
      code: null,
      expiresAt: null,
      failedAttempts: 0
    })

    store.createPairCode('telegram')

    expect(store.getTelegramPairingState().failedAttempts).toBe(0)
  })
})
