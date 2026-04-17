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
})
