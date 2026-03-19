import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const route = {
  name: 'settings-about'
}

const presenterMocks = {
  devicePresenter: {
    getAppVersion: vi.fn().mockResolvedValue('1.0.0-beta.3')
  },
  configPresenter: {
    getUpdateChannel: vi.fn().mockResolvedValue('stable'),
    setUpdateChannel: vi.fn().mockResolvedValue(undefined)
  }
}

const upgradeStoreMock = {
  shouldShowUpdateNotes: true,
  updateInfo: {
    version: '1.0.0-beta.4',
    releaseNotes: '- Added floating window'
  },
  showManualDownloadOptions: true,
  updateError: 'network failed',
  isChecking: false,
  isDownloading: false,
  isRestarting: false,
  updateProgress: null,
  isReadyToInstall: false,
  updateState: 'error',
  refreshStatus: vi.fn().mockResolvedValue('error'),
  checkUpdate: vi.fn().mockResolvedValue('error'),
  handleUpdate: vi.fn().mockResolvedValue(undefined)
}

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: (name: keyof typeof presenterMocks) => presenterMocks[name]
}))

vi.mock('@/stores/upgrade', () => ({
  useUpgradeStore: () => upgradeStoreMock
}))

vi.mock('@/stores/language', () => ({
  useLanguageStore: () => ({
    dir: 'ltr'
  })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    isDark: true
  })
}))

vi.mock('@/components/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { version?: string }) => {
      const messages: Record<string, string> = {
        'about.title': 'DeepChat',
        'about.description': 'DeepChat description',
        'about.website': '访问我们的网站',
        'about.updateChannel': '更新渠道',
        'about.stableChannel': '稳定版',
        'about.betaChannel': '内测版',
        'about.feedbackButton': '意见反馈',
        'about.disclaimerButton': '免责声明',
        'about.checkUpdateButton': '检查更新',
        'about.disclaimerTitle': '免责声明',
        'update.versionAvailable': `${params?.version ?? ''} 可用`,
        'update.autoUpdateFailed': '自动更新可能不稳定，请手动下载更新',
        'update.githubDownload': 'GitHub 下载',
        'update.officialDownload': '官网下载',
        'update.installNow': '立即安装',
        'update.installUpdate': '安装更新',
        'update.downloading': '下载中',
        'settings.about.checking': '检查中',
        'common.close': '关闭',
        searchDisclaimer: 'disclaimer'
      }

      return messages[key] ?? key
    }
  })
}))

vi.mock('vue-router', () => ({
  useRoute: () => route
}))

describe('AboutUsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(upgradeStoreMock, {
      shouldShowUpdateNotes: true,
      updateInfo: {
        version: '1.0.0-beta.4',
        releaseNotes: '- Added floating window'
      },
      showManualDownloadOptions: true,
      updateError: 'network failed',
      isChecking: false,
      isDownloading: false,
      isRestarting: false,
      updateProgress: null,
      isReadyToInstall: false,
      updateState: 'error'
    })
    Object.assign(window, {
      electron: {
        ipcRenderer: {
          on: vi.fn(),
          removeListener: vi.fn()
        }
      },
      api: {
        openExternal: vi.fn()
      }
    })
  })

  it('renders fallback download actions in the bottom action row', async () => {
    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          Icon: true,
          Dialog: passthroughStub('Dialog'),
          DialogContent: passthroughStub('DialogContent'),
          DialogDescription: passthroughStub('DialogDescription'),
          DialogFooter: passthroughStub('DialogFooter'),
          DialogHeader: passthroughStub('DialogHeader'),
          DialogTitle: passthroughStub('DialogTitle'),
          Select: passthroughStub('Select'),
          SelectContent: passthroughStub('SelectContent'),
          SelectItem: passthroughStub('SelectItem'),
          SelectTrigger: passthroughStub('SelectTrigger'),
          SelectValue: passthroughStub('SelectValue'),
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    await flushPromises()

    const buttons = wrapper.findAll('button').map((button) => button.text())
    expect(buttons).toEqual(['意见反馈', '免责声明', 'GitHub 下载', '官网下载', '关闭'])
    expect(wrapper.text()).not.toContain('检查更新')

    const officialButton = wrapper.findAll('button').find((button) => button.text() === '官网下载')
    expect(officialButton).toBeTruthy()

    await officialButton!.trigger('click')

    expect(upgradeStoreMock.handleUpdate).toHaveBeenCalledWith('official')
  })

  it('subscribes to tray update checks before initial presenter calls resolve', async () => {
    let resolveAppVersion: ((value: string) => void) | null = null
    presenterMocks.devicePresenter.getAppVersion.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveAppVersion = resolve
      })
    )

    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          Icon: true,
          Dialog: passthroughStub('Dialog'),
          DialogContent: passthroughStub('DialogContent'),
          DialogDescription: passthroughStub('DialogDescription'),
          DialogFooter: passthroughStub('DialogFooter'),
          DialogHeader: passthroughStub('DialogHeader'),
          DialogTitle: passthroughStub('DialogTitle'),
          Select: passthroughStub('Select'),
          SelectContent: passthroughStub('SelectContent'),
          SelectItem: passthroughStub('SelectItem'),
          SelectTrigger: passthroughStub('SelectTrigger'),
          SelectValue: passthroughStub('SelectValue'),
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    const registration = vi
      .mocked(window.electron.ipcRenderer.on)
      .mock.calls.find(([event]) => event === 'settings:check-for-updates')

    expect(registration).toBeTruthy()

    const handler = registration?.[1] as () => Promise<void>
    await handler()

    expect(upgradeStoreMock.checkUpdate).toHaveBeenCalledWith(false)

    resolveAppVersion?.('1.0.0-beta.3')
    await flushPromises()
    wrapper.unmount()
  })

  it('does not trigger install flow for external check requests when update is ready to install', async () => {
    upgradeStoreMock.showManualDownloadOptions = false
    upgradeStoreMock.updateError = null
    upgradeStoreMock.isReadyToInstall = true
    upgradeStoreMock.updateState = 'ready_to_install'

    const { default: AboutUsSettings } =
      await import('../../../src/renderer/settings/components/AboutUsSettings.vue')

    const wrapper = mount(AboutUsSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          Icon: true,
          Dialog: passthroughStub('Dialog'),
          DialogContent: passthroughStub('DialogContent'),
          DialogDescription: passthroughStub('DialogDescription'),
          DialogFooter: passthroughStub('DialogFooter'),
          DialogHeader: passthroughStub('DialogHeader'),
          DialogTitle: passthroughStub('DialogTitle'),
          Select: passthroughStub('Select'),
          SelectContent: passthroughStub('SelectContent'),
          SelectItem: passthroughStub('SelectItem'),
          SelectTrigger: passthroughStub('SelectTrigger'),
          SelectValue: passthroughStub('SelectValue'),
          NodeRenderer: passthroughStub('NodeRenderer')
        }
      }
    })

    await flushPromises()

    const registration = vi
      .mocked(window.electron.ipcRenderer.on)
      .mock.calls.find(([event]) => event === 'settings:check-for-updates')

    expect(registration).toBeTruthy()

    const handler = registration?.[1] as () => Promise<void>
    await handler()

    expect(upgradeStoreMock.handleUpdate).not.toHaveBeenCalled()
    expect(upgradeStoreMock.checkUpdate).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
