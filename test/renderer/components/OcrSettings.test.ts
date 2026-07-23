import { describe, expect, it, vi } from 'vitest'
import { defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { OcrRuntimeStatus } from '../../../src/shared/contracts/routes/ocr.routes'

const AVAILABLE_STATUS: OcrRuntimeStatus = {
  platform: 'darwin',
  arch: 'arm64',
  availability: {
    status: 'available',
    lightOcrVersion: '0.3.4',
    bundleId: 'ppocrv6-small-native-20260719.1'
  },
  process: null,
  cache: null
}

const SELECT_UPDATE_KEY = Symbol('select-update')

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })
const buttonStub = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    props: { disabled: Boolean },
    template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
  })

async function setup(status: OcrRuntimeStatus | Error = AVAILABLE_STATUS, settingsError = false) {
  vi.resetModules()
  const settingsClient = {
    getSnapshot: settingsError
      ? vi.fn().mockRejectedValue(new Error('settings unavailable'))
      : vi.fn().mockResolvedValue({
          ocrAutoExtractForNonVisionModels: true,
          ocrBackend: 'auto'
        }),
    update: vi.fn().mockResolvedValue({})
  }
  const ocrClient = {
    getRuntimeStatus:
      status instanceof Error
        ? vi.fn().mockRejectedValue(status)
        : vi.fn().mockResolvedValue(status),
    clearCache: vi.fn().mockResolvedValue({
      cache: {
        mode: 'persistent',
        entryCount: 0,
        logicalBytes: 0,
        maxBytes: 256 * 1024 * 1024
      }
    })
  }
  const toast = Object.assign(vi.fn(), { error: vi.fn() })
  const resumePolling = vi.fn()
  const useIntervalFn = vi.fn(() => ({ resume: resumePolling, pause: vi.fn() }))

  vi.doMock('@api/SettingsClient', () => ({ createSettingsClient: () => settingsClient }))
  vi.doMock('@api/OcrClient', () => ({ createOcrClient: () => ocrClient }))
  vi.doMock('vue-sonner', () => ({ toast }))
  vi.doMock('@vueuse/core', async (importOriginal) => {
    const original = await importOriginal<typeof import('@vueuse/core')>()
    return {
      ...original,
      useIntervalFn
    }
  })
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: ref('en-US'),
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key
    })
  }))

  const OcrSettings = (await import('../../../src/renderer/settings/components/OcrSettings.vue'))
    .default
  const wrapper = mount(OcrSettings, {
    global: {
      stubs: {
        SettingsPageShell: passthrough('SettingsPageShell'),
        SettingsSectionCard: defineComponent({
          name: 'SettingsSectionCard',
          template: '<section><slot name="actions" /><slot /></section>'
        }),
        Switch: defineComponent({
          name: 'Switch',
          inheritAttrs: false,
          props: { modelValue: Boolean, disabled: Boolean },
          emits: ['update:modelValue'],
          template:
            '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />'
        }),
        Select: defineComponent({
          name: 'Select',
          props: ['modelValue', 'disabled'],
          emits: ['update:modelValue'],
          setup(_props, { emit }) {
            provide(SELECT_UPDATE_KEY, (value: string) => emit('update:modelValue', value))
          },
          template: '<div><slot /></div>'
        }),
        SelectContent: passthrough('SelectContent'),
        SelectItem: defineComponent({
          name: 'SelectItem',
          props: ['value'],
          setup() {
            return { selectValue: inject<(value: string) => void>(SELECT_UPDATE_KEY) }
          },
          template:
            '<button type="button" :data-value="value" @click="selectValue?.(value)"><slot /></button>'
        }),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        Spinner: true,
        Icon: true,
        Button: buttonStub('Button'),
        Alert: passthrough('Alert'),
        AlertTitle: passthrough('AlertTitle'),
        AlertDescription: passthrough('AlertDescription'),
        AlertDialog: defineComponent({
          name: 'AlertDialog',
          props: { open: Boolean },
          template: '<div v-if="open"><slot /></div>'
        }),
        AlertDialogContent: passthrough('AlertDialogContent'),
        AlertDialogHeader: passthrough('AlertDialogHeader'),
        AlertDialogTitle: passthrough('AlertDialogTitle'),
        AlertDialogDescription: passthrough('AlertDialogDescription'),
        AlertDialogFooter: passthrough('AlertDialogFooter'),
        AlertDialogCancel: buttonStub('AlertDialogCancel'),
        AlertDialogAction: buttonStub('AlertDialogAction')
      }
    }
  })
  await flushPromises()

  return { wrapper, settingsClient, ocrClient, toast, resumePolling, useIntervalFn }
}

async function openAdvanced(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  await wrapper.get('[data-testid="ocr-advanced-toggle"]').trigger('click')
  await flushPromises()
}

async function openDiagnostics(wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) {
  await wrapper.get('[data-testid="ocr-diagnostics-toggle"]').trigger('click')
  await flushPromises()
}

describe('OcrSettings', () => {
  it('keeps healthy runtime details behind progressive disclosure', async () => {
    const { wrapper, settingsClient, ocrClient, resumePolling, useIntervalFn } = await setup()

    expect(settingsClient.getSnapshot).toHaveBeenCalledWith([
      'ocrAutoExtractForNonVisionModels',
      'ocrBackend'
    ])
    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('settings.ocr.available')
    expect(wrapper.text()).not.toContain('settings.ocr.notStarted')

    await openAdvanced(wrapper)
    expect(wrapper.text()).not.toContain('settings.ocr.available')
    expect(wrapper.find('[data-testid="ocr-clear-cache"]').exists()).toBe(false)

    await openDiagnostics(wrapper)
    expect(wrapper.text()).toContain('settings.ocr.available')
    expect(wrapper.text()).toContain('settings.ocr.notStarted')
    expect(wrapper.text()).not.toContain('settings.ocr.statusUnavailable')
    expect(useIntervalFn).toHaveBeenCalledWith(expect.any(Function), 5_000, {
      immediate: false,
      immediateCallback: false
    })
    expect(resumePolling).toHaveBeenCalledOnce()
  })

  it('does not overwrite persisted values when the initial settings snapshot fails', async () => {
    const { wrapper, settingsClient, toast } = await setup(AVAILABLE_STATUS, true)

    expect(
      wrapper.get('[data-testid="ocr-auto-extract-switch"]').attributes('disabled')
    ).toBeDefined()
    expect(toast.error).toHaveBeenCalledWith('common.error.operationFailed', {
      description: 'settings.ocr.loadFailed'
    })
    await wrapper.get('[data-testid="ocr-auto-extract-switch"]').trigger('click')

    expect(settingsClient.update).not.toHaveBeenCalled()
  })

  it('updates automatic extraction and backend through typed settings changes', async () => {
    const { wrapper, settingsClient } = await setup()

    await wrapper.get('[data-testid="ocr-auto-extract-switch"]').trigger('click')
    await flushPromises()
    await openAdvanced(wrapper)
    await wrapper.get('[data-value="cpu"]').trigger('click')
    await flushPromises()

    expect(settingsClient.update).toHaveBeenNthCalledWith(1, [
      { key: 'ocrAutoExtractForNonVisionModels', value: false }
    ])
    expect(settingsClient.update).toHaveBeenNthCalledWith(2, [{ key: 'ocrBackend', value: 'cpu' }])
  })

  it('shows unsupported targets explicitly and prevents cache initialization', async () => {
    const { wrapper, ocrClient } = await setup({
      platform: 'linux',
      arch: 'arm64',
      availability: {
        status: 'unavailable',
        reason: 'unsupported_platform',
        lightOcrVersion: '0.3.4',
        bundleId: 'ppocrv6-small-native-20260719.1'
      },
      process: null,
      cache: null
    })

    expect(wrapper.text()).toContain('settings.ocr.unavailableReasons.unsupported_platform')
    await openAdvanced(wrapper)
    expect(wrapper.find('[data-testid="ocr-clear-cache"]').exists()).toBe(false)
    expect(ocrClient.clearCache).not.toHaveBeenCalled()
  })

  it('clears only the derived cache after confirmation', async () => {
    const { wrapper, ocrClient, toast } = await setup({
      ...AVAILABLE_STATUS,
      cache: {
        mode: 'persistent',
        entryCount: 4,
        logicalBytes: 4096,
        maxBytes: 256 * 1024 * 1024
      }
    })

    await openAdvanced(wrapper)
    await wrapper.get('[data-testid="ocr-clear-cache"]').trigger('click')
    await wrapper.get('[data-testid="ocr-clear-cache-confirm"]').trigger('click')
    await flushPromises()

    expect(ocrClient.clearCache).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith('settings.ocr.cacheCleared', {
      description: 'settings.ocr.cacheClearedDescription'
    })
    expect(wrapper.text()).toContain('settings.ocr.cacheEntries')
  })

  it('does not offer cache clearing while extraction is active', async () => {
    const { wrapper } = await setup({
      ...AVAILABLE_STATUS,
      process: {
        state: 'busy',
        nodeVersion: 'v24.14.1',
        queuedRequests: 0,
        pendingInputBytes: 1024,
        engine: null
      },
      cache: {
        mode: 'persistent',
        entryCount: 1,
        logicalBytes: 1024,
        maxBytes: 256 * 1024 * 1024
      }
    })

    await openAdvanced(wrapper)
    expect(wrapper.get('[data-testid="ocr-clear-cache"]').attributes('disabled')).toBeDefined()
  })

  it('marks stale runtime status and deduplicates polling failure notifications', async () => {
    const { wrapper, ocrClient, toast, useIntervalFn } = await setup({
      ...AVAILABLE_STATUS,
      cache: {
        mode: 'persistent',
        entryCount: 1,
        logicalBytes: 1024,
        maxBytes: 256 * 1024 * 1024
      }
    })
    const pollStatus = useIntervalFn.mock.calls[0]?.[0] as () => Promise<void>

    ocrClient.getRuntimeStatus.mockRejectedValue(new Error('runtime status unavailable'))
    await pollStatus()
    await pollStatus()
    await flushPromises()

    expect(wrapper.get('[data-testid="ocr-status-stale"]').text()).toContain(
      'settings.ocr.statusLoadFailed'
    )
    expect(wrapper.get('[data-testid="ocr-retry-status"]').exists()).toBe(true)
    await openAdvanced(wrapper)
    expect(wrapper.get('[data-testid="ocr-clear-cache"]').attributes('disabled')).toBeDefined()
    expect(toast.error).toHaveBeenCalledTimes(1)

    ocrClient.getRuntimeStatus.mockResolvedValueOnce(AVAILABLE_STATUS)
    await pollStatus()
    await flushPromises()

    expect(wrapper.find('[data-testid="ocr-status-stale"]').exists()).toBe(false)

    await pollStatus()
    await flushPromises()

    expect(wrapper.get('[data-testid="ocr-status-stale"]').exists()).toBe(true)
    expect(toast.error).toHaveBeenCalledTimes(2)
  })

  it('offers recovery when the initial runtime status check fails', async () => {
    const { wrapper, ocrClient, toast } = await setup(new Error('runtime status unavailable'))

    expect(wrapper.get('[data-testid="ocr-status-stale"]').text()).toContain(
      'settings.ocr.statusLoadFailed'
    )
    expect(toast.error).toHaveBeenCalledOnce()

    ocrClient.getRuntimeStatus.mockResolvedValueOnce(AVAILABLE_STATUS)
    await wrapper.get('[data-testid="ocr-retry-status"]').trigger('click')
    await flushPromises()

    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="ocr-status-stale"]').exists()).toBe(false)
  })
})
