import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const pluginClient = {
  listPlugins: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  invokeAction: vi.fn()
}

vi.mock('@api/PluginClient', () => ({
  createPluginClient: () => pluginClient
}))

vi.mock('@/composables/useGuidedOnboardingStep', () => ({
  useGuidedOnboardingStep: () => ({
    showGuide: ref(false),
    stepIndex: ref(1),
    totalSteps: ref(6),
    dismissGuide: vi.fn(),
    completeStep: vi.fn().mockResolvedValue(null),
    skipStep: vi.fn().mockResolvedValue(null)
  })
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn()
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('PluginsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pluginClient.listPlugins.mockResolvedValue([
      {
        id: 'com.deepchat.plugins.feishu',
        name: 'Feishu/Lark Integration',
        version: '0.1.0',
        publisher: 'DeepChat',
        installed: true,
        enabled: false,
        trusted: true,
        trustState: 'trusted',
        official: true,
        capabilities: ['mcp.register', 'settings.contribute'],
        mcpServers: [],
        settings: {
          id: 'feishu-settings',
          ownerPluginId: 'com.deepchat.plugins.feishu',
          title: 'Feishu/Lark Integration',
          placement: 'plugins',
          entry: '/mock/settings/index.html',
          preloadTypes: '/mock/settings-preload.d.ts'
        }
      }
    ])
    pluginClient.enablePlugin.mockResolvedValue({ ok: true })
    pluginClient.disablePlugin.mockResolvedValue({ ok: true })
    pluginClient.invokeAction.mockResolvedValue({ ok: true })
  })

  it('shows the settings action for a disabled plugin with a settings contribution', async () => {
    const PluginsSettings = (
      await import('../../../src/renderer/settings/components/PluginsSettings.vue')
    ).default

    const wrapper = mount(PluginsSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          GuidedOnboardingOverlay: true,
          Icon: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.find('[data-testid="plugin-enable-com.deepchat.plugins.feishu"]').exists()).toBe(
      true
    )
    expect(
      wrapper.find('[data-testid="plugin-settings-com.deepchat.plugins.feishu"]').exists()
    ).toBe(true)
  })

  it('opens plugin settings without enabling the plugin first', async () => {
    const PluginsSettings = (
      await import('../../../src/renderer/settings/components/PluginsSettings.vue')
    ).default

    const wrapper = mount(PluginsSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          GuidedOnboardingOverlay: true,
          Icon: true
        }
      }
    })

    await flushPromises()
    await wrapper
      .find('[data-testid="plugin-settings-com.deepchat.plugins.feishu"]')
      .trigger('click')
    await flushPromises()

    expect(pluginClient.invokeAction).toHaveBeenCalledWith({
      pluginId: 'com.deepchat.plugins.feishu',
      actionId: 'settings.open'
    })
  })
})
