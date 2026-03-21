import { describe, expect, it, vi } from 'vitest'

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

import { normalizeAnthropicProviderForApiOnly } from '../../../../src/main/presenter/configPresenter'

describe('normalizeAnthropicProviderForApiOnly', () => {
  it('removes legacy auth state but preserves regular provider fields', () => {
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

    expect(normalized).toMatchObject({
      id: 'anthropic',
      name: 'Anthropic',
      apiType: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://custom.anthropic.local',
      enable: true
    })
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
