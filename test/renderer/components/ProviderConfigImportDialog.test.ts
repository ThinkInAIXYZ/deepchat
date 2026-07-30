import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderImportApplyResult, ProviderImportScanResult } from '@shared/providerImport'

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
    '<div><button data-testid="dialog-close" @click="$emit(\'update:open\', false)">close</button><slot /></div>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const scanResult: ProviderImportScanResult = {
  sessionId: 'scan-session',
  sourceOrder: ['hermes', 'cc-switch', 'alma', 'cherry-studio', 'openclaw'],
  sources: [
    {
      id: 'hermes',
      name: 'Hermes',
      status: 'found',
      configPath: '~/.hermes/config.yaml',
      providerCount: 1,
      selectable: true,
      defaultSelected: true
    }
  ],
  providers: [
    {
      id: 'hermes:anthropic',
      sourceId: 'hermes',
      sourceName: 'Hermes',
      sourceProviderId: 'anthropic',
      name: 'Anthropic',
      sourceType: 'anthropic',
      targetKind: 'builtin',
      targetProviderId: 'anthropic',
      targetProviderName: 'Anthropic',
      targetApiType: 'anthropic',
      apiKeyMasked: 'sk-a...1234',
      baseUrl: 'https://api.anthropic.com',
      modelCount: 1,
      modelPreview: ['claude-sonnet'],
      configured: false,
      selectable: true,
      defaultSelected: true,
      warnings: []
    }
  ]
}

const applyResult: ProviderImportApplyResult = {
  summary: {
    imported: 1,
    created: 1,
    updated: 0,
    skipped: 0,
    overwritten: 0,
    models: 1
  },
  results: [
    {
      id: 'hermes:anthropic',
      sourceId: 'hermes',
      sourceName: 'Hermes',
      sourceProviderId: 'anthropic',
      name: 'Anthropic',
      targetKind: 'builtin',
      targetProviderId: 'anthropic',
      targetProviderName: 'Anthropic',
      status: 'created',
      modelCount: 1
    }
  ]
}

const setup = async (providerClient: {
  scanProviderImports: ReturnType<typeof vi.fn>
  applyProviderImports: ReturnType<typeof vi.fn>
}) => {
  vi.resetModules()
  vi.doMock('@api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params?.message ? `${key}: ${String(params.message)}` : key
    })
  }))

  const ProviderConfigImportDialog = (
    await import('../../../src/renderer/settings/components/ProviderConfigImportDialog.vue')
  ).default
  const wrapper = mount(ProviderConfigImportDialog, {
    props: {
      open: false
    },
    global: {
      stubs: {
        Dialog: dialogStub,
        DialogContent: passthroughStub('DialogContent'),
        DialogDescription: passthroughStub('DialogDescription'),
        DialogFooter: passthroughStub('DialogFooter'),
        DialogHeader: passthroughStub('DialogHeader'),
        DialogTitle: passthroughStub('DialogTitle'),
        Button: buttonStub,
        Checkbox: passthroughStub('Checkbox'),
        Badge: passthroughStub('Badge'),
        ScrollArea: passthroughStub('ScrollArea'),
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

  await wrapper.setProps({ open: true })
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

describe('ProviderConfigImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps scan failures generic and does not expose transport details', async () => {
    const providerClient = {
      scanProviderImports: vi
        .fn()
        .mockRejectedValue(new Error('Unable to read /private/config with token sk-secret')),
      applyProviderImports: vi.fn()
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wrapper = await setup(providerClient)

    expect(wrapper.text()).toContain('common.error.operationFailed')
    expect(wrapper.text()).not.toContain('/private/config')
    expect(wrapper.text()).not.toContain('sk-secret')
    expect(consoleError).toHaveBeenCalledWith(
      '[ProviderConfigImportDialog] Provider scan failed',
      expect.any(Error)
    )

    wrapper.unmount()
    consoleError.mockRestore()
  })

  it('prevents closing or leaving while provider changes are being applied', async () => {
    let resolveApply: ((result: ProviderImportApplyResult) => void) | undefined
    const providerClient = {
      scanProviderImports: vi.fn().mockResolvedValue(scanResult),
      applyProviderImports: vi.fn(
        () =>
          new Promise<ProviderImportApplyResult>((resolve) => {
            resolveApply = resolve
          })
      )
    }
    const wrapper = await setup(providerClient)

    await findButtonByText(wrapper, 'common.next').trigger('click')
    await findButtonByText(wrapper, 'settings.data.providerImport.actions.import').trigger('click')
    await flushPromises()

    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')
    expect(wrapper.text()).toContain('settings.data.providerImport.importingTitle')

    await wrapper.get('[data-testid="dialog-close"]').trigger('click')
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.text()).toContain('settings.data.providerImport.importingTitle')

    resolveApply?.(applyResult)
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    expect(wrapper.emitted('import-complete')?.[0]).toEqual([applyResult])
    wrapper.unmount()
  })
})
