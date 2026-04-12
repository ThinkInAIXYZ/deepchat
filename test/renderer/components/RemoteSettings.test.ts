import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, inject, provide, reactive, ref, watch, type Ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

type SetupOptions = {
  settings?: {
    botToken: string
    remoteEnabled: boolean
    defaultAgentId: string
    hookNotifications: {
      enabled: boolean
      chatId: string
      threadId?: string
      events: string[]
    }
  }
  telegramChannelSettingsOverride?: Record<string, unknown>
  feishuChannelSettingsOverride?: Record<string, unknown>
  qqbotChannelSettingsOverride?: Record<string, unknown>
  discordChannelSettingsOverride?: Record<string, unknown>
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
  recentProjects?: Array<{
    name: string
    path: string
    icon?: string | null
  }>
  selectedDirectory?: string | null
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
      allowedUserCount: options.pairingSnapshot?.allowedUserIds?.length ?? 1,
      lastError: null,
      botUser: null,
      ...options.status
    },
    pairingSnapshot: {
      pairCode: null,
      pairCodeExpiresAt: null,
      allowedUserIds: options.pairingSnapshot?.allowedUserIds ?? [123],
      ...options.pairingSnapshot
    },
    bindings: [...(options.bindings ?? [])]
  })

  const feishuState = reactive({
    settings: {
      brand: 'feishu' as const,
      appId: '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: '',
      pairedUserOpenIds: [] as string[]
    },
    status: {
      channel: 'feishu' as const,
      enabled: false,
      state: 'disabled' as const,
      bindingCount: 0,
      pairedUserCount: 0,
      lastError: null,
      botUser: null
    },
    pairingSnapshot: {
      pairCode: null,
      pairCodeExpiresAt: null,
      pairedUserOpenIds: [] as string[]
    },
    bindings: [] as Array<{
      channel: 'feishu'
      endpointKey: string
      sessionId: string
      chatId: string
      threadId: string | null
      kind: 'dm' | 'group' | 'topic'
      updatedAt: number
    }>
  })

  const qqbotState = reactive({
    settings: {
      appId: '',
      clientSecret: '',
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: '',
      pairedUserIds: [] as string[]
    },
    status: {
      channel: 'qqbot' as const,
      enabled: false,
      state: 'disabled' as const,
      bindingCount: 0,
      pairedUserCount: 0,
      lastError: null,
      botUser: null
    },
    pairingSnapshot: {
      pairCode: null,
      pairCodeExpiresAt: null,
      pairedUserIds: [] as string[]
    },
    bindings: [] as Array<{
      channel: 'qqbot'
      endpointKey: string
      sessionId: string
      chatId: string
      threadId: string | null
      kind: 'dm' | 'group' | 'topic'
      updatedAt: number
    }>
  })

  const discordState = reactive({
    settings: {
      botToken: '',
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: '',
      pairedChannelIds: [] as string[]
    },
    status: {
      channel: 'discord' as const,
      enabled: false,
      state: 'disabled' as const,
      bindingCount: 0,
      pairedChannelCount: 0,
      lastError: null,
      botUser: null
    },
    pairingSnapshot: {
      pairCode: null,
      pairCodeExpiresAt: null,
      pairedChannelIds: [] as string[]
    },
    bindings: [] as Array<{
      channel: 'discord'
      endpointKey: string
      sessionId: string
      chatId: string
      threadId: string | null
      kind: 'dm' | 'group' | 'topic'
      updatedAt: number
    }>
  })

  const weixinIlinkState = reactive({
    settings: {
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: '',
      accounts: [] as Array<{
        accountId: string
        ownerUserId: string
        baseUrl: string
        enabled: boolean
      }>
    },
    status: {
      channel: 'weixin-ilink' as const,
      enabled: false,
      state: 'disabled' as const,
      bindingCount: 0,
      accountCount: 0,
      connectedAccountCount: 0,
      lastError: null,
      accounts: [] as Array<{
        accountId: string
        ownerUserId: string
        baseUrl: string
        enabled: boolean
        state: 'disabled' | 'stopped' | 'starting' | 'running' | 'backoff' | 'error'
        connected: boolean
        bindingCount: number
        lastError: string | null
      }>
    }
  })

  const telegramSettingsSnapshot = () => {
    const snapshot = {
      ...remoteState.settings,
      ...(options.telegramChannelSettingsOverride ?? {})
    } as Record<string, unknown>

    if (
      !Object.prototype.hasOwnProperty.call(
        options.telegramChannelSettingsOverride ?? {},
        'hookNotifications'
      )
    ) {
      snapshot.hookNotifications = {
        ...remoteState.settings.hookNotifications
      }
    }

    return snapshot
  }

  const feishuSettingsSnapshot = () => ({
    ...feishuState.settings,
    ...(options.feishuChannelSettingsOverride ?? {})
  })

  const qqbotSettingsSnapshot = () => ({
    ...qqbotState.settings,
    ...(options.qqbotChannelSettingsOverride ?? {})
  })

  const discordSettingsSnapshot = () => ({
    ...discordState.settings,
    ...(options.discordChannelSettingsOverride ?? {})
  })

  const weixinIlinkSettingsSnapshot = () => ({
    ...weixinIlinkState.settings,
    accounts: [...weixinIlinkState.settings.accounts]
  })

  const syncWeixinIlinkStatusFromSettings = () => {
    weixinIlinkState.status.enabled = weixinIlinkState.settings.remoteEnabled
    weixinIlinkState.status.accountCount = weixinIlinkState.settings.accounts.length
    weixinIlinkState.status.accounts = weixinIlinkState.settings.accounts.map((account) => ({
      ...account,
      state: weixinIlinkState.settings.remoteEnabled && account.enabled ? 'running' : 'disabled',
      connected: Boolean(weixinIlinkState.settings.remoteEnabled && account.enabled),
      bindingCount: 0,
      lastError: null
    }))
    weixinIlinkState.status.connectedAccountCount = weixinIlinkState.status.accounts.filter(
      (account) => account.connected
    ).length
    weixinIlinkState.status.bindingCount = weixinIlinkState.status.accounts.reduce(
      (total, account) => total + account.bindingCount,
      0
    )
    weixinIlinkState.status.state =
      weixinIlinkState.status.connectedAccountCount > 0
        ? 'running'
        : weixinIlinkState.status.enabled
          ? 'stopped'
          : 'disabled'
  }

  syncWeixinIlinkStatusFromSettings()

  const remoteControlPresenter = {
    listRemoteChannels: vi.fn(async () => [
      { id: 'telegram', implemented: true },
      { id: 'feishu', implemented: true },
      { id: 'qqbot', implemented: true },
      { id: 'discord', implemented: true },
      { id: 'weixin-ilink', implemented: true }
    ]),
    getChannelSettings: vi.fn(
      async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink') => {
        if (channel === 'telegram') {
          return telegramSettingsSnapshot()
        }

        if (channel === 'feishu') {
          return feishuSettingsSnapshot()
        }

        if (channel === 'qqbot') {
          return qqbotSettingsSnapshot()
        }

        if (channel === 'discord') {
          return discordSettingsSnapshot()
        }

        return weixinIlinkSettingsSnapshot()
      }
    ),
    saveChannelSettings: vi.fn(
      async (
        channel: 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink',
        nextSettings: any
      ) => {
        if (channel === 'telegram') {
          remoteState.settings = {
            ...nextSettings,
            hookNotifications: {
              ...nextSettings.hookNotifications
            }
          }
          remoteState.status.enabled = nextSettings.remoteEnabled
          return {
            ...remoteState.settings,
            hookNotifications: {
              ...remoteState.settings.hookNotifications
            }
          }
        }

        if (channel === 'feishu') {
          feishuState.settings = { ...nextSettings }
          feishuState.status.enabled = nextSettings.remoteEnabled
          return { ...feishuState.settings }
        }

        if (channel === 'qqbot') {
          qqbotState.settings = { ...nextSettings }
          qqbotState.status.enabled = nextSettings.remoteEnabled
          return { ...qqbotState.settings }
        }

        if (channel === 'discord') {
          discordState.settings = { ...nextSettings }
          discordState.status.enabled = nextSettings.remoteEnabled
          return { ...discordState.settings }
        }

        weixinIlinkState.settings = {
          ...nextSettings,
          accounts: [...nextSettings.accounts]
        }
        syncWeixinIlinkStatusFromSettings()
        return {
          ...weixinIlinkState.settings,
          accounts: [...weixinIlinkState.settings.accounts]
        }
      }
    ),
    getChannelStatus: vi.fn(
      async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink') => {
        if (channel === 'telegram') {
          return {
            channel: 'telegram' as const,
            ...remoteState.status
          }
        }

        if (channel === 'feishu') {
          return {
            ...feishuState.status
          }
        }

        if (channel === 'qqbot') {
          return {
            ...qqbotState.status
          }
        }

        if (channel === 'discord') {
          return {
            ...discordState.status
          }
        }

        return {
          ...weixinIlinkState.status,
          accounts: [...weixinIlinkState.status.accounts]
        }
      }
    ),
    getChannelPairingSnapshot: vi.fn(
      async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord') => {
        if (channel === 'telegram') {
          return {
            ...remoteState.pairingSnapshot,
            allowedUserIds: [...remoteState.pairingSnapshot.allowedUserIds]
          }
        }

        if (channel === 'feishu') {
          return {
            ...feishuState.pairingSnapshot,
            pairedUserOpenIds: [...feishuState.pairingSnapshot.pairedUserOpenIds]
          }
        }

        if (channel === 'discord') {
          return {
            ...discordState.pairingSnapshot,
            pairedChannelIds: [...discordState.pairingSnapshot.pairedChannelIds]
          }
        }

        return {
          ...qqbotState.pairingSnapshot,
          pairedUserIds: [...qqbotState.pairingSnapshot.pairedUserIds]
        }
      }
    ),
    createChannelPairCode: vi.fn(async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord') => {
      if (channel === 'telegram') {
        remoteState.pairingSnapshot.pairCode = '654321'
        remoteState.pairingSnapshot.pairCodeExpiresAt = 123456789
      } else if (channel === 'feishu') {
        feishuState.pairingSnapshot.pairCode = '654321'
        feishuState.pairingSnapshot.pairCodeExpiresAt = 123456789
      } else if (channel === 'discord') {
        discordState.pairingSnapshot.pairCode = '654321'
        discordState.pairingSnapshot.pairCodeExpiresAt = 123456789
      } else {
        qqbotState.pairingSnapshot.pairCode = '654321'
        qqbotState.pairingSnapshot.pairCodeExpiresAt = 123456789
      }
      return {
        code: '654321',
        expiresAt: 123456789
      }
    }),
    clearChannelPairCode: vi.fn(async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord') => {
      if (channel === 'telegram') {
        remoteState.pairingSnapshot.pairCode = null
        remoteState.pairingSnapshot.pairCodeExpiresAt = null
      } else if (channel === 'feishu') {
        feishuState.pairingSnapshot.pairCode = null
        feishuState.pairingSnapshot.pairCodeExpiresAt = null
      } else if (channel === 'discord') {
        discordState.pairingSnapshot.pairCode = null
        discordState.pairingSnapshot.pairCodeExpiresAt = null
      } else {
        qqbotState.pairingSnapshot.pairCode = null
        qqbotState.pairingSnapshot.pairCodeExpiresAt = null
      }
    }),
    getChannelBindings: vi.fn(
      async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink') => {
        if (channel === 'telegram') {
          return remoteState.bindings.map((binding) => ({
            channel: 'telegram' as const,
            endpointKey: binding.endpointKey,
            sessionId: binding.sessionId,
            chatId: String(binding.chatId),
            threadId: binding.messageThreadId ? String(binding.messageThreadId) : null,
            kind: binding.messageThreadId ? 'topic' : 'dm',
            updatedAt: binding.updatedAt
          }))
        }

        if (channel === 'feishu') {
          return [...feishuState.bindings]
        }

        if (channel === 'qqbot') {
          return [...qqbotState.bindings]
        }

        if (channel === 'discord') {
          return [...discordState.bindings]
        }

        return []
      }
    ),
    removeChannelBinding: vi.fn(
      async (
        channel: 'telegram' | 'feishu' | 'qqbot' | 'discord' | 'weixin-ilink',
        endpointKey: string
      ) => {
        if (channel === 'telegram') {
          remoteState.bindings = remoteState.bindings.filter(
            (binding) => binding.endpointKey !== endpointKey
          )
          remoteState.status.bindingCount = remoteState.bindings.length
        } else if (channel === 'feishu') {
          feishuState.bindings = feishuState.bindings.filter(
            (binding) => binding.endpointKey !== endpointKey
          )
          feishuState.status.bindingCount = feishuState.bindings.length
        } else if (channel === 'qqbot') {
          qqbotState.bindings = qqbotState.bindings.filter(
            (binding) => binding.endpointKey !== endpointKey
          )
          qqbotState.status.bindingCount = qqbotState.bindings.length
        } else if (channel === 'discord') {
          discordState.bindings = discordState.bindings.filter(
            (binding) => binding.endpointKey !== endpointKey
          )
          discordState.status.bindingCount = discordState.bindings.length
        }
      }
    ),
    removeChannelPrincipal: vi.fn(
      async (channel: 'telegram' | 'feishu' | 'qqbot' | 'discord', principalId) => {
        if (channel === 'telegram') {
          remoteState.pairingSnapshot.allowedUserIds =
            remoteState.pairingSnapshot.allowedUserIds.filter(
              (value) => String(value) !== principalId
            )
          remoteState.status.allowedUserCount = remoteState.pairingSnapshot.allowedUserIds.length
          return
        }

        if (channel === 'feishu') {
          feishuState.pairingSnapshot.pairedUserOpenIds =
            feishuState.pairingSnapshot.pairedUserOpenIds.filter((value) => value !== principalId)
          feishuState.status.pairedUserCount = feishuState.pairingSnapshot.pairedUserOpenIds.length
          return
        }

        if (channel === 'discord') {
          discordState.pairingSnapshot.pairedChannelIds =
            discordState.pairingSnapshot.pairedChannelIds.filter((value) => value !== principalId)
          discordState.status.pairedChannelCount =
            discordState.pairingSnapshot.pairedChannelIds.length
          return
        }

        qqbotState.pairingSnapshot.pairedUserIds = qqbotState.pairingSnapshot.pairedUserIds.filter(
          (value) => value !== principalId
        )
        qqbotState.status.pairedUserCount = qqbotState.pairingSnapshot.pairedUserIds.length
      }
    ),
    getTelegramSettings: vi.fn(async () => ({
      ...telegramSettingsSnapshot()
    })),
    saveTelegramSettings: vi.fn(async (nextSettings) => {
      remoteState.settings = {
        ...nextSettings,
        hookNotifications: {
          ...nextSettings.hookNotifications
        }
      }
      remoteState.status.enabled = nextSettings.remoteEnabled
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
    startWeixinIlinkLogin: vi.fn(async () => ({
      sessionKey: 'weixin-session',
      loginUrl: 'https://ilinkai.weixin.qq.com/login/mock-session',
      messageKey: 'settings.remote.weixinIlink.loginWindowOpened'
    })),
    waitForWeixinIlinkLogin: vi.fn(async () => ({
      connected: true,
      account: {
        accountId: 'wx-account-1',
        ownerUserId: 'owner-1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        enabled: true
      },
      message: 'Connected'
    })),
    removeWeixinIlinkAccount: vi.fn(async (accountId: string) => {
      weixinIlinkState.settings.accounts = weixinIlinkState.settings.accounts.filter(
        (account) => account.accountId !== accountId
      )
      syncWeixinIlinkStatusFromSettings()
    }),
    restartWeixinIlinkAccount: vi.fn(async () => undefined),
    testTelegramHookNotification: vi.fn(async () => ({
      success: true,
      durationMs: 10
    }))
  }

  const agentSessionPresenter = {
    getAgents: vi.fn(async () => [
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'deepchat-alt', name: 'DeepChat Alt', type: 'deepchat', enabled: false },
      { id: 'acp-agent', name: 'ACP Agent', type: 'acp', enabled: true },
      ...(options.agents ?? [])
    ])
  }
  const projectPresenter = {
    selectDirectory: vi.fn(async () => options.selectedDirectory ?? null)
  }

  const toast = vi.fn()
  const tabsContextKey = Symbol('remote-settings-tabs')
  const tabsComponents = {
    Tabs: defineComponent({
      props: {
        modelValue: {
          type: String,
          default: ''
        }
      },
      emits: ['update:modelValue'],
      setup(props, { emit, slots }) {
        const currentValue = ref(String(props.modelValue ?? ''))
        watch(
          () => props.modelValue,
          (value) => {
            currentValue.value = String(value ?? '')
          }
        )

        provide(tabsContextKey, {
          currentValue,
          setValue: (value: string) => {
            currentValue.value = value
            emit('update:modelValue', value)
          }
        })

        return () => h('div', slots.default?.())
      }
    }),
    TabsList: defineComponent({
      setup(_props, { slots }) {
        return () => h('div', slots.default?.())
      }
    }),
    TabsTrigger: defineComponent({
      inheritAttrs: false,
      props: {
        value: {
          type: String,
          required: true
        }
      },
      setup(props, { attrs, slots }) {
        const tabs = inject<{
          currentValue: Ref<string>
          setValue: (value: string) => void
        }>(tabsContextKey)

        if (!tabs) {
          throw new Error('TabsTrigger must be used inside Tabs')
        }

        return () =>
          h(
            'button',
            {
              ...attrs,
              'data-state': tabs.currentValue.value === props.value ? 'active' : 'inactive',
              onClick: () => tabs.setValue(props.value)
            },
            slots.default?.()
          )
      }
    }),
    TabsContent: defineComponent({
      inheritAttrs: false,
      props: {
        value: {
          type: String,
          required: true
        }
      },
      setup(props, { attrs, slots }) {
        const tabs = inject<{
          currentValue: Ref<string>
          setValue: (value: string) => void
        }>(tabsContextKey)

        if (!tabs) {
          throw new Error('TabsContent must be used inside Tabs')
        }

        return () =>
          h(
            'div',
            {
              ...attrs,
              'data-state': tabs.currentValue.value === props.value ? 'active' : 'inactive',
              'data-tabs-content-value': props.value,
              style: tabs.currentValue.value === props.value ? undefined : { display: 'none' }
            },
            slots.default?.()
          )
      }
    })
  }

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'agentSessionPresenter') return agentSessionPresenter
      if (name === 'projectPresenter') return projectPresenter
      return null
    },
    useRemoteControlPresenter: () => remoteControlPresenter
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
  vi.doMock('@shadcn/components/ui/tabs', () => tabsComponents)

  const passthrough = defineComponent({
    template: '<div><slot /></div>'
  })

  const dropdownMenuItemStub = defineComponent({
    emits: ['select'],
    template:
      '<button v-bind="$attrs" type="button" @click="$emit(\'select\', $event)"><slot /></button>'
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
        DropdownMenu: passthrough,
        DropdownMenuContent: passthrough,
        DropdownMenuItem: dropdownMenuItemStub,
        DropdownMenuSeparator: passthrough,
        DropdownMenuTrigger: passthrough,
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
    feishuState,
    qqbotState,
    discordState,
    weixinIlinkState,
    remoteControlPresenter,
    agentSessionPresenter,
    projectPresenter,
    toast,
    tabsComponents
  }
}

describe('RemoteSettings', () => {
  it('hides remote and hook details when both toggles are disabled', async () => {
    const { wrapper, tabsComponents } = await setup({
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

  it('shows only the active tab content when switching channels', async () => {
    const { wrapper, tabsComponents } = await setup({
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
      feishuChannelSettingsOverride: {
        remoteEnabled: true
      }
    })

    const telegramPanel = wrapper.find('[data-tabs-content-value="telegram"]')
    const feishuPanel = wrapper.find('[data-tabs-content-value="feishu"]')

    expect(telegramPanel.isVisible()).toBe(true)
    expect(feishuPanel.isVisible()).toBe(false)

    const feishuTrigger = wrapper
      .findAllComponents(tabsComponents.TabsTrigger)
      .find((component) => component.attributes('data-testid') === 'remote-tab-feishu')

    expect(feishuTrigger).toBeDefined()

    await feishuTrigger!.trigger('click')
    await flushPromises()

    expect(telegramPanel.attributes('data-state')).toBe('inactive')
    expect(feishuPanel.attributes('data-state')).toBe('active')
    expect(telegramPanel.attributes('style')).toContain('display: none')
    expect(feishuPanel.attributes('style')).toBeUndefined()
  })

  it('toggles telegram remote control from the tab header', async () => {
    const { wrapper, remoteState, remoteControlPresenter } = await setup({
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

    await wrapper.find('[data-testid="remote-channel-toggle-telegram"]').setValue(true)
    await flushPromises()

    expect(remoteState.settings.remoteEnabled).toBe(true)
    expect(remoteControlPresenter.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({
        remoteEnabled: true
      })
    )
    expect(wrapper.find('[data-testid="remote-bindings-button"]').exists()).toBe(true)
  })

  it('shows enabled ACP agents in the default agent options', async () => {
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

    expect(wrapper.text()).toContain('ACP Agent (ACP)')
  })

  it('shows and removes authorized principals from the bindings dialog', async () => {
    const { wrapper, remoteState, remoteControlPresenter } = await setup({
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        defaultAgentId: 'deepchat',
        hookNotifications: {
          enabled: false,
          chatId: '',
          threadId: '',
          events: []
        }
      },
      pairingSnapshot: {
        pairCode: null,
        pairCodeExpiresAt: null,
        allowedUserIds: [123]
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

    expect(wrapper.find('[data-testid="remote-principal-123"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="remote-binding-telegram:100:0"]').exists()).toBe(true)

    await wrapper.find('[data-testid="remote-principal-123"] button').trigger('click')
    await flushPromises()

    expect(remoteControlPresenter.removeChannelPrincipal).toHaveBeenCalledWith('telegram', '123')
    expect(remoteState.pairingSnapshot.allowedUserIds).toEqual([])
    expect(wrapper.find('[data-testid="remote-principals-empty"]').exists()).toBe(true)
  })

  it('shows feishu brand switch while keeping legacy paired-user raw inputs hidden', async () => {
    const { wrapper, tabsComponents } = await setup({
      feishuChannelSettingsOverride: {
        remoteEnabled: true
      }
    })

    const feishuTrigger = wrapper
      .findAllComponents(tabsComponents.TabsTrigger)
      .find((component) => component.attributes('data-testid') === 'remote-tab-feishu')

    expect(feishuTrigger).toBeDefined()

    await feishuTrigger!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="remote-feishu-paired-user-open-ids-input"]').exists()).toBe(
      false
    )
    expect(wrapper.text()).toContain('settings.remote.feishu.brand')
    expect(wrapper.text()).toContain('settings.remote.remoteControl.defaultWorkdir')
    expect(wrapper.find('[data-testid="feishu-bindings-button"]').exists()).toBe(true)
  })

  it('shows a discord tab with bot token and pairing controls, without webhook fields', async () => {
    const { wrapper, tabsComponents } = await setup({
      discordChannelSettingsOverride: {
        remoteEnabled: true
      }
    })

    const discordTrigger = wrapper
      .findAllComponents(tabsComponents.TabsTrigger)
      .find((component) => component.attributes('data-testid') === 'remote-tab-discord')

    expect(discordTrigger).toBeDefined()

    await discordTrigger!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('settings.remote.discord.botToken')
    expect(wrapper.text()).toContain('settings.remote.discord.remoteControlDescription')
    expect(wrapper.find('[data-testid="discord-pair-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="discord-bindings-button"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('settings.notificationsHooks.discord.webhookUrl')
  })

  it('normalizes legacy telegram settings without hook notifications', async () => {
    const { wrapper, toast } = await setup({
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
      telegramChannelSettingsOverride: {
        hookNotifications: undefined
      }
    })

    expect(toast).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="remote-default-agent-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="remote-allowed-user-ids-input"]').exists()).toBe(false)
  })

  it('normalizes legacy feishu settings without paired user ids', async () => {
    const { wrapper, toast } = await setup({
      feishuChannelSettingsOverride: {
        remoteEnabled: true,
        pairedUserOpenIds: undefined
      }
    })

    await wrapper.find('[data-testid="remote-tab-feishu"]').trigger('click')
    await flushPromises()

    expect(toast).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="feishu-bindings-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="remote-feishu-paired-user-open-ids-input"]').exists()).toBe(
      false
    )
  })

  it('uses remote control as the channel section title', async () => {
    const { wrapper } = await setup({
      feishuChannelSettingsOverride: {
        remoteEnabled: true
      }
    })

    const text = wrapper.text()
    expect(text).not.toContain('settings.remote.sections.accessRules')
    expect(text.match(/settings\.remote\.sections\.remoteControl/g)).toHaveLength(5)
  })

  it('does not create a separate lark tab when feishu brand switches to lark', async () => {
    const { wrapper } = await setup({
      feishuChannelSettingsOverride: {
        brand: 'lark',
        remoteEnabled: true
      }
    })

    expect(wrapper.find('[data-testid="remote-tab-feishu"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="remote-tab-lark"]').exists()).toBe(false)
  })

  it('starts the wechat ilink qr login flow and shows the dialog', async () => {
    const { wrapper, remoteControlPresenter, tabsComponents } = await setup()
    remoteControlPresenter.waitForWeixinIlinkLogin.mockImplementation(
      async () => await new Promise<never>(() => {})
    )

    const weixinTrigger = wrapper
      .findAllComponents(tabsComponents.TabsTrigger)
      .find((component) => component.attributes('data-testid') === 'remote-tab-weixin-ilink')

    expect(weixinTrigger).toBeDefined()

    await weixinTrigger!.trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="weixin-ilink-connect-button"]').trigger('click')
    await flushPromises()

    const connectButton = wrapper.find('[data-testid="weixin-ilink-connect-button"]')
    expect(connectButton.attributes('disabled')).toBeDefined()

    await connectButton.trigger('click')
    await flushPromises()

    expect(remoteControlPresenter.startWeixinIlinkLogin).toHaveBeenCalledTimes(1)
    expect(remoteControlPresenter.waitForWeixinIlinkLogin).toHaveBeenCalledWith({
      sessionKey: 'weixin-session',
      timeoutMs: 480000
    })
    expect(wrapper.text()).toContain('settings.remote.weixinIlink.loginWindowOpened')
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

    expect(remoteControlPresenter.createChannelPairCode).toHaveBeenCalledWith('telegram')
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
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.remote.remoteControl.pairingSuccessTitle'
      })
    )

    await wrapper.find('[data-testid="remote-bindings-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="remote-principal-456"]').exists()).toBe(true)
  })

  it('does not open the pair dialog when saving telegram settings fails', async () => {
    const { wrapper, remoteControlPresenter, toast } = await setup({
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

    remoteControlPresenter.saveChannelSettings.mockRejectedValueOnce(new Error('save failed'))

    await wrapper.find('[data-testid="remote-pair-button"]').trigger('click')
    await flushPromises()

    expect(remoteControlPresenter.createChannelPairCode).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="remote-pair-dialog"]').exists()).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'save failed'
      })
    )
  })

  it('lists only enabled agents in the default agent selector area', async () => {
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
    expect(wrapper.text()).toContain('ACP Agent (ACP)')
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

    expect(remoteControlPresenter.removeChannelBinding).toHaveBeenCalledWith(
      'telegram',
      'telegram:100:0'
    )
    expect(wrapper.find('[data-testid="remote-bindings-empty"]').exists()).toBe(true)
  })

  it('does not open bindings when saving feishu settings fails', async () => {
    const { wrapper, remoteControlPresenter, toast, tabsComponents } = await setup({
      feishuChannelSettingsOverride: {
        remoteEnabled: true
      }
    })

    const feishuTrigger = wrapper
      .findAllComponents(tabsComponents.TabsTrigger)
      .find((component) => component.attributes('data-testid') === 'remote-tab-feishu')

    expect(feishuTrigger).toBeDefined()

    await feishuTrigger!.trigger('click')
    await flushPromises()

    remoteControlPresenter.saveChannelSettings.mockImplementationOnce(async (channel: string) => {
      if (channel === 'feishu') {
        throw new Error('feishu save failed')
      }

      return {}
    })

    await wrapper.find('[data-testid="feishu-bindings-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="remote-bindings-dialog"]').exists()).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'feishu save failed'
      })
    )
  })

  it('does not run the telegram hook test when saving settings fails', async () => {
    const { wrapper, remoteControlPresenter, toast } = await setup({
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        allowedUserIds: [123],
        defaultAgentId: 'deepchat',
        hookNotifications: {
          enabled: true,
          chatId: '100',
          threadId: '',
          events: []
        }
      }
    })

    remoteControlPresenter.saveChannelSettings.mockRejectedValueOnce(new Error('hook save failed'))

    const hookTestButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.notificationsHooks.test.button'))

    expect(hookTestButton).toBeDefined()

    await hookTestButton!.trigger('click')
    await flushPromises()

    expect(remoteControlPresenter.testTelegramHookNotification).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'hook save failed'
      })
    )
  })
})
