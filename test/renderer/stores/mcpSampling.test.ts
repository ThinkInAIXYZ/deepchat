import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, reactive } from 'vue'
import { resolveSamplingDefaultModel } from '@/stores/mcpSampling'
import type { RENDERER_MODEL_META } from '@shared/presenter'

const makeModel = (
  id: string,
  providerId: string,
  options?: { vision?: boolean }
): RENDERER_MODEL_META => ({
  id,
  name: id,
  group: 'default',
  providerId,
  vision: options?.vision ?? false
})

describe('resolveSamplingDefaultModel', () => {
  it('prefers active session model over draft model', () => {
    const openaiModel = makeModel('gpt-4o', 'openai')
    const claudeModel = makeModel('claude-sonnet', 'anthropic')

    const result = resolveSamplingDefaultModel({
      modelGroups: [
        { providerId: 'openai', models: [openaiModel] },
        { providerId: 'anthropic', models: [claudeModel] }
      ],
      requiresVision: false,
      activeSelection: { providerId: 'openai', modelId: 'gpt-4o' },
      draftSelection: { providerId: 'anthropic', modelId: 'claude-sonnet' }
    })

    expect(result.providerId).toBe('openai')
    expect(result.model?.id).toBe('gpt-4o')
  })

  it('falls back to draft model when active selection is unavailable', () => {
    const claudeModel = makeModel('claude-sonnet', 'anthropic')

    const result = resolveSamplingDefaultModel({
      modelGroups: [{ providerId: 'anthropic', models: [claudeModel] }],
      requiresVision: false,
      activeSelection: { providerId: 'openai', modelId: 'gpt-4o' },
      draftSelection: { providerId: 'anthropic', modelId: 'claude-sonnet' }
    })

    expect(result.providerId).toBe('anthropic')
    expect(result.model?.id).toBe('claude-sonnet')
  })

  it('uses first eligible model when vision is required', () => {
    const openaiText = makeModel('gpt-4.1', 'openai', { vision: false })
    const openaiVision = makeModel('gpt-4o', 'openai', { vision: true })
    const claudeVision = makeModel('claude-3.7-sonnet', 'anthropic', { vision: true })

    const result = resolveSamplingDefaultModel({
      modelGroups: [
        { providerId: 'openai', models: [openaiText, openaiVision] },
        { providerId: 'anthropic', models: [claudeVision] }
      ],
      requiresVision: true,
      activeSelection: { providerId: 'openai', modelId: 'gpt-4.1' },
      draftSelection: null
    })

    expect(result.providerId).toBe('openai')
    expect(result.model?.id).toBe('gpt-4o')
  })
})

const setupSamplingStore = async (options?: {
  initializeModels?: () => Promise<void>
  initialEnabledModels?: Array<{ providerId: string; models: RENDERER_MODEL_META[] }>
  initialized?: boolean
}) => {
  vi.resetModules()

  let samplingRequestListener: ((payload: { request: unknown }) => void) | undefined
  const getChatSelectableModelGroups = () => modelStore.enabledModels

  const modelStore = reactive({
    initialized: options?.initialized ?? false,
    enabledModels: options?.initialEnabledModels ?? [],
    get chatSelectableModelGroups() {
      return getChatSelectableModelGroups()
    },
    findChatSelectableModel: vi.fn((providerId: string, modelId: string) => {
      const group = getChatSelectableModelGroups().find((entry) => entry.providerId === providerId)
      const model = group?.models.find((entry) => entry.id === modelId)
      if (!group || !model) {
        return null
      }
      return { providerId, providerName: providerId, model }
    }),
    pickFirstChatSelectableModel: vi.fn(() => {
      const firstGroup = getChatSelectableModelGroups()[0]
      const firstModel = firstGroup?.models[0]
      return firstGroup && firstModel
        ? {
            providerId: firstGroup.providerId,
            providerName: firstGroup.providerId,
            model: firstModel
          }
        : null
    }),
    initialize: vi.fn().mockImplementation(async () => {
      if (options?.initializeModels) {
        await options.initializeModels()
      }
      modelStore.initialized = true
    })
  })
  const providerStore = reactive({
    sortedProviders: [{ id: 'openai', name: 'OpenAI', enable: true }]
  })
  const sessionStore = reactive({
    activeSession: null
  })
  const draftStore = reactive({
    providerId: undefined as string | undefined,
    modelId: undefined as string | undefined
  })
  const mcpClient = {
    onSamplingRequest: vi.fn((listener) => {
      samplingRequestListener = listener
      return vi.fn()
    }),
    onSamplingCancelled: vi.fn(() => vi.fn()),
    onSamplingDecision: vi.fn(() => vi.fn()),
    submitSamplingDecision: vi.fn().mockResolvedValue(undefined),
    cancelSamplingRequest: vi.fn().mockResolvedValue(undefined)
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })
  vi.doMock('@api/McpClient', () => ({
    createMcpClient: () => mcpClient
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/draft', () => ({
    useDraftStore: () => draftStore
  }))

  const { useMcpSamplingStore } = await import('@/stores/mcpSampling')
  let store: ReturnType<typeof useMcpSamplingStore> | null = null
  const Harness = defineComponent({
    setup() {
      store = useMcpSamplingStore()
      return () => null
    }
  })

  mount(Harness)
  await flushPromises()

  return {
    store: store!,
    modelStore,
    emitSamplingRequest: async (request: Record<string, unknown>) => {
      samplingRequestListener?.({ request })
      await flushPromises()
    }
  }
}

describe('useMcpSamplingStore', () => {
  it('waits for full model initialization before selecting a default model', async () => {
    const openaiModel = makeModel('gpt-4o', 'openai')
    const { store, modelStore, emitSamplingRequest } = await setupSamplingStore({
      initializeModels: async () => {
        modelStore.enabledModels = [{ providerId: 'openai', models: [openaiModel] }]
      }
    })

    await emitSamplingRequest({
      requestId: 'req-1',
      serverName: 'demo-server',
      serverLabel: 'Demo Server',
      messages: [],
      requiresVision: false
    })

    expect(modelStore.initialize).toHaveBeenCalledTimes(1)
    expect(store.selectedProviderId.value).toBe('openai')
    expect(store.selectedModel.value?.id).toBe('gpt-4o')
    expect(store.isPreparingModels.value).toBe(false)
    expect(store.modelPreparationError.value).toBeNull()
  })

  it('keeps the request open on initialization failure and can retry', async () => {
    const openaiModel = makeModel('gpt-4o', 'openai')
    let shouldFail = true
    const { store, modelStore, emitSamplingRequest } = await setupSamplingStore({
      initializeModels: async () => {
        if (shouldFail) {
          throw new Error('catalog stale')
        }
        modelStore.enabledModels = [{ providerId: 'openai', models: [openaiModel] }]
      }
    })

    await emitSamplingRequest({
      requestId: 'req-2',
      serverName: 'demo-server',
      messages: [],
      requiresVision: false
    })

    expect(store.isOpen.value).toBe(true)
    expect(store.modelPreparationError.value).toBeInstanceOf(Error)
    expect(store.hasEligibleModel.value).toBe(false)

    shouldFail = false
    await store.retryPrepareModels()
    await flushPromises()

    expect(modelStore.initialize).toHaveBeenCalledTimes(2)
    expect(store.modelPreparationError.value).toBeNull()
    expect(store.selectedProviderId.value).toBe('openai')
    expect(store.selectedModel.value?.id).toBe('gpt-4o')
  })
})
