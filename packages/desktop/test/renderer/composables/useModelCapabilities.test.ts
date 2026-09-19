import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelClient = vi.hoisted(() => ({
  getCapabilities: vi.fn()
}))

vi.mock('@api/ModelClient', () => ({
  createModelClient: vi.fn(() => modelClient)
}))

import {
  resolveGenerationParameterControl,
  useModelCapabilities
} from '@/composables/useModelCapabilities'
import {
  applyRequestParameterPolicy,
  resolveCapabilityAwareRequestParameterPolicy,
  type ModelRequestPolicy
} from '@shared/modelRequestPolicy'

const passthroughPolicy = (): ModelRequestPolicy => ({
  temperature: { mode: 'passthrough' },
  topP: { mode: 'passthrough' },
  reasoning: { mode: 'passthrough' },
  legacyThinking: { mode: 'passthrough' }
})

const createCapabilities = (
  overrides: Record<string, unknown> = {},
  requestPolicy: ModelRequestPolicy = passthroughPolicy()
) => ({
  identity: {
    providerId: 'openai',
    requestModelId: 'gpt-4',
    catalogMatched: false as const,
    catalogModelId: null
  },
  requestPolicy,
  supportsAudioInput: false,
  supportsReasoning: false,
  reasoningPortrait: null,
  thinkingBudgetRange: {},
  supportsSearch: false,
  searchDefaults: {},
  supportsTemperatureControl: true,
  temperatureCapability: true,
  supportsReasoningEffort: false,
  reasoningEffortDefault: undefined,
  supportsVerbosity: false,
  verbosityDefault: undefined,
  ...overrides
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('useModelCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches one atomic snapshot and resets when ids are missing', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-4')
    modelClient.getCapabilities.mockResolvedValue(
      createCapabilities(
        {
          supportsReasoning: true,
          reasoningPortrait: {
            budget: { min: 100, max: 200, default: -1, auto: -1, off: 0, unit: 'tokens' }
          },
          thinkingBudgetRange: { min: 100, max: 200 },
          supportsSearch: true,
          searchDefaults: {
            default: true,
            forced: false,
            strategy: 'turbo'
          },
          supportsTemperatureControl: false,
          temperatureCapability: false
        },
        {
          ...passthroughPolicy(),
          temperature: { mode: 'omit' }
        }
      )
    )

    const api = useModelCapabilities({ providerId, modelId })
    await vi.waitFor(() => expect(api.status.value).toBe('ready'))

    expect(api.supportsReasoning.value).toBe(true)
    expect(api.budgetRange.value).toMatchObject({
      max: 200,
      auto: -1,
      off: 0,
      unit: 'tokens'
    })
    expect(api.supportsSearch.value).toBe(true)
    expect(api.searchDefaults.value?.strategy).toBe('turbo')
    expect(api.requestPolicy.value?.temperature).toEqual({ mode: 'omit' })
    expect(api.temperatureControl.value).toEqual({ mode: 'hidden' })

    providerId.value = undefined
    await vi.waitFor(() => expect(api.status.value).toBe('idle'))
    expect(api.snapshot.value).toBeNull()
    expect(api.supportsReasoning.value).toBeNull()
    expect(api.budgetRange.value).toBeNull()
    expect(api.temperatureControl.value).toEqual({ mode: 'hidden' })
  })

  it('preserves successful unknown temperature as editable passthrough', async () => {
    const providerId = ref<string | undefined>('custom')
    const modelId = ref<string | undefined>('custom-model')
    modelClient.getCapabilities.mockResolvedValue(
      createCapabilities({
        supportsTemperatureControl: true,
        temperatureCapability: undefined
      })
    )

    const api = useModelCapabilities({ providerId, modelId })

    await vi.waitFor(() => expect(api.status.value).toBe('ready'))
    expect(api.requestPolicy.value?.temperature).toEqual({ mode: 'passthrough' })
    expect(api.temperatureControl.value).toEqual({ mode: 'editable' })
  })

  it('projects the effective policy without reconstructing it from legacy capability flags', async () => {
    const api = useModelCapabilities()
    modelClient.getCapabilities.mockResolvedValue(
      createCapabilities({
        supportsTemperatureControl: false,
        temperatureCapability: false
      })
    )

    await api.load({ providerId: 'openai', modelId: 'contract-fixture' })

    expect(api.requestPolicy.value?.temperature).toEqual({ mode: 'passthrough' })
    expect(api.temperatureControl.value).toEqual({ mode: 'editable' })
  })

  it('hides Aihubmix K3 from explicit policy even when catalog temperature is unknown', async () => {
    const providerId = ref<string | undefined>('aihubmix')
    const modelId = ref<string | undefined>('kimi-k3')
    modelClient.getCapabilities.mockResolvedValue(
      createCapabilities(
        {
          identity: {
            providerId: 'aihubmix',
            requestModelId: 'kimi-k3',
            catalogMatched: true,
            catalogModelId: 'kimi-k3'
          },
          supportsTemperatureControl: true,
          temperatureCapability: undefined
        },
        {
          temperature: { mode: 'omit' },
          topP: { mode: 'omit' },
          reasoning: { mode: 'fixed', value: true },
          legacyThinking: { mode: 'omit' }
        }
      )
    )

    const api = useModelCapabilities({ providerId, modelId })

    await vi.waitFor(() => expect(api.status.value).toBe('ready'))
    expect(api.temperatureControl.value).toEqual({ mode: 'hidden' })
    expect(api.topPControl.value).toEqual({ mode: 'hidden' })
  })

  it.each([
    {
      name: 'passthrough',
      policy: { mode: 'passthrough' } as const,
      capability: true,
      control: { mode: 'editable' },
      wire: 0.7
    },
    {
      name: 'fixed',
      policy: { mode: 'fixed', value: 1 } as const,
      capability: false,
      control: { mode: 'fixed', value: 1 },
      wire: 1
    },
    {
      name: 'capability-derived omit',
      policy: { mode: 'passthrough' } as const,
      capability: false,
      control: { mode: 'hidden' },
      wire: undefined
    },
    {
      name: 'explicit omit',
      policy: { mode: 'omit' } as const,
      capability: undefined,
      control: { mode: 'hidden' },
      wire: undefined
    }
  ])(
    'keeps renderer and wire decisions aligned for $name',
    ({ policy, capability, control, wire }) => {
      const effectivePolicy = resolveCapabilityAwareRequestParameterPolicy(policy, capability)

      expect(resolveGenerationParameterControl(effectivePolicy, 'ready')).toEqual(control)
      expect(applyRequestParameterPolicy(effectivePolicy, 0.7)).toBe(wire)
    }
  )

  it('keeps budget range null when capabilities have no budget metadata', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-4o')
    modelClient.getCapabilities.mockResolvedValue(createCapabilities())

    const api = useModelCapabilities({ providerId, modelId })

    await vi.waitFor(() => expect(api.status.value).toBe('ready'))
    expect(api.budgetRange.value).toBeNull()
  })

  it('merges thinking budget range with reasoning portrait sentinels', async () => {
    const providerId = ref<string | undefined>('openrouter')
    const modelId = ref<string | undefined>('google/gemini-2.5-flash')
    modelClient.getCapabilities.mockResolvedValue(
      createCapabilities({
        supportsReasoning: true,
        reasoningPortrait: {
          budget: { auto: -1, off: 0, unit: 'tokens' }
        },
        thinkingBudgetRange: { min: 128, max: 24576, default: 1024 }
      })
    )

    const api = useModelCapabilities({ providerId, modelId })

    await vi.waitFor(() => expect(api.status.value).toBe('ready'))
    expect(api.budgetRange.value).toEqual({
      min: 128,
      max: 24576,
      default: 1024,
      auto: -1,
      off: 0,
      unit: 'tokens'
    })
  })

  it('keeps failure distinct from passthrough while hiding failed controls', async () => {
    const pending = deferred<ReturnType<typeof createCapabilities>>()
    modelClient.getCapabilities
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('ipc unavailable'))
      .mockResolvedValueOnce(createCapabilities())
    const api = useModelCapabilities()

    const firstLoad = api.load({ providerId: 'openai', modelId: 'gpt-4' })
    expect(api.status.value).toBe('loading')
    expect(api.snapshot.value).toBeNull()
    expect(api.supportsReasoning.value).toBeNull()
    expect(api.temperatureControl.value).toEqual({ mode: 'loading' })
    expect(api.topPControl.value).toEqual({ mode: 'loading' })
    pending.resolve(createCapabilities())
    await firstLoad
    expect(api.status.value).toBe('ready')

    await api.load({ providerId: 'openai', modelId: 'gpt-4' })
    expect(api.status.value).toBe('error')
    expect(api.queryIdentity.value).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4'
    })
    expect(api.requestPolicy.value).toBeNull()
    expect(api.supportsReasoning.value).toBeNull()
    expect(api.temperatureControl.value).toEqual({ mode: 'hidden' })
    expect(api.topPControl.value).toEqual({ mode: 'hidden' })

    await api.refresh()
    expect(api.status.value).toBe('ready')
    expect(api.temperatureControl.value).toEqual({ mode: 'editable' })
  })

  it('clears stale presentation and ignores stale capability responses after model changes', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-old')
    const oldResponse = deferred<ReturnType<typeof createCapabilities>>()
    const newResponse = deferred<ReturnType<typeof createCapabilities>>()

    modelClient.getCapabilities.mockImplementation((query) =>
      query.modelId === 'gpt-old' ? oldResponse.promise : newResponse.promise
    )

    const api = useModelCapabilities({ providerId, modelId })
    await vi.waitFor(() => expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1))

    modelId.value = 'gpt-new'
    await vi.waitFor(() => expect(modelClient.getCapabilities).toHaveBeenCalledTimes(2))
    expect(api.snapshot.value).toBeNull()
    expect(api.temperatureControl.value).toEqual({ mode: 'loading' })

    newResponse.resolve(
      createCapabilities(
        {
          supportsReasoning: false,
          reasoningPortrait: { budget: { min: 10, max: 20 } },
          searchDefaults: { strategy: 'max' },
          supportsTemperatureControl: false,
          temperatureCapability: false
        },
        {
          ...passthroughPolicy(),
          temperature: { mode: 'omit' }
        }
      )
    )

    await vi.waitFor(() => expect(api.budgetRange.value?.max).toBe(20))
    expect(api.requestPolicy.value?.temperature).toEqual({ mode: 'omit' })

    oldResponse.resolve(
      createCapabilities({
        supportsReasoning: true,
        reasoningPortrait: { budget: { min: 100, max: 200 } },
        supportsSearch: true,
        searchDefaults: { strategy: 'turbo' }
      })
    )
    await Promise.resolve()

    expect(api.budgetRange.value?.max).toBe(20)
    expect(api.supportsReasoning.value).toBe(false)
    expect(api.requestPolicy.value?.temperature).toEqual({ mode: 'omit' })
  })
})
