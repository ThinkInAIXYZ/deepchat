import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '../../../../src/main/events'

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
  getAnthropicModelSelectionKeysToClear,
  normalizeAnthropicProviderForApiOnly
} from '../../../../src/main/presenter/configPresenter'

describe('normalizeAnthropicProviderForApiOnly', () => {
  const originalEnvKey = process.env.ANTHROPIC_API_KEY

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
      return
    }

    process.env.ANTHROPIC_API_KEY = originalEnvKey
  })

  it('disables legacy oauth-only anthropic configs when no API credential is available', () => {
    const normalized = normalizeAnthropicProviderForApiOnly({
      id: 'anthropic',
      name: 'Anthropic',
      apiType: 'anthropic',
      apiKey: '',
      baseUrl: 'https://custom.anthropic.local',
      enable: true,
      oauthToken: 'legacy-token',
      authMode: 'oauth'
    })

    expect(normalized).toMatchObject({
      id: 'anthropic',
      name: 'Anthropic',
      apiType: 'anthropic',
      apiKey: '',
      baseUrl: 'https://custom.anthropic.local',
      enable: false
    })
    expect(normalized).not.toHaveProperty('authMode')
    expect(normalized).not.toHaveProperty('oauthToken')
  })

  it('keeps anthropic enabled when a persisted API key exists', () => {
    const normalized = normalizeAnthropicProviderForApiOnly({
      id: 'anthropic',
      name: 'Anthropic',
      apiType: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://custom.anthropic.local',
      enable: true,
      oauthToken: 'legacy-token',
      authMode: 'oauth'
    })

    expect(normalized.enable).toBe(true)
    expect(normalized.apiKey).toBe('test-key')
    expect(normalized).not.toHaveProperty('authMode')
    expect(normalized).not.toHaveProperty('oauthToken')
  })

  it('keeps anthropic enabled when an env API key exists', () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'

    const normalized = normalizeAnthropicProviderForApiOnly({
      id: 'anthropic',
      name: 'Anthropic',
      apiType: 'anthropic',
      apiKey: '',
      baseUrl: 'https://custom.anthropic.local',
      enable: true,
      oauthToken: 'legacy-token',
      authMode: 'oauth'
    })

    expect(normalized.enable).toBe(true)
    expect(normalized).not.toHaveProperty('authMode')
    expect(normalized).not.toHaveProperty('oauthToken')
  })

  it('fills the default base URL when the saved provider is empty', () => {
    const normalized = normalizeAnthropicProviderForApiOnly(
      {
        id: 'anthropic',
        name: 'Anthropic',
        apiType: 'anthropic',
        apiKey: '',
        baseUrl: '',
        enable: false,
        authMode: 'oauth'
      },
      'https://api.anthropic.com'
    )

    expect(normalized.baseUrl).toBe('https://api.anthropic.com')
    expect(normalized).not.toHaveProperty('authMode')
  })
})

describe('getAnthropicModelSelectionKeysToClear', () => {
  it('returns anthropic default model settings that should be cleared', () => {
    const keysToClear = getAnthropicModelSelectionKeysToClear({
      defaultModel: { providerId: 'anthropic', modelId: 'claude-sonnet' },
      assistantModel: { providerId: 'anthropic', modelId: 'claude-haiku' },
      defaultVisionModel: { providerId: 'anthropic', modelId: 'claude-vision' },
      preferredModel: { providerId: 'anthropic', modelId: 'claude-opus' }
    })

    expect(keysToClear).toEqual(['defaultModel', 'assistantModel', 'defaultVisionModel'])
  })

  it('does not clear model settings for other providers', () => {
    const keysToClear = getAnthropicModelSelectionKeysToClear({
      defaultModel: { providerId: 'openai', modelId: 'gpt-4o' },
      assistantModel: { providerId: 'google', modelId: 'gemini-2.0-flash' },
      defaultVisionModel: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    expect(keysToClear).toEqual([])
  })
})

describe('migrateLegacyDefaultVisionModelToBuiltinAgent', () => {
  it('migrates a valid legacy vision model with trimmed ids', () => {
    const store = {
      get: vi.fn().mockReturnValue({ providerId: ' openai ', modelId: ' gpt-4o ' }),
      delete: vi.fn()
    }
    const updateBuiltinDeepChatConfig = vi.fn()
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getBuiltinDeepChatConfig: vi.fn().mockReturnValue({}),
      updateBuiltinDeepChatConfig
    })

    expect(() =>
      (
        presenter as ConfigPresenter & {
          migrateLegacyDefaultVisionModelToBuiltinAgent: () => void
        }
      ).migrateLegacyDefaultVisionModelToBuiltinAgent()
    ).not.toThrow()

    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      visionModel: {
        providerId: 'openai',
        modelId: 'gpt-4o'
      }
    })
    expect(store.delete).toHaveBeenCalledWith('defaultVisionModel')
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'defaultVisionModel',
      undefined
    )
  })

  it('cleans up malformed legacy vision model without throwing', () => {
    const store = {
      get: vi.fn().mockReturnValue({ providerId: { bad: true }, modelId: 'gpt-4o' }),
      delete: vi.fn()
    }
    const updateBuiltinDeepChatConfig = vi.fn()
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      store,
      getBuiltinDeepChatConfig: vi.fn().mockReturnValue({}),
      updateBuiltinDeepChatConfig
    })

    expect(() =>
      (
        presenter as ConfigPresenter & {
          migrateLegacyDefaultVisionModelToBuiltinAgent: () => void
        }
      ).migrateLegacyDefaultVisionModelToBuiltinAgent()
    ).not.toThrow()

    expect(updateBuiltinDeepChatConfig).not.toHaveBeenCalled()
    expect(store.delete).toHaveBeenCalledWith('defaultVisionModel')
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'defaultVisionModel',
      undefined
    )
  })
})
