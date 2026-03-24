import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

type SetupOptions = {
  settings?: {
    botToken: string
    remoteEnabled: boolean
    allowedUserIds: number[]
    defaultAgentId: string
    hookNotifications: {
      enabled: boolean
      chatId: string
      threadId?: string
      events: string[]
    }
  }
  status?: {
    enabled: boolean
    state: 'disabled' | 'stopped' | 'starting' | 'running' | 'backoff' | 'error'
    pollOffset?: number
    bindingCount?: number
    allowedUserCount?: number
    lastError?: string | null
    botUser?: { id: number; username?: string } | null
  }
  pairingSnapshot?: {
    pairCode: string | null
    pairCodeExpiresAt: number | null
    allowedUserIds: number[]
  }
  bindings?: Array<{
    endpointKey: string
    sessionId: string
    chatId: number
    messageThreadId: number
    updatedAt: number
  }>
  agents?: Array<{
    id: string
    name: string
    type: 'deepchat' | 'acp'
    enabled: boolean
  }>
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()
  vi.useFakeTimers()

  const remoteState = reactive({
    settings: {
      botToken: 'telegram-token',
      remoteEnabled: false,
      allowedUserIds: [123],
      defaultAgentId: 'deepchat',
      hookNotifications: {
        enabled: false,
        chatId: '',
        threadId: '',
        events: []
      },
      ...options.settings
    },
    status: {
      enabled: options.settings?.remoteEnabled ?? false,
      state: 'disabled' as const,
      pollOffset: 0,
      bindingCount: 0,
      allowedUserCount: options.settings?.allowedUserIds?.length ?? 1,
      lastError: null,
      botUser: null,
      ...options.status
    },
    pairingSnapshot: {
      pairCode: null,
      pairCodeExpiresAt: null,
      allowedUserIds: options.settings?.allowedUserIds ?? [123],
      ...options.pairingSnapshot
    },
    bindings: [...(options.bindings ?? [])]
  })

  const remoteControlPresenter = {
    getTelegramSettings: vi.fn(async () => ({
      ...remoteState.settings,
      hookNotifications: {
        ...remoteState.settings.hookNotifications
      }
    })),
    saveTelegramSettings: vi.fn(async (nextSettings) => {
      remoteState.settings = {
        ...nextSettings,
        hookNotifications: {
          ...nextSettings.hookNotifications
        }
      }
      remoteState.status.enabled = nextSettings.remoteEnabled
      remoteState.status.allowedUserCount = nextSettings.allowedUserIds.length
      remoteState.pairingSnapshot.allowedUserIds = [...nextSettings.allowedUserIds]
      return {
        ...remoteState.settings,
        hookNotifications: {
          ...remoteState.settings.hookNotifications
        }
      }
    }),
    getTelegramStatus: vi.fn(async () => ({
      ...remoteState.status
    })),
    createTelegramPairCode: vi.fn(async () => {
      remoteState.pairingSnapshot.pairCode = '654321'
      remoteState.pairingSnapshot.pairCodeExpiresAt = 123456789
      return {
        code: '654321',
        expiresAt: 123456789
      }
    }),
    clearTelegramPairCode: vi.fn(async () => {
      remoteState.pairingSnapshot.pairCode = null
      remoteState.pairingSnapshot.pairCodeExpiresAt = null
    }),
    getTelegramPairingSnapshot: vi.fn(async () => ({
      ...remoteState.pairingSnapshot,
      allowedUserIds: [...remoteState.pairingSnapshot.allowedUserIds]
    })),
    getTelegramBindings: vi.fn(async () => [...remoteState.bindings]),
    removeTelegramBinding: vi.fn(async (endpointKey: string) => {
      remoteState.bindings = remoteState.bindings.filter(
        (binding) => binding.endpointKey !== endpointKey
      )
      remoteState.status.bindingCount = remoteState.bindings.length
    }),
    testTelegramHookNotification: vi.fn(async () => ({
      success: true,
      durationMs: 10
    }))
  }

  const newAgentPresenter = {
    getAgents: vi.fn(async () => [
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'deepchat-alt', name: 'DeepChat Alt', type: 'deepchat', enabled: false },
      { id: 'acp-agent', name: 'ACP Agent', type: 'acp', enabled: true },
      ...(options.agents ?? [])
    ])
  }

  const toast = vi.fn()

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) =>
      name === 'remoteControlPresenter' ? remoteControlPresenter : newAgentPresenter
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (!params) {
          return key
        }

        return Object.entries(params).reduce(
          (message, [paramKey, value]) => message.replace(`{${paramKey}}`, String(value)),
          key
        )
      }
    })
  }))

  const passthrough = defineComponent({
    template: '<div><slot /></div>'
  })

  const inputStub = defineComponent({
    props: {
      modelValue: {
        type: String,
        default: ''
      }
    },
    emits: ['update:modelValue', 'blur'],
    template:
      '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" />'
  })

  const switchStub = defineComponent({
    props: {
      modelValue: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:modelValue'],
    template:
      '<input v-bind="$attrs" type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  })

  const checkboxStub = defineComponent({
    props: {
      checked: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:checked'],
    template:
      '<input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" />'
  })

  const buttonStub = defineComponent({
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
  })

  const dialogStub = defineComponent({
    props: {
      open: {
        type: Boolean,
        default: false
      }
    },
    template: '<div v-if="open"><slot /></div>'
  })

  const RemoteSettings = (
    await import('../../../src/renderer/settings/components/RemoteSettings.vue')
  ).default
  const wrapper = mount(RemoteSettings, {
    global: {
      stubs: {
        ScrollArea: passthrough,
        Label: passthrough,
        Select: passthrough,
        SelectTrigger: passthrough,
        SelectValue: passthrough,
        SelectContent: passthrough,
        SelectItem: passthrough,
        Dialog: dialogStub,
        DialogContent: passthrough,
        DialogHeader: passthrough,
        DialogTitle: passthrough,
        DialogDescription: passthrough,
        Button: buttonStub,
        Input: inputStub,
        Switch: switchStub,
        Checkbox: checkboxStub,
        Icon: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    remoteState,
    remoteControlPresenter,
    newAgentPresenter,
    toast
  }
}

describe('RemoteSettings', () => {
  it('hides remote and hook details when both toggles are disabled', async () => {
    const { wrapper } = await setup({
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: false,
        allowedUserIds: [123],
        defaultAgentId: 'deepchat',
        hookNotifications: {
          enabled: false,
          chatId: '',
          threadId: '',
          events: []
        }
      }
    })

    expect(wrapper.find('[data-testid="remote-control-details"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remote-hooks-details"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.remote.remoteControl.streamMode')
  })

  it('opens the pair dialog and closes it after pairing succeeds', async () => {
    const { wrapper, remoteState, remoteControlPresenter, toast } = await setup({
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        allowedUserIds: [123],
        defaultAgentId: 'deepchat',
        hookNotifications: {
          enabled: false,
          chatId: '',
          threadId: '',
          events: []
        }
      }
    })

    await wrapper.find('[data-testid="remote-pair-button"]').trigger('click')
    await flushPromises()

    expect(remoteControlPresenter.createTelegramPairCode).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="remote-pair-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('/pair 654321')

    remoteState.pairingSnapshot = {
      pairCode: null,
      pairCodeExpiresAt: null,
      allowedUserIds: [123, 456]
    }

    await vi.advanceTimersByTimeAsync(2_000)
    await flushPromises()

    expect(wrapper.find('[data-testid="remote-pair-dialog"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remote-allowed-user-ids-input"]').element).toHaveProperty(
      'value',
      '123, 456'
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.remote.remoteControl.pairingSuccessTitle'
      })
    )
  })

  it('lists only enabled deepchat agents in the default agent selector area', async () => {
    const { wrapper } = await setup({
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        allowedUserIds: [123],
        defaultAgentId: 'deepchat',
        hookNotifications: {
          enabled: false,
          chatId: '',
          threadId: '',
          events: []
        }
      }
    })

    expect(wrapper.text()).toContain('DeepChat')
    expect(wrapper.text()).not.toContain('DeepChat Alt')
    expect(wrapper.text()).not.toContain('ACP Agent')
  })

  it('opens the bindings dialog and removes a binding from the list', async () => {
    const { wrapper, remoteControlPresenter } = await setup({
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        allowedUserIds: [123],
        defaultAgentId: 'deepchat',
        hookNotifications: {
          enabled: false,
          chatId: '',
          threadId: '',
          events: []
        }
      },
      status: {
        enabled: true,
        state: 'running',
        bindingCount: 1
      },
      bindings: [
        {
          endpointKey: 'telegram:100:0',
          sessionId: 'session-1',
          chatId: 100,
          messageThreadId: 0,
          updatedAt: 1
        }
      ]
    })

    await wrapper.find('[data-testid="remote-bindings-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="remote-bindings-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('session-1')

    const deleteButton = wrapper
      .find('[data-testid="remote-binding-telegram:100:0"]')
      .find('button')

    await deleteButton.trigger('click')
    await flushPromises()

    expect(remoteControlPresenter.removeTelegramBinding).toHaveBeenCalledWith('telegram:100:0')
    expect(wrapper.find('[data-testid="remote-bindings-empty"]').exists()).toBe(true)
  })
})
