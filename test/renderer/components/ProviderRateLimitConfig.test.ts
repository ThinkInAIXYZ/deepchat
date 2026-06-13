import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { LLM_PROVIDER } from '../../../src/shared/presenter'

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

async function setup() {
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
  vi.doMock('@shadcn/components/ui/alert-dialog', () => ({
    AlertDialog: passthrough('AlertDialog'),
    AlertDialogAction: passthrough('AlertDialogAction'),
    AlertDialogCancel: passthrough('AlertDialogCancel'),
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle')
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast: vi.fn()
    })
  }))

  const ProviderRateLimitConfig = (
    await import('../../../src/renderer/settings/components/ProviderRateLimitConfig.vue')
  ).default

  const wrapper = mount(ProviderRateLimitConfig, {
    props: {
      provider: createProvider()
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
})
