import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_EVENTS } from '../../../../src/main/events'
import type { LLM_PROVIDER } from '../../../../src/shared/presenter'

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    send: vi.fn(),
    sendToMain: vi.fn(),
    sendToRenderer: vi.fn(),
    emit: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {}
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getLocale: vi.fn(() => 'en-US')
  },
  nativeTheme: {
    shouldUseDarkColors: false
  },
  shell: {
    openPath: vi.fn()
  }
}))

import {
  ConfigPresenter,
  getDeprecatedProviderModelSelectionKeysToClear,
  removeDeprecatedBuiltinProviders
} from '../../../../src/main/presenter/configPresenter'
import { eventBus } from '@/eventbus'

const createProvider = (id: string): LLM_PROVIDER => ({
  id,
  name: id,
  apiType: 'openai-completions',
  apiKey: '',
  baseUrl: '',
  enable: false,
  websites: {
    official: '',
    apiKey: '',
    docs: '',
    models: '',
    defaultBaseUrl: ''
  }
})

const createModelSelection = (providerId: string, modelId: string) => ({
  providerId,
  modelId
})

describe('removeDeprecatedBuiltinProviders', () => {
  it('removes deprecated builtin providers from persisted provider lists', () => {
    const providers = [createProvider('openai'), createProvider('qwenlm'), createProvider('laoshi')]

    expect(removeDeprecatedBuiltinProviders(providers)).toEqual([createProvider('openai')])
  })
})

describe('getDeprecatedProviderModelSelectionKeysToClear', () => {
  it('returns all model selection keys that still point to removed providers', () => {
    const keys = getDeprecatedProviderModelSelectionKeysToClear({
      defaultModel: { providerId: 'laoshi', modelId: 'test-1' },
      assistantModel: { providerId: 'qwenlm', modelId: 'test-2' },
      defaultVisionModel: { providerId: 'openai', modelId: 'gpt-4o' },
      preferredModel: { providerId: 'laoshi', modelId: 'test-3' }
    })

    expect(keys).toEqual(['defaultModel', 'assistantModel', 'preferredModel'])
  })
})

describe('cleanupDeprecatedBuiltinProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cleans persisted providers and stale model selections in one pass', () => {
    const selectionStore = new Map<string, unknown>([
      ['defaultModel', { providerId: 'laoshi', modelId: 'test-default' }],
      ['assistantModel', { providerId: 'laoshi', modelId: 'test-assistant' }],
      ['defaultVisionModel', { providerId: 'laoshi', modelId: 'test-vision' }],
      ['preferredModel', { providerId: 'laoshi', modelId: 'test-preferred' }]
    ])

    const store = {
      get: vi.fn((key: string) => selectionStore.get(key)),
      delete: vi.fn((key: string) => {
        selectionStore.delete(key)
      })
    }
    const getProviders = vi
      .fn()
      .mockReturnValue([createProvider('openai'), createProvider('laoshi')])
    const setProviders = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getProviders,
      setProviders
    })

    ;(
      presenter as ConfigPresenter & {
        cleanupDeprecatedBuiltinProviders: () => void
      }
    ).cleanupDeprecatedBuiltinProviders()

    expect(setProviders).toHaveBeenCalledWith([createProvider('openai')])
    expect(store.delete).toHaveBeenCalledWith('defaultModel')
    expect(store.delete).toHaveBeenCalledWith('assistantModel')
    expect(store.delete).toHaveBeenCalledWith('defaultVisionModel')
    expect(store.delete).toHaveBeenCalledWith('preferredModel')
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'defaultModel',
      undefined
    )
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'assistantModel',
      undefined
    )
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'defaultVisionModel',
      undefined
    )
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'preferredModel',
      undefined
    )
  })

  it('is a no-op when no deprecated providers or selections are present', () => {
    const selectionStore = new Map<string, unknown>([
      ['defaultModel', { providerId: 'openai', modelId: 'gpt-4o' }]
    ])

    const store = {
      get: vi.fn((key: string) => selectionStore.get(key)),
      delete: vi.fn()
    }
    const getProviders = vi.fn().mockReturnValue([createProvider('openai')])
    const setProviders = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getProviders,
      setProviders
    })

    ;(
      presenter as ConfigPresenter & {
        cleanupDeprecatedBuiltinProviders: () => void
      }
    ).cleanupDeprecatedBuiltinProviders()

    expect(setProviders).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
    expect(eventBus.sendToMain).not.toHaveBeenCalled()
  })
})

describe('cleanupDeprecatedBuiltinAgentSelections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears deprecated model selections persisted in builtin agent config', () => {
    const getBuiltinDeepChatConfig = vi.fn().mockReturnValue({
      defaultModelPreset: { providerId: 'laoshi', modelId: 'test-default' },
      assistantModel: { providerId: 'qwenlm', modelId: 'test-assistant' },
      visionModel: { providerId: 'laoshi', modelId: 'test-vision' }
    })
    const updateBuiltinDeepChatConfig = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      getBuiltinDeepChatConfig,
      updateBuiltinDeepChatConfig
    })

    ;(
      presenter as ConfigPresenter & {
        cleanupDeprecatedBuiltinAgentSelections: () => void
      }
    ).cleanupDeprecatedBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      defaultModelPreset: null,
      assistantModel: null,
      visionModel: null
    })
  })

  it('does nothing when builtin agent config only references live providers', () => {
    const getBuiltinDeepChatConfig = vi.fn().mockReturnValue({
      defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4o' },
      assistantModel: { providerId: 'anthropic', modelId: 'claude-sonnet' },
      visionModel: { providerId: 'google', modelId: 'gemini-2.5-flash' }
    })
    const updateBuiltinDeepChatConfig = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      getBuiltinDeepChatConfig,
      updateBuiltinDeepChatConfig
    })

    ;(
      presenter as ConfigPresenter & {
        cleanupDeprecatedBuiltinAgentSelections: () => void
      }
    ).cleanupDeprecatedBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).not.toHaveBeenCalled()
  })
})

describe('reconcileLegacyBuiltinAgentSelections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reconciles live legacy default and assistant selections into deprecated builtin config', () => {
    const selectionStore = new Map<string, unknown>([
      ['defaultModel', createModelSelection(' openai ', 'gpt-4o')],
      ['assistantModel', createModelSelection('openai', 'gpt-4o-mini')]
    ])
    const store = {
      get: vi.fn((key: string) => selectionStore.get(key)),
      delete: vi.fn()
    }
    const builtinConfig = {
      defaultModelPreset: createModelSelection('laoshi', 'legacy-default'),
      assistantModel: createModelSelection('qwenlm', 'legacy-assistant')
    }
    const updateBuiltinDeepChatConfig = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getBuiltinDeepChatConfig: vi.fn(() => builtinConfig),
      updateBuiltinDeepChatConfig
    })

    ;(
      presenter as ConfigPresenter & {
        reconcileLegacyBuiltinAgentSelections: () => void
      }
    ).reconcileLegacyBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      defaultModelPreset: createModelSelection('openai', 'gpt-4o'),
      assistantModel: createModelSelection('openai', 'gpt-4o-mini')
    })
    expect(store.delete).not.toHaveBeenCalled()
    expect(eventBus.sendToMain).not.toHaveBeenCalled()
  })

  it('reconciles live legacy vision selection and clears the legacy store key', () => {
    const selectionStore = new Map<string, unknown>([
      ['defaultVisionModel', createModelSelection('google', 'gemini-2.5-flash')]
    ])
    const store = {
      get: vi.fn((key: string) => selectionStore.get(key)),
      delete: vi.fn((key: string) => {
        selectionStore.delete(key)
      })
    }
    const builtinConfig = {
      visionModel: createModelSelection('qwenlm', 'legacy-vision')
    }
    const updateBuiltinDeepChatConfig = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getBuiltinDeepChatConfig: vi.fn(() => builtinConfig),
      updateBuiltinDeepChatConfig
    })

    ;(
      presenter as ConfigPresenter & {
        reconcileLegacyBuiltinAgentSelections: () => void
      }
    ).reconcileLegacyBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      visionModel: createModelSelection('google', 'gemini-2.5-flash')
    })
    expect(store.delete).toHaveBeenCalledWith('defaultVisionModel')
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'defaultVisionModel',
      undefined
    )
  })

  it('does not overwrite live builtin selections with legacy store values', () => {
    const selectionStore = new Map<string, unknown>([
      ['defaultModel', createModelSelection('openai', 'gpt-4o')],
      ['assistantModel', createModelSelection('google', 'gemini-2.5-pro')],
      ['defaultVisionModel', createModelSelection('google', 'gemini-2.5-flash')]
    ])
    const store = {
      get: vi.fn((key: string) => selectionStore.get(key)),
      delete: vi.fn((key: string) => {
        selectionStore.delete(key)
      })
    }
    const builtinConfig = {
      defaultModelPreset: createModelSelection('anthropic', 'claude-sonnet-4'),
      assistantModel: createModelSelection('openai', 'gpt-4.1-mini'),
      visionModel: createModelSelection('google', 'gemini-2.5-pro')
    }
    const updateBuiltinDeepChatConfig = vi.fn()

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getBuiltinDeepChatConfig: vi.fn(() => builtinConfig),
      updateBuiltinDeepChatConfig
    })

    ;(
      presenter as ConfigPresenter & {
        reconcileLegacyBuiltinAgentSelections: () => void
      }
    ).reconcileLegacyBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).not.toHaveBeenCalled()
    expect(store.delete).toHaveBeenCalledWith('defaultVisionModel')
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'defaultVisionModel',
      undefined
    )
  })
})

describe('setAgentRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears deprecated builtin selections during repository attach when no live legacy fallback exists', () => {
    const selectionStore = new Map<string, unknown>()
    const builtinConfig: {
      defaultModelPreset?: { providerId: string; modelId: string } | null
      assistantModel?: { providerId: string; modelId: string } | null
      visionModel?: { providerId: string; modelId: string } | null
    } = {
      defaultModelPreset: createModelSelection('laoshi', 'legacy-default'),
      assistantModel: createModelSelection('qwenlm', 'legacy-assistant'),
      visionModel: createModelSelection('laoshi', 'legacy-vision')
    }
    const store = {
      get: vi.fn((key: string) => selectionStore.get(key)),
      delete: vi.fn()
    }
    const updateBuiltinDeepChatConfig = vi.fn(
      (updates: {
        defaultModelPreset?: { providerId: string; modelId: string } | null
        assistantModel?: { providerId: string; modelId: string } | null
        visionModel?: { providerId: string; modelId: string } | null
      }) => {
        Object.assign(builtinConfig, updates)
      }
    )
    const agentRepository = {} as never

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      initializeUnifiedAgents: vi.fn(),
      getBuiltinDeepChatConfig: vi.fn(() => builtinConfig),
      updateBuiltinDeepChatConfig
    })

    ;(presenter as ConfigPresenter).setAgentRepository(agentRepository)

    expect((presenter as ConfigPresenter & { agentRepository: unknown }).agentRepository).toBe(
      agentRepository
    )
    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      defaultModelPreset: null,
      assistantModel: null,
      visionModel: null
    })
    expect(builtinConfig).toEqual({
      defaultModelPreset: null,
      assistantModel: null,
      visionModel: null
    })
  })

  it('runs legacy reconciliation before deprecated builtin cleanup', () => {
    const callOrder: string[] = []
    const initializeUnifiedAgents = vi.fn(() => {
      callOrder.push('initializeUnifiedAgents')
    })
    const reconcileLegacyBuiltinAgentSelections = vi.fn(() => {
      callOrder.push('reconcileLegacyBuiltinAgentSelections')
    })
    const cleanupDeprecatedBuiltinAgentSelections = vi.fn(() => {
      callOrder.push('cleanupDeprecatedBuiltinAgentSelections')
    })
    const agentRepository = {} as never

    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      initializeUnifiedAgents,
      reconcileLegacyBuiltinAgentSelections,
      cleanupDeprecatedBuiltinAgentSelections
    })

    ;(presenter as ConfigPresenter).setAgentRepository(agentRepository)

    expect((presenter as ConfigPresenter & { agentRepository: unknown }).agentRepository).toBe(
      agentRepository
    )
    expect(callOrder).toEqual([
      'initializeUnifiedAgents',
      'reconcileLegacyBuiltinAgentSelections',
      'cleanupDeprecatedBuiltinAgentSelections'
    ])
  })
})
