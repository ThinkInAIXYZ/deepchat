import { describe, expect, it, vi } from 'vitest'
import { defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { OcrRuntimeStatus } from '../../../src/shared/contracts/routes/ocr.routes'

const AVAILABLE_STATUS: OcrRuntimeStatus = {
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

const SELECT_UPDATE_KEY = Symbol('select-update')

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })
const buttonStub = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    props: { disabled: Boolean },
    template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

async function setup(
  status: OcrRuntimeStatus | Error = AVAILABLE_STATUS,
  settingsError = false,
  realAlertDialog = false
) {
  vi.resetModules()
  const settingsClient = {
    getSnapshot: settingsError
      ? vi.fn().mockRejectedValue(new Error('settings unavailable'))
      : vi.fn().mockResolvedValue({
          ocrAutoExtractForNonVisionModels: true,
          ocrBackend: 'auto'
        }),
    update: vi.fn().mockResolvedValue({ values: {} })
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
  const resumePolling = vi.fn()
  const pausePolling = vi.fn()
  const documentVisibility = ref<DocumentVisibilityState>('visible')
  const windowFocused = ref(true)
  const useIntervalFn = vi.fn(() => ({ resume: resumePolling, pause: pausePolling }))
  const notifyRenderer = vi.fn(() => true)

  vi.doMock('@api/SettingsClient', () => ({ createSettingsClient: () => settingsClient }))
  vi.doMock('@api/OcrClient', () => ({ createOcrClient: () => ocrClient }))
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('@vueuse/core', async (importOriginal) => {
    const original = await importOriginal<typeof import('@vueuse/core')>()
    return {
      ...original,
      useDocumentVisibility: () => documentVisibility,
      useIntervalFn,
      useWindowFocus: () => windowFocused
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
    ...(realAlertDialog ? { attachTo: document.body } : {}),
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
            '<button v-bind="$attrs" :disabled="disabled" :data-model-value="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
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
        DcButton: buttonStub('Button'),
        Alert: passthrough('Alert'),
        AlertTitle: passthrough('AlertTitle'),
        AlertDescription: passthrough('AlertDescription'),
        AlertDialog: realAlertDialog
          ? false
          : defineComponent({
              name: 'AlertDialog',
              props: { open: Boolean },
              template: '<div v-if="open"><slot /></div>'
            }),
        AlertDialogContent: realAlertDialog ? false : passthrough('AlertDialogContent'),
        AlertDialogHeader: realAlertDialog ? false : passthrough('AlertDialogHeader'),
        AlertDialogTitle: realAlertDialog ? false : passthrough('AlertDialogTitle'),
        AlertDialogDescription: realAlertDialog ? false : passthrough('AlertDialogDescription'),
        AlertDialogFooter: realAlertDialog ? false : passthrough('AlertDialogFooter'),
        AlertDialogCancel: realAlertDialog ? false : buttonStub('AlertDialogCancel'),
        AlertDialogAction: realAlertDialog ? false : buttonStub('AlertDialogAction'),
        AlertDialogAsyncAction: realAlertDialog ? false : buttonStub('AlertDialogAsyncAction')
      }
    }
  })
  await flushPromises()

  return {
    wrapper,
    settingsClient,
    ocrClient,
    notifyRenderer,
    documentVisibility,
    windowFocused,
    pausePolling,
    resumePolling,
    useIntervalFn
  }
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

  it('polls only while the renderer is visible and focused', async () => {
    const {
      ocrClient,
      documentVisibility,
      windowFocused,
      pausePolling,
      resumePolling,
      useIntervalFn
    } = await setup()
    const pollStatus = useIntervalFn.mock.calls[0]?.[0] as () => Promise<void>

    documentVisibility.value = 'hidden'
    await flushPromises()
    await pollStatus()

    expect(pausePolling).toHaveBeenCalled()
    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledOnce()

    documentVisibility.value = 'visible'
    await flushPromises()

    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledTimes(2)
    expect(resumePolling).toHaveBeenCalledTimes(2)

    windowFocused.value = false
    await flushPromises()
    await pollStatus()

    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledTimes(2)

    windowFocused.value = true
    await flushPromises()

    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledTimes(3)
    expect(resumePolling).toHaveBeenCalledTimes(3)
  })

  it('does not overwrite persisted values when the initial settings snapshot fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, settingsClient, notifyRenderer } = await setup(AVAILABLE_STATUS, true)

    expect(
      wrapper.get('[data-testid="ocr-auto-extract-switch"]').attributes('disabled')
    ).toBeDefined()
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.ocr.loadFailed',
        title: 'settings.ocr.loadFailed'
      })
    )
    expect(wrapper.text()).not.toContain('settings unavailable')
    await wrapper.get('[data-testid="ocr-auto-extract-switch"]').trigger('click')

    expect(settingsClient.update).not.toHaveBeenCalled()
    consoleError.mockRestore()
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

  it('keeps the committed OCR setting when persistence fails', async () => {
    const { wrapper, settingsClient, notifyRenderer } = await setup()
    settingsClient.update.mockRejectedValueOnce(new Error('secret settings path'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const autoExtractSwitch = wrapper.get('[data-testid="ocr-auto-extract-switch"]')
    expect(autoExtractSwitch.attributes('data-model-value')).toBe('true')

    await autoExtractSwitch.trigger('click')
    await flushPromises()

    expect(autoExtractSwitch.attributes('data-model-value')).toBe('true')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.ocr.updateFailed',
        title: 'settings.ocr.updateFailed'
      })
    )
    expect(wrapper.text()).not.toContain('secret settings path')
    consoleError.mockRestore()
  })

  it('shows unsupported targets explicitly and prevents cache initialization', async () => {
    const { wrapper, ocrClient } = await setup({
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
    })

    expect(wrapper.text()).toContain('settings.ocr.unavailableReasons.unsupported_platform')
    await openAdvanced(wrapper)
    expect(wrapper.find('[data-testid="ocr-clear-cache"]').exists()).toBe(false)
    expect(ocrClient.clearCache).not.toHaveBeenCalled()
  })

  it('clears only the derived cache after confirmation', async () => {
    const { wrapper, ocrClient, notifyRenderer } = await setup(
      {
        ...AVAILABLE_STATUS,
        cache: {
          mode: 'persistent',
          entryCount: 4,
          logicalBytes: 4096,
          maxBytes: 256 * 1024 * 1024
        }
      },
      false,
      true
    )

    await openAdvanced(wrapper)
    await wrapper.get('[data-testid="ocr-clear-cache"]').trigger('click')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="ocr-clear-cache-confirm"]')!.click()
    await flushPromises()

    expect(ocrClient.clearCache).toHaveBeenCalledOnce()
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'success',
      code: 'settings.ocr.cacheCleared',
      title: 'settings.ocr.cacheCleared',
      description: 'settings.ocr.cacheClearedDescription'
    })
    expect(wrapper.text()).toContain('settings.ocr.cacheEntries')
    expect(document.querySelector('[data-testid="ocr-clear-cache-confirm"]')).toBeNull()
    wrapper.unmount()
  })

  it('keeps the cache confirmation open when clearing fails', async () => {
    const { wrapper, ocrClient, notifyRenderer } = await setup(
      {
        ...AVAILABLE_STATUS,
        cache: {
          mode: 'persistent',
          entryCount: 4,
          logicalBytes: 4096,
          maxBytes: 256 * 1024 * 1024
        }
      },
      false,
      true
    )
    const pending = deferred<Awaited<ReturnType<typeof ocrClient.clearCache>>>()
    ocrClient.clearCache.mockReturnValueOnce(pending.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    notifyRenderer.mockClear()

    await openAdvanced(wrapper)
    await wrapper.get('[data-testid="ocr-clear-cache"]').trigger('click')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="ocr-clear-cache-confirm"]')!.click()
    await flushPromises()

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="ocr-clear-cache-confirm"]')?.disabled
    ).toBe(true)
    expect(document.querySelector('[data-testid="ocr-clear-cache-spinner"]')).not.toBeNull()

    pending.reject(new Error('secret cache path'))
    await flushPromises()

    expect(document.querySelector('[data-testid="ocr-clear-cache-confirm"]')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'settings.ocr.clearCacheFailed'
    )
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('secret cache path')

    document.querySelector<HTMLButtonElement>('[data-testid="ocr-clear-cache-confirm"]')!.click()
    await flushPromises()

    expect(ocrClient.clearCache).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-testid="ocr-clear-cache-confirm"]')).toBeNull()
    expect(notifyRenderer).toHaveBeenCalledOnce()
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('disables an open cache confirmation when polled eligibility changes', async () => {
    const idleStatus: OcrRuntimeStatus = {
      ...AVAILABLE_STATUS,
      cache: {
        mode: 'persistent',
        entryCount: 4,
        logicalBytes: 4096,
        maxBytes: 256 * 1024 * 1024
      }
    }
    const { wrapper, ocrClient, useIntervalFn } = await setup(idleStatus, false, true)
    const pollStatus = useIntervalFn.mock.calls[0]?.[0] as () => Promise<void>

    await openAdvanced(wrapper)
    await wrapper.get('[data-testid="ocr-clear-cache"]').trigger('click')
    await flushPromises()

    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-testid="ocr-clear-cache-confirm"]'
    )!
    expect(confirm.disabled).toBe(false)

    ocrClient.getRuntimeStatus.mockResolvedValueOnce({
      ...idleStatus,
      process: {
        state: 'busy',
        nodeVersion: 'v24.18.0',
        queuedRequests: 0,
        pendingInputBytes: 1024,
        engine: null
      }
    })
    await pollStatus()
    await flushPromises()

    expect(confirm.disabled).toBe(true)
    confirm.click()
    expect(ocrClient.clearCache).not.toHaveBeenCalled()

    ocrClient.getRuntimeStatus.mockResolvedValueOnce(idleStatus)
    await pollStatus()
    await flushPromises()

    expect(confirm.disabled).toBe(false)
    wrapper.unmount()
  })

  it('does not offer cache clearing while extraction is active', async () => {
    const { wrapper } = await setup({
      ...AVAILABLE_STATUS,
      process: {
        state: 'busy',
        nodeVersion: 'v24.18.0',
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

  it('keeps one recoverable inline alert while runtime status is stale', async () => {
    const { wrapper, ocrClient, useIntervalFn } = await setup({
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
    expect(wrapper.findAll('[data-testid="ocr-status-stale"]')).toHaveLength(1)

    ocrClient.getRuntimeStatus.mockResolvedValueOnce(AVAILABLE_STATUS)
    await pollStatus()
    await flushPromises()

    expect(wrapper.find('[data-testid="ocr-status-stale"]').exists()).toBe(false)

    await pollStatus()
    await flushPromises()

    expect(wrapper.get('[data-testid="ocr-status-stale"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="ocr-status-stale"]')).toHaveLength(1)
  })

  it('offers recovery when the initial runtime status check fails', async () => {
    const { wrapper, ocrClient } = await setup(new Error('runtime status unavailable'))

    expect(wrapper.get('[data-testid="ocr-status-stale"]').text()).toContain(
      'settings.ocr.statusLoadFailed'
    )
    ocrClient.getRuntimeStatus.mockResolvedValueOnce(AVAILABLE_STATUS)
    await wrapper.get('[data-testid="ocr-retry-status"]').trigger('click')
    await flushPromises()

    expect(ocrClient.getRuntimeStatus).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="ocr-status-stale"]').exists()).toBe(false)
  })
})
