import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '@shared/types/provider'

const switchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:model-value'],
  template:
    '<button data-testid="rate-limit-switch" @click="$emit(\'update:model-value\', !modelValue)" />'
})

const inputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: {
      type: Number,
      default: 0
    }
  },
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" />'
})

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const createProvider = (): LLM_PROVIDER =>
  ({
    id: 'deepseek',
    name: 'DeepSeek',
    apiType: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/v1',
    enable: true,
    rateLimit: {
      enabled: false,
      qpsLimit: 0.5
    }
  }) as LLM_PROVIDER

async function setup(
  options: {
    provider?: LLM_PROVIDER
    realAlertDialog?: boolean
  } = {}
) {
  vi.resetModules()

  let rateLimitListener: ((payload: { providerId: string; version: number }) => void) | null = null
  const stopRateLimitEvents = vi.fn()
  const providerClient = {
    getProviderRateLimitStatus: vi.fn().mockResolvedValue({
      config: {
        enabled: false,
        qpsLimit: 0.5
      },
      currentQps: 0,
      queueLength: 0,
      lastRequestTime: 0
    }),
    updateProviderRateLimit: vi.fn().mockResolvedValue({
      enabled: true,
      qpsLimit: 0.5
    }),
    onRateLimitEvent: vi.fn(
      (listener: (payload: { providerId: string; version: number }) => void) => {
        rateLimitListener = listener
        return stopRateLimitEvents
      }
    )
  }

  vi.doMock('@api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@shadcn/components/ui/switch', () => ({
    Switch: switchStub
  }))
  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: inputStub
  }))
  vi.doMock('@shadcn/components/ui/label', () => ({
    Label: passthrough('Label')
  }))
  if (options.realAlertDialog) {
    vi.doUnmock('@shadcn/components/ui/alert-dialog')
  } else {
    vi.doMock('@shadcn/components/ui/alert-dialog', () => ({
      AlertDialog: passthrough('AlertDialog'),
      AlertDialogAction: passthrough('AlertDialogAction'),
      AlertDialogAsyncAction: passthrough('AlertDialogAsyncAction'),
      AlertDialogCancel: passthrough('AlertDialogCancel'),
      AlertDialogContent: passthrough('AlertDialogContent'),
      AlertDialogDescription: passthrough('AlertDialogDescription'),
      AlertDialogFooter: passthrough('AlertDialogFooter'),
      AlertDialogHeader: passthrough('AlertDialogHeader'),
      AlertDialogTitle: passthrough('AlertDialogTitle')
    }))
  }
  const ProviderRateLimitConfig = (
    await import('../../../src/renderer/settings/components/ProviderRateLimitConfig.vue')
  ).default

  const wrapper = mount(ProviderRateLimitConfig, {
    ...(options.realAlertDialog ? { attachTo: document.body } : {}),
    props: {
      provider: options.provider ?? createProvider()
    }
  })
  await flushPromises()

  return {
    wrapper,
    providerClient,
    stopRateLimitEvents,
    emitRateLimitEvent: (payload: { providerId: string; version: number }) =>
      rateLimitListener?.(payload)
  }
}

describe('ProviderRateLimitConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads, updates, listens, and cleans up through ProviderClient', async () => {
    const { wrapper, providerClient, stopRateLimitEvents, emitRateLimitEvent } = await setup()

    expect(providerClient.getProviderRateLimitStatus).toHaveBeenCalledWith('deepseek')
    expect(providerClient.onRateLimitEvent).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="rate-limit-switch"]').trigger('click')
    await flushPromises()

    expect(providerClient.updateProviderRateLimit).toHaveBeenCalledWith('deepseek', true, 0.5)
    expect(wrapper.emitted('configChanged')).toHaveLength(1)

    const callsAfterUpdate = providerClient.getProviderRateLimitStatus.mock.calls.length
    emitRateLimitEvent({ providerId: 'openai', version: 1 })
    await flushPromises()
    expect(providerClient.getProviderRateLimitStatus).toHaveBeenCalledTimes(callsAfterUpdate)

    emitRateLimitEvent({ providerId: 'deepseek', version: 2 })
    await flushPromises()
    expect(providerClient.getProviderRateLimitStatus).toHaveBeenCalledTimes(callsAfterUpdate + 1)

    wrapper.unmount()
    expect(stopRateLimitEvents).toHaveBeenCalledTimes(1)
  })

  it('rolls back failed updates and retries from persistent inline feedback', async () => {
    const { wrapper, providerClient } = await setup()
    providerClient.updateProviderRateLimit.mockRejectedValueOnce(new Error('transport details'))

    await wrapper.get('[data-testid="rate-limit-switch"]').trigger('click')
    await flushPromises()

    expect(wrapper.getComponent(switchStub).props('modelValue')).toBe(false)
    expect(wrapper.emitted('configChanged')).toBeUndefined()
    const failure = wrapper.get('[data-testid="inline-operation-feedback"]')
    expect(failure.attributes('data-status')).toBe('error')
    expect(failure.text()).not.toContain('transport details')

    const retry = wrapper.findAll('button').find((button) => button.text().includes('common.retry'))
    expect(retry).toBeTruthy()
    await retry!.trigger('click')
    await flushPromises()

    expect(providerClient.updateProviderRateLimit).toHaveBeenCalledTimes(2)
    expect(wrapper.getComponent(switchStub).props('modelValue')).toBe(true)
    expect(wrapper.get('[data-testid="inline-operation-feedback"]').attributes('data-status')).toBe(
      'success'
    )
  })

  it('keeps a successful save truthful when status projection refresh fails', async () => {
    const { wrapper, providerClient } = await setup()
    providerClient.getProviderRateLimitStatus.mockRejectedValueOnce(new Error('status unavailable'))

    await wrapper.get('[data-testid="rate-limit-switch"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('configChanged')).toHaveLength(1)
    expect(wrapper.getComponent(switchStub).props('modelValue')).toBe(true)
    expect(wrapper.get('[data-testid="inline-operation-feedback"]').attributes('data-status')).toBe(
      'success'
    )
  })

  it('blocks settings navigation while a rate-limit write is in flight', async () => {
    const { wrapper, providerClient } = await setup()
    let resolveUpdate!: (value: { enabled: boolean; qpsLimit: number }) => void
    providerClient.updateProviderRateLimit.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve
      })
    )
    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')

    await wrapper.get('[data-testid="rate-limit-switch"]').trigger('click')
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')
    expect(wrapper.get('[data-testid="rate-limit-switch"]').attributes('disabled')).toBeDefined()

    resolveUpdate({ enabled: true, qpsLimit: 0.5 })
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
  })

  it('keeps the disable confirmation open with real primitives when persistence fails', async () => {
    const provider = createProvider()
    provider.rateLimit = {
      enabled: true,
      qpsLimit: 0.5
    }
    const { wrapper, providerClient } = await setup({
      provider,
      realAlertDialog: true
    })
    providerClient.updateProviderRateLimit.mockRejectedValueOnce(new Error('transport details'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    wrapper.getComponent(inputStub).vm.$emit('update:modelValue', 0)
    await wrapper.get('input').trigger('blur')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="rate-limit-disable-confirm"]')!.click()
    await flushPromises()

    expect(document.querySelector('[data-testid="rate-limit-disable-confirm"]')).not.toBeNull()
    const feedback = document.querySelector(
      '[data-slot="alert-dialog-content"] [data-testid="inline-operation-feedback"]'
    )
    expect(feedback?.getAttribute('data-status')).toBe('error')
    expect(feedback?.textContent).not.toContain('transport details')

    document.querySelector<HTMLButtonElement>('[data-testid="rate-limit-disable-confirm"]')!.click()
    await flushPromises()

    expect(providerClient.updateProviderRateLimit).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-testid="rate-limit-disable-confirm"]')).toBeNull()
    consoleError.mockRestore()
    wrapper.unmount()
  })

  it('coalesces polling and event refreshes while status IPC is slow', async () => {
    const { providerClient, emitRateLimitEvent } = await setup()
    let resolveStatus!: (value: {
      config: { enabled: boolean; qpsLimit: number }
      currentQps: number
      queueLength: number
      lastRequestTime: number
    }) => void
    providerClient.getProviderRateLimitStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve
      })
    )

    emitRateLimitEvent({ providerId: 'deepseek', version: 1 })
    emitRateLimitEvent({ providerId: 'deepseek', version: 2 })
    await flushPromises()

    expect(providerClient.getProviderRateLimitStatus).toHaveBeenCalledTimes(2)

    resolveStatus({
      config: { enabled: false, qpsLimit: 0.5 },
      currentQps: 0,
      queueLength: 0,
      lastRequestTime: 0
    })
    await flushPromises()

    expect(providerClient.getProviderRateLimitStatus).toHaveBeenCalledTimes(3)
  })
})
