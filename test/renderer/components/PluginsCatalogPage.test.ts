import { describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { OcrRuntimeStatus } from '../../../src/shared/contracts/routes/ocr.routes'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const translations: Record<string, string> = {
  'routes.plugins': 'Plugins',
  'routes.settings-ocr': 'OCR',
  'settings.ocr.available': 'Available',
  'settings.ocr.description': 'Extract image text locally.',
  'settings.ocr.statusLoadFailed': 'OCR status could not be loaded.',
  'settings.ocr.unavailable': 'Unavailable',
  'settings.ocr.unavailableReasons.unsupported_platform': 'OCR is unsupported on this platform.',
  'settings.pluginsHub.add': 'Add',
  'settings.pluginsHub.available': 'Available plugins',
  'settings.pluginsHub.builtinCapability': 'Built-in capability',
  'settings.pluginsHub.cuaDescription': 'CUA localized description',
  'settings.pluginsHub.manage': 'Manage',
  'settings.pluginsHub.subtitle': 'Manage DeepChat plugins.',
  'settings.plugins.status.disabled': 'Disabled',
  'settings.plugins.status.enabled': 'Enabled',
  'settings.remote.feishu.description': 'Feishu localized description',
  'settings.remote.feishu.title': 'Feishu localized title'
}

const AVAILABLE_OCR_STATUS: OcrRuntimeStatus = {
  platform: 'darwin',
  arch: 'arm64',
  availability: {
    status: 'available',
    lightOcrVersion: '0.5.5',
    bundleId: 'ppocrv6-small-native-20260719.1'
  },
  process: null,
  cache: null
}

async function mountCatalog(options?: { ocrStatus?: OcrRuntimeStatus | Error }) {
  vi.resetModules()
  vi.clearAllMocks()

  const pluginClient = {
    listPlugins: vi.fn().mockResolvedValue([
      {
        id: 'com.deepchat.plugins.feishu',
        name: 'Feishu/Lark Integration',
        publisher: 'DeepChat',
        version: '1.0.4',
        enabled: false,
        capabilities: [],
        mcpServers: []
      },
      {
        id: 'com.deepchat.plugins.cua',
        name: 'CUA Computer Use Runtime',
        publisher: 'DeepChat',
        version: '1.0.4',
        enabled: true,
        capabilities: [],
        mcpServers: []
      }
    ]),
    enablePlugin: vi.fn().mockResolvedValue({ ok: true })
  }
  const remoteControlClient = {
    listRemoteChannels: vi.fn().mockResolvedValue([
      {
        id: 'feishu',
        titleKey: 'settings.remote.feishu.title',
        descriptionKey: 'settings.remote.feishu.description',
        supportsCronDelivery: true
      }
    ]),
    getChannelStatus: vi.fn().mockResolvedValue({
      channel: 'feishu',
      enabled: false,
      state: 'disabled',
      bindingCount: 0,
      pairedUserCount: 0,
      lastError: null
    })
  }
  const ocrStatus = options?.ocrStatus ?? AVAILABLE_OCR_STATUS
  const ocrClient = {
    getRuntimeStatus:
      ocrStatus instanceof Error
        ? vi.fn().mockRejectedValue(ocrStatus)
        : vi.fn().mockResolvedValue(ocrStatus)
  }
  const router = {
    push: vi.fn()
  }

  vi.doMock('@api/OcrClient', () => ({
    createOcrClient: () => ocrClient
  }))
  vi.doMock('@api/PluginClient', () => ({
    createPluginClient: () => pluginClient
  }))
  vi.doMock('@api/RemoteControlClient', () => ({
    createRemoteControlClient: () => remoteControlClient
  }))
  vi.doMock('vue-router', () => ({
    useRouter: () => router
  }))
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

  const PluginsCatalogPage = (await import('@/pages/plugins/PluginsCatalogPage.vue')).default
  const wrapper = shallowMount(PluginsCatalogPage, {
    global: {
      plugins: [createPinia()],
      stubs: {
        Button: buttonStub,
        ScrollArea: passthrough('ScrollArea')
      }
    }
  })
  await flushPromises()

  return { wrapper, ocrClient, pluginClient, remoteControlClient, router }
}

describe('PluginsCatalogPage', () => {
  it('keeps the Feishu official plugin title localized after catalog load', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('Feishu localized title')
    expect(wrapper.text()).not.toContain('settings.remote.feishu.title')
    expect(wrapper.text()).not.toContain('Feishu/Lark Integration')
  })

  it('uses the localized Feishu description in catalog', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('Feishu localized description')
    expect(wrapper.text()).not.toContain('DeepChat · com.deepchat.plugins.feishu')
  })

  it('uses the CUA laptop icon in the catalog', async () => {
    const { wrapper } = await mountCatalog()

    expect(
      wrapper.findAll(
        '[data-icon="lucide:laptop-minimal-check"], [icon="lucide:laptop-minimal-check"]'
      )
    ).toHaveLength(1)
  })

  it('uses the localized CUA description in catalog', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('CUA localized description')
  })

  it('shows available plugins heading instead of unsupported category filters', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('Available plugins')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.available')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.filters.official')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.filters.workspace')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.filters.personal')
  })

  it('removes search and standalone added section', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.pluginsHub.searchPlaceholder')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.added')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.noAdded')
  })

  it('keeps built-in OCR first while sorting enabled extensions before disabled ones', async () => {
    const { wrapper } = await mountCatalog()
    const cards = wrapper.findAll('article')

    expect(cards).toHaveLength(3)
    expect(cards[0].text()).toContain('OCR')
    expect(cards[0].text()).toContain('Manage')
    expect(cards[0].text()).toContain('Built-in capability')
    expect(cards[0].text()).toContain('Available')
    const ocrBadges = cards[0].findAll('span.rounded-full')
    expect(ocrBadges).toHaveLength(2)
    expect(ocrBadges[1].classes()).toContain('bg-emerald-500/10')
    expect(cards[1].text()).toContain('CUA Computer Use Runtime')
    expect(cards[1].text()).toContain('Manage')
    expect(cards[1].text()).toContain('Enabled')
    expect(cards[2].text()).toContain('Feishu localized title')
    expect(cards[2].text()).toContain('Add')
    expect(cards[2].text()).toContain('Disabled')
  })

  it('keeps OCR visible on unsupported OCR targets so the reason is discoverable', async () => {
    const { wrapper, router } = await mountCatalog({
      ocrStatus: {
        platform: 'linux',
        arch: 'arm64',
        availability: {
          status: 'unavailable',
          reason: 'unsupported_platform',
          lightOcrVersion: '0.5.5',
          bundleId: 'ppocrv6-small-native-20260719.1'
        },
        process: null,
        cache: null
      }
    })
    const ocrCard = wrapper.findAll('article')[0]

    expect(ocrCard.text()).toContain('OCR')
    expect(ocrCard.text()).toContain('Unavailable')
    expect(ocrCard.text()).toContain('OCR is unsupported on this platform.')

    await ocrCard.get('button').trigger('click')

    expect(router.push).toHaveBeenCalledWith({ name: 'plugins-builtin-ocr' })
  })

  it('keeps OCR management available when the status IPC fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { wrapper } = await mountCatalog({
      ocrStatus: new Error('OCR IPC unavailable')
    })
    const ocrCard = wrapper.findAll('article')[0]

    expect(wrapper.findAll('article')).toHaveLength(3)
    expect(ocrCard.text()).toContain('OCR')
    expect(ocrCard.text()).toContain('OCR status could not be loaded.')
    expect(wrapper.find('.text-destructive').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('OCR IPC unavailable')
    expect(warn).toHaveBeenCalledWith(
      '[PluginsCatalogPage] Failed to load OCR status:',
      expect.objectContaining({ message: 'OCR IPC unavailable' })
    )
    warn.mockRestore()
  })

  it('marks a cached OCR status as stale when refresh fails', async () => {
    const { wrapper, ocrClient } = await mountCatalog()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ocrCard = wrapper.findAll('article')[0]

    expect(ocrCard.text()).toContain('Available')
    ocrClient.getRuntimeStatus.mockRejectedValueOnce(new Error('OCR refresh unavailable'))

    await (wrapper.vm as any).loadCatalog()
    await flushPromises()

    expect(ocrCard.text()).toContain('OCR status could not be loaded.')
    expect(ocrCard.text()).not.toContain('Available')
    expect(ocrCard.findAll('span.rounded-full')).toHaveLength(1)
    expect(wrapper.find('.text-destructive').exists()).toBe(false)
    warn.mockRestore()
  })

  it('keeps the current remote catalog when the IPC refresh fails', async () => {
    const { wrapper, remoteControlClient } = await mountCatalog()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(wrapper.findAll('article')).toHaveLength(3)
    remoteControlClient.listRemoteChannels.mockRejectedValueOnce(new Error('IPC unavailable'))

    await (wrapper.vm as any).loadCatalog()
    await flushPromises()

    expect(wrapper.findAll('article')).toHaveLength(3)
    expect(warn).toHaveBeenCalledWith(
      '[PluginsCatalogPage] Failed to load remote channels:',
      expect.objectContaining({ message: 'IPC unavailable' })
    )
    warn.mockRestore()
  })
})
