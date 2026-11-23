import type { ProviderSettingsPort } from '@/provider/settings'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

const { mockGetProxyUrl } = vi.hoisted(() => ({ mockGetProxyUrl: vi.fn().mockReturnValue(null) }))

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  }
}))

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'novita',
  name: 'Novita',
  apiType: 'openai-completions',
  apiKey: 'test-key',
  baseUrl: 'https://mock.example.com/v1',
  enable: false,
  ...overrides
})

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as ProviderSettingsPort

describe('AiSdkProvider openai-compatible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockGetProxyUrl.mockReturnValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shares model discovery across initialization and concurrent queries, then refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'gpt-4o' }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AiSdkProvider(createProvider({ enable: true }), createProviderSettings())
    const results = await Promise.all(Array.from({ length: 8 }, () => provider.fetchModels()))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mock.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    for (const models of results) {
      expect(models).toEqual([
        expect.objectContaining({
          id: 'gpt-4o',
          providerId: 'novita'
        })
      ])
    }

    await provider.fetchModels({ suppressErrors: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      label: 'Headers',
      headers: new Headers({ Authorization: 'Bearer request-key', 'X-Tenant-ID': 'team-a' })
    },
    {
      label: 'tuple array',
      headers: [
        ['Authorization', 'Bearer request-key'],
        ['X-Tenant-ID', 'team-a']
      ] as Array<[string, string]>
    }
  ])('preserves $label request headers and their precedence', async ({ headers }) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    await provider.requestProviderJson('https://mock.example.com/v1/models', {
      method: 'GET',
      headers
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestHeaders = new Headers(requestInit.headers)
    expect(requestHeaders.get('authorization')).toBe('Bearer request-key')
    expect(requestHeaders.get('x-tenant-id')).toBe('team-a')
  })
})
