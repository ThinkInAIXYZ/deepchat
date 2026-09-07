import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserImportApplyResult } from '@shared/types/browser'

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const dialogStub = defineComponent({
  name: 'Dialog',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  template:
    '<div><button data-testid="dialog-open" @click="$emit(\'update:open\', true)">open</button><button data-testid="dialog-close" @click="$emit(\'update:open\', false)">close</button><slot /></div>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const profile = {
  id: 'chrome-default',
  browser: 'chrome' as const,
  browserName: 'Chrome',
  profileName: 'Default',
  supported: true
}

const setup = async (browserClient: {
  scanImportSources: ReturnType<typeof vi.fn>
  previewImport: ReturnType<typeof vi.fn>
  applyImport: ReturnType<typeof vi.fn>
}) => {
  vi.resetModules()
  vi.doMock('@api/BrowserClient', () => ({
    createBrowserClient: () => browserClient
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const BrowserDataImportDialog = (
    await import('../../../src/renderer/settings/components/BrowserDataImportDialog.vue')
  ).default
  const wrapper = mount(BrowserDataImportDialog, {
    global: {
      stubs: {
        Dialog: dialogStub,
        DialogContent: passthroughStub('DialogContent'),
        DialogDescription: passthroughStub('DialogDescription'),
        DialogFooter: passthroughStub('DialogFooter'),
        DialogHeader: passthroughStub('DialogHeader'),
        DialogTitle: passthroughStub('DialogTitle'),
        DialogTrigger: passthroughStub('DialogTrigger'),
        DcButton: buttonStub,
        Label: passthroughStub('Label'),
        Select: passthroughStub('Select'),
        SelectContent: passthroughStub('SelectContent'),
        SelectItem: passthroughStub('SelectItem'),
        SelectTrigger: passthroughStub('SelectTrigger'),
        SelectValue: passthroughStub('SelectValue'),
        Spinner: passthroughStub('Spinner'),
        Icon: true
      }
    }
  })

  await wrapper.get('[data-testid="dialog-open"]').trigger('click')
  await flushPromises()
  return wrapper
}

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const button = wrapper
    .findAllComponents(buttonStub)
    .find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`Button "${text}" not found`)
  return button
}

describe('BrowserDataImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prevents closing or leaving while cookie changes are being applied', async () => {
    let resolveApply: ((result: BrowserImportApplyResult) => void) | undefined
    const browserClient = {
      scanImportSources: vi.fn().mockResolvedValue({
        platformSupported: true,
        profiles: [profile]
      }),
      previewImport: vi.fn().mockResolvedValue({
        token: 'preview-token',
        profile,
        cookieCount: 3,
        skippedExpired: 0,
        skippedPartitioned: 0
      }),
      applyImport: vi.fn(
        () =>
          new Promise<BrowserImportApplyResult>((resolve) => {
            resolveApply = resolve
          })
      )
    }
    const wrapper = await setup(browserClient)

    await findButtonByText(wrapper, 'settings.data.yoBrowser.import.preview').trigger('click')
    await flushPromises()
    await findButtonByText(wrapper, 'settings.data.yoBrowser.import.confirm').trigger('click')
    await flushPromises()

    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')

    await wrapper.get('[data-testid="dialog-close"]').trigger('click')
    expect(wrapper.text()).toContain('settings.data.yoBrowser.import.previewTitle')

    resolveApply?.({
      importedCookies: 3,
      skippedExpired: 0,
      skippedPartitioned: 0,
      syncedAt: Date.now()
    })
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    expect(wrapper.text()).toContain('settings.data.yoBrowser.import.doneTitle')
    wrapper.unmount()
  })

  it('maps apply failures to localized copy without exposing native details', async () => {
    const browserClient = {
      scanImportSources: vi.fn().mockResolvedValue({
        platformSupported: true,
        profiles: [profile]
      }),
      previewImport: vi.fn().mockResolvedValue({
        token: 'preview-token',
        profile,
        cookieCount: 3,
        skippedExpired: 0,
        skippedPartitioned: 0
      }),
      applyImport: vi.fn().mockRejectedValue(new Error('source_changed at /private/Chrome/Cookies'))
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wrapper = await setup(browserClient)

    await findButtonByText(wrapper, 'settings.data.yoBrowser.import.preview').trigger('click')
    await flushPromises()
    await findButtonByText(wrapper, 'settings.data.yoBrowser.import.confirm').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('settings.data.yoBrowser.import.previewExpired')
    expect(wrapper.text()).not.toContain('/private/Chrome/Cookies')
    expect(consoleError).toHaveBeenCalledWith(
      '[BrowserDataImportDialog] Browser data import failed',
      expect.any(Error)
    )

    wrapper.unmount()
    consoleError.mockRestore()
  })
})
