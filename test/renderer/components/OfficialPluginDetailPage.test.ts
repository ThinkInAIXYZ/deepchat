import { describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const dcSectionCardStub = defineComponent({
  name: 'DcSectionCard',
  template: '<section><slot name="actions" /><slot /></section>'
})

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const remoteSettingsStub = defineComponent({
  name: 'RemoteSettings',
  props: {
    channel: { type: String, default: '' },
    hideChannelToggle: { type: Boolean, default: false },
    hideHeader: { type: Boolean, default: false }
  },
  template:
    '<div data-testid="remote-settings" :data-channel="channel" :data-hide-toggle="String(hideChannelToggle)" :data-hide-header="String(hideHeader)"></div>'
})

const translations: Record<string, string> = {
  'chat.sidebar.remoteControlStatus.disabled': 'Remote disabled',
  'chat.sidebar.remoteControlStatus.running': 'Remote running',
  'common.back': 'Back',
  'common.disabled': 'Disabled',
  'settings.plugins.disable': 'Disable',
  'settings.plugins.enable': 'Enable',
  'settings.plugins.quarantineDescription': 'Runtime was quarantined after an unclean exit.',
  'settings.plugins.retryRuntime': 'Retry runtime',
  'settings.plugins.testRuntime': 'Test runtime',
  'settings.plugins.runtimeStates.error': 'Error',
  'settings.plugins.runtimeStates.installed': 'Installed',
  'settings.plugins.runtimeStates.quarantined': 'Quarantined',
  'settings.plugins.runtimeStates.readyOnDemand': 'Ready on demand',
  'settings.plugins.runtimeStates.running': 'Running',
  'settings.plugins.status.disabled': 'Disabled',
  'settings.plugins.status.enabled': 'Enabled',
  'settings.pluginsHub.actionResult': 'Action result',
  'settings.pluginsHub.capabilities': 'Capabilities',
  'settings.pluginsHub.cuaDescription': 'CUA localized description',
  'settings.plugins.runtime': 'Runtime',
  'settings.plugins.runtimeState': 'State',
  'settings.plugins.version': 'Version',
  'settings.remote.feishu.description': 'Feishu localized description',
  'settings.remote.feishu.title': 'Feishu localized title',
  'settings.remote.telegram.description': 'Telegram localized description',
  'settings.remote.telegram.title': 'Telegram localized title'
}

const defaultFeishuSettings = (remoteEnabled: boolean) => ({
  brand: 'feishu',
  appId: 'cli_a',
  appSecret: 'secret',
  verificationToken: '',
  encryptKey: '',
  remoteEnabled,
  defaultAgentId: 'feishu-bot',
  defaultWorkdir: '',
  pairedUserOpenIds: []
})

const defaultTelegramSettings = (remoteEnabled: boolean) => ({
  botToken: 'token',
  remoteEnabled,
  defaultAgentId: 'telegram-bot',
  defaultWorkdir: '',
  allowedUserIds: []
})

const findIcon = (wrapper: ReturnType<typeof shallowMount>, icon: string) =>
  wrapper.find(`[data-icon="${icon}"], [icon="${icon}"]`)

const findRemoteSettingsKey = (wrapper: ReturnType<typeof shallowMount>) =>
  wrapper.findComponent(remoteSettingsStub).vm.$.vnode.key

async function mountDetail(
  options: {
    activationError?: string
    enabled?: boolean
    mcpServer?: {
      integrityError?: string
      lifecycleState?: string
      lastError?: string
      running?: boolean
    }
    pluginId?: string
    remoteEnabled?: boolean
    runtimeState?: 'missing' | 'installed' | 'running' | 'error'
  } = {}
) {
  vi.resetModules()
  vi.clearAllMocks()

  const pluginId = options.pluginId ?? 'com.deepchat.plugins.feishu'
  const remoteChannel = pluginId.startsWith('remote:') ? pluginId.slice('remote:'.length) : 'feishu'
  let remoteEnabled = options.remoteEnabled ?? false
  const pluginName =
    pluginId === 'com.deepchat.plugins.cua' ? 'CUA Computer Use Runtime' : 'Feishu/Lark Integration'
  const pluginRecord = {
    id: pluginId,
    name: pluginName,
    publisher: 'DeepChat',
    version: '1.0.4',
    enabled: options.enabled ?? false,
    activationError: options.activationError,
    capabilities: ['runtime.manage'],
    runtime: options.runtimeState
      ? {
          runtimeId: 'cua-driver',
          displayName: 'CUA Driver',
          state: options.runtimeState
        }
      : undefined,
    mcpServers: options.mcpServer
      ? [
          {
            serverId: 'cua-driver',
            enabled: options.enabled ?? false,
            running: false,
            ...options.mcpServer
          }
        ]
      : []
  }
  const pluginClient = {
    getPlugin: vi.fn().mockResolvedValue(pluginRecord),
    enablePlugin: vi.fn().mockResolvedValue({ ok: true }),
    disablePlugin: vi.fn().mockResolvedValue({ ok: true }),
    invokeAction: vi.fn().mockResolvedValue({
      ok: true,
      status: {
        ...pluginRecord,
        mcpServers: pluginRecord.mcpServers.map((server) => ({
          ...server,
          running: false,
          lifecycleState: 'stopped',
          lastError: undefined
        }))
      }
    })
  }
  const remoteControlClient = {
    getChannelSettings: vi.fn(async () =>
      remoteChannel === 'telegram'
        ? defaultTelegramSettings(remoteEnabled)
        : defaultFeishuSettings(remoteEnabled)
    ),
    getChannelStatus: vi.fn(async () => ({
      channel: remoteChannel,
      enabled: remoteEnabled,
      state: remoteEnabled ? 'running' : 'disabled',
      bindingCount: 1,
      allowedUserCount: 1,
      lastError: null
    })),
    saveChannelSettings: vi.fn(async (_channel: string, settings: { remoteEnabled: boolean }) => {
      remoteEnabled = settings.remoteEnabled
      return settings
    })
  }
  const router = {
    push: vi.fn()
  }

  vi.doMock('@api/PluginClient', () => ({
    createPluginClient: () => pluginClient
  }))
  vi.doMock('@api/RemoteControlClient', () => ({
    createRemoteControlClient: () => remoteControlClient
  }))
  vi.doMock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return {
      ...actual,
      useRoute: () => ({
        params: { pluginId }
      }),
      useRouter: () => router
    }
  })
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      props: {
        icon: { type: String, required: true }
      },
      template: '<span :data-icon="icon" />'
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/RemoteSettings.vue', () => ({
    default: remoteSettingsStub
  }))
  vi.doMock('../../../settings/components/RemoteSettings.vue', () => ({
    default: remoteSettingsStub
  }))

  const OfficialPluginDetailPage = (await import('@/pages/plugins/OfficialPluginDetailPage.vue'))
    .default
  const wrapper = shallowMount(OfficialPluginDetailPage, {
    global: {
      plugins: [createPinia()],
      stubs: {
        DcButton: buttonStub,
        ScrollArea: passthrough('ScrollArea'),
        RemoteSettings: remoteSettingsStub,
        Alert: passthrough('Alert'),
        AlertTitle: passthrough('AlertTitle'),
        AlertDescription: passthrough('AlertDescription'),
        DcSectionCard: dcSectionCardStub
      }
    }
  })
  await flushPromises()

  return { wrapper, pluginClient, remoteControlClient }
}

describe('OfficialPluginDetailPage', () => {
  it('uses the Feishu remote icon on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail()

    const icon = findIcon(wrapper, 'lucide:message-circle')

    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('text-blue-500')
    expect(findIcon(wrapper, 'lucide:puzzle').exists()).toBe(false)
    expect(wrapper.text()).toContain('Feishu localized title')
    expect(wrapper.text()).not.toContain('settings.remote.feishu.title')
    expect(wrapper.text()).not.toContain('Feishu/Lark Integration')
  })

  it('uses the localized Feishu description on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail()

    expect(wrapper.text()).toContain('Feishu localized description')
    expect(wrapper.text()).not.toContain('DeepChat · com.deepchat.plugins.feishu')
  })

  it('uses the remote channel icon color on remote virtual plugin details', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'remote:telegram' })

    const icon = findIcon(wrapper, 'lucide:send')

    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('text-sky-500')
  })

  it('uses the CUA laptop icon on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'com.deepchat.plugins.cua' })

    expect(findIcon(wrapper, 'lucide:laptop-minimal-check').exists()).toBe(true)
    expect(findIcon(wrapper, 'lucide:puzzle').exists()).toBe(false)
  })

  it('uses the localized CUA description on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'com.deepchat.plugins.cua' })

    expect(wrapper.text()).toContain('CUA localized description')
    expect(wrapper.text()).not.toContain('DeepChat · com.deepchat.plugins.cua')
  })

  it('uses a distinct runtime state label without internal capabilities', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'com.deepchat.plugins.cua' })

    expect(wrapper.text()).toContain('Runtime')
    expect(wrapper.text()).toContain('State')
    expect(wrapper.text()).not.toContain('Capabilities')
    expect(wrapper.text()).not.toContain('runtime.manage')
  })

  it('tests an enabled CUA runtime without changing plugin intent', async () => {
    const { wrapper, pluginClient } = await mountDetail({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: true,
      mcpServer: { lifecycleState: 'stopped' }
    })

    expect(wrapper.text()).toContain('Ready on demand')
    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cua-runtime-retry"]').exists()).toBe(false)

    await wrapper.find('[data-testid="cua-runtime-test"]').trigger('click')
    await flushPromises()

    expect(pluginClient.invokeAction).toHaveBeenCalledWith({
      pluginId: 'com.deepchat.plugins.cua',
      actionId: 'runtime.test'
    })
    expect(wrapper.text()).toContain('Enabled')
  })

  it('exposes retry only for a quarantined CUA runtime', async () => {
    const { wrapper, pluginClient } = await mountDetail({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: true,
      mcpServer: {
        lifecycleState: 'quarantined',
        lastError: 'unclean exit'
      }
    })

    expect(wrapper.text()).toContain('Quarantined')
    expect(wrapper.text()).toContain('Runtime was quarantined after an unclean exit.')
    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cua-runtime-retry"]').exists()).toBe(true)

    await wrapper.find('[data-testid="cua-runtime-retry"]').trigger('click')
    await flushPromises()

    expect(pluginClient.invokeAction).toHaveBeenCalledWith({
      pluginId: 'com.deepchat.plugins.cua',
      actionId: 'runtime.retry'
    })
    expect(wrapper.find('[data-testid="cua-runtime-retry"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(true)
  })

  it('requires an integrity recheck before offering quarantine retry', async () => {
    const { wrapper } = await mountDetail({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: true,
      mcpServer: {
        lifecycleState: 'quarantined',
        integrityError: 'CUA runtime integrity mismatch'
      }
    })

    expect(wrapper.text()).toContain('CUA runtime integrity mismatch')
    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cua-runtime-retry"]').exists()).toBe(false)
  })

  it('refreshes action eligibility when retry discovers an integrity block', async () => {
    const { wrapper, pluginClient } = await mountDetail({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: true,
      mcpServer: { lifecycleState: 'quarantined' }
    })
    const initialPlugin = await pluginClient.getPlugin.mock.results[0].value
    pluginClient.invokeAction.mockResolvedValueOnce({
      ok: false,
      error: 'CUA runtime integrity mismatch'
    })
    pluginClient.getPlugin.mockResolvedValueOnce({
      ...initialPlugin,
      mcpServers: initialPlugin.mcpServers.map((server) => ({
        ...server,
        integrityError: 'CUA runtime integrity mismatch'
      }))
    })

    await wrapper.find('[data-testid="cua-runtime-retry"]').trigger('click')
    await flushPromises()

    expect(pluginClient.getPlugin).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('CUA runtime integrity mismatch')
    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cua-runtime-retry"]').exists()).toBe(false)
  })

  it('surfaces activation errors separately and blocks runtime actions', async () => {
    const { wrapper } = await mountDetail({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: true,
      activationError: 'CUA runtime integrity mismatch',
      mcpServer: { lifecycleState: 'error' }
    })

    expect(wrapper.text()).toContain('CUA runtime integrity mismatch')
    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cua-runtime-retry"]').exists()).toBe(false)
  })

  it('does not present a missing CUA runtime as ready on demand', async () => {
    const { wrapper } = await mountDetail({
      pluginId: 'com.deepchat.plugins.cua',
      enabled: true,
      runtimeState: 'missing',
      mcpServer: {}
    })

    expect(wrapper.find('[data-testid="cua-runtime-test"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Ready on demand')
  })

  it('uses the plugin enable button to start Feishu remote too', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountDetail()

    expect(wrapper.find('[data-testid="remote-settings"]').attributes('data-hide-toggle')).toBe(
      'true'
    )
    expect(findRemoteSettingsKey(wrapper)).toBe('feishu:0')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Enable')!
      .trigger('click')
    await flushPromises()

    expect(pluginClient.enablePlugin).toHaveBeenCalledWith('com.deepchat.plugins.feishu')
    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'feishu',
      expect.objectContaining({ remoteEnabled: true })
    )
    expect(pluginClient.getPlugin).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Disable')).toBe(true)
    expect(findRemoteSettingsKey(wrapper)).toBe('feishu:1')
  })

  it('uses the plugin disable button to stop Feishu remote too', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountDetail({
      enabled: true,
      remoteEnabled: true
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Disable')!
      .trigger('click')
    await flushPromises()

    expect(pluginClient.disablePlugin).toHaveBeenCalledWith('com.deepchat.plugins.feishu')
    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'feishu',
      expect.objectContaining({ remoteEnabled: false })
    )
  })

  it('uses the top detail button to start remote virtual plugins', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountDetail({
      pluginId: 'remote:telegram'
    })

    expect(pluginClient.getPlugin).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="remote-settings"]').attributes()).toMatchObject({
      'data-channel': 'telegram',
      'data-hide-toggle': 'true',
      'data-hide-header': 'true'
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Enable')!
      .trigger('click')
    await flushPromises()

    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ remoteEnabled: true })
    )
    expect(wrapper.findAll('button').some((button) => button.text() === 'Disable')).toBe(true)
  })

  it('uses the top detail button to stop remote virtual plugins', async () => {
    const { wrapper, remoteControlClient } = await mountDetail({
      pluginId: 'remote:telegram',
      remoteEnabled: true
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Disable')!
      .trigger('click')
    await flushPromises()

    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ remoteEnabled: false })
    )
  })
})
