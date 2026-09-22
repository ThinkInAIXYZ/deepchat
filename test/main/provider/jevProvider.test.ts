import type { ProviderSettingsPort } from '@/provider/settings'
import { ModelType } from '@shared/model'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractJevModelRecords,
  isJevUnsupportedCapabilityError,
  JEV_UNSUPPORTED_CAPABILITY_ERROR,
  JevProvider
} from '../../../src/main/provider/providers/jevProvider'

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    log: vi.fn()
  }
}))

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
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone'

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'typesafe',
  name: 'TypeSafe',
  apiType: 'jev',
  apiKey: 'test-key',
  baseUrl: SYSTEM_ONE_URL,
  enable: false,
  ...overrides
})

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getProviderModelRouteMetadata: vi.fn().mockReturnValue(undefined),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getModelRouteConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    getModelStatus: vi.fn().mockReturnValue(false),
    setProviderModels: vi.fn(),
    setModelConfig: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false)
  }) as unknown as ProviderSettingsPort

const createProviderInstance = (overrides?: Partial<LLM_PROVIDER>) =>
  new JevProvider(createProvider(overrides), createProviderSettings(), {
    getLanguage: vi.fn().mockReturnValue('en-US')
  })

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

describe('JevProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('model catalog', () => {
    it('parses the TypeSafe { models: [...] } shape and rejects other shapes', () => {
      expect(
        extractJevModelRecords({
          models: [{ name: 'jev-1.13.0', description: 'pinned', release_date: '2026-09-17' }]
        })
      ).toEqual([{ name: 'jev-1.13.0', description: 'pinned', release_date: '2026-09-17' }])

      // The OpenAI `{ data: [...] }` shape must not be silently accepted here.
      expect(() => extractJevModelRecords({ data: [{ id: 'jev-1.13.0' }] })).toThrow()
    })

    it('reports discovered models as judgment models so they never reach a chat picker', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          models: [
            { name: 'jev-1.13.0', description: 'pinned' },
            { name: 'jev-latest', description: 'alias' }
          ]
        })
      )
      vi.stubGlobal('fetch', fetchMock)

      const models = await createProviderInstance().fetchModels()

      expect(models.map((model) => model.id)).toEqual(['jev-1.13.0', 'jev-latest'])
      expect(models.every((model) => model.type === ModelType.Judgment)).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.typesafe.ai/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' })
        })
      )
    })

    it('falls back to the bundled catalog when the live catalog is unavailable or empty', async () => {
      const bundled = [
        {
          id: 'jev-1.13.0',
          name: 'Jev 1.13.0',
          group: 'default',
          providerId: 'typesafe',
          type: ModelType.Judgment
        }
      ]

      const noKey = await createProviderInstance({ apiKey: '', models: bundled }).fetchModels()
      expect(noKey.map((model) => model.id)).toEqual(['jev-1.13.0'])

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'boom' }, 500)))
      const failed = await createProviderInstance({ models: bundled }).fetchModels()
      expect(failed.map((model) => model.id)).toEqual(['jev-1.13.0'])

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ models: [] })))
      const empty = await createProviderInstance({ models: bundled }).fetchModels()
      expect(empty.map((model) => model.id)).toEqual(['jev-1.13.0'])
    })

    it('prefers the last-known catalog over the bundled seed when a later fetch fails', async () => {
      // The bundled seed lives in the settings JSON, which a provider reorder strips. The
      // last-known catalog comes from the per-provider store, which survives it, so it must win.
      const bundled = [
        {
          id: 'jev-latest',
          name: 'Jev (latest)',
          group: 'default',
          providerId: 'typesafe',
          type: ModelType.Judgment
        }
      ]

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ models: [{ name: 'jev-1.13.0' }] }))
      )
      const provider = new JevProvider(
        createProvider({ models: bundled }),
        createProviderSettings(),
        {
          getLanguage: vi.fn().mockReturnValue('en-US')
        }
      )
      await provider.fetchModels()

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'boom' }, 500)))
      const afterFailure = await provider.fetchModels()

      expect(afterFailure.map((model) => model.id)).toEqual(['jev-1.13.0'])
    })
  })

  describe('chat surface', () => {
    it('refuses every chat-shaped entry point instead of issuing a request', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const provider = createProviderInstance()

      await expect(provider.completions([], 'jev-1.13.0')).rejects.toSatisfy(
        isJevUnsupportedCapabilityError
      )
      await expect(provider.summaries('text', 'jev-1.13.0')).rejects.toSatisfy(
        isJevUnsupportedCapabilityError
      )
      await expect(provider.generateText('prompt', 'jev-1.13.0')).rejects.toSatisfy(
        isJevUnsupportedCapabilityError
      )

      const events = []
      for await (const event of provider.coreStream([], 'jev-1.13.0', {} as never, 0, 0, [])) {
        events.push(event)
      }
      expect(events[0]).toMatchObject({
        type: 'error',
        error_message: JEV_UNSUPPORTED_CAPABILITY_ERROR
      })

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('judgment', () => {
    it('posts the System One body and returns typed answers', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          model: 'jev-1.13.0',
          answers: {
            risk_level: {
              type: 'choice',
              choice: 'low',
              confidence: 0.9,
              probabilities: { low: 0.9, medium: 0.1 }
            },
            user_authorization: { type: 'noul', noul: 0.95 }
          },
          usage: { input_tokens: 42, output_tokens: 7 }
        })
      )
      vi.stubGlobal('fetch', fetchMock)

      const result = await createProviderInstance().runJudgment({
        model: 'jev-1.13.0',
        state: { proposedAction: { toolName: 'read' } },
        questions: {
          risk_level: {
            type: 'choice',
            instructions: 'How risky is this action?',
            criteria: { low: 'Contained', high: 'Wide' }
          }
        }
      })

      expect(result.model).toBe('jev-1.13.0')
      expect(result.answers.risk_level).toMatchObject({ type: 'choice', choice: 'low' })
      expect(result.usage).toEqual({ input_tokens: 42, output_tokens: 7 })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.typesafe.ai/v1/systemone')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toMatchObject({
        model: 'jev-1.13.0',
        state: { proposedAction: { toolName: 'read' } }
      })
    })

    it('requires at least one question', async () => {
      const provider = createProviderInstance()
      await expect(
        provider.runJudgment({ model: 'jev-1.13.0', state: {}, questions: {} })
      ).rejects.toThrow('at least one question')
    })

    it('posts to a vendor endpoint verbatim and reads its sibling catalog', async () => {
      // Vendors expose System One at different paths, so the configured URL is the endpoint and
      // nothing is appended to it. The catalog is the sibling path.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ models: [{ name: 'jev-latest', description: 'alias' }] })
        )
        .mockResolvedValueOnce(jsonResponse({ model: 'jev-1.13.0', answers: {} }))
      vi.stubGlobal('fetch', fetchMock)

      const provider = createProviderInstance({
        baseUrl: 'https://vendor.example/api/v2/system-one'
      })

      await provider.fetchModels()
      await provider.runJudgment({
        model: 'jev-latest',
        state: {},
        questions: { q: { type: 'noul', instructions: 'Is this true?' } }
      })

      expect(fetchMock.mock.calls[0][0]).toBe('https://vendor.example/api/v2/models')
      expect(fetchMock.mock.calls[1][0]).toBe('https://vendor.example/api/v2/system-one')
    })

    it('reports an endpoint without a sibling catalog as usable', async () => {
      // 404/405 at the catalog path says nothing about the endpoint, and probing the endpoint would
      // spend the vendor's tokens.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'nope' }, 404)))

      await expect(
        createProviderInstance({ baseUrl: 'https://vendor.example/decide' }).check()
      ).resolves.toEqual({ isOk: true, errorMsg: null })

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'bad key' }, 401)))
      const unauthorized = await createProviderInstance().check()
      expect(unauthorized.isOk).toBe(false)
    })

    it('does not silently drop an already-aborted caller signal', async () => {
      let observedSignal: AbortSignal | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (_url, init: RequestInit | undefined) => {
          observedSignal = init?.signal ?? undefined
          return jsonResponse({ model: 'jev-1.13.0', answers: {} })
        })
      )

      const controller = new AbortController()
      controller.abort()

      await createProviderInstance()
        .runJudgment(
          {
            model: 'jev-1.13.0',
            state: {},
            questions: { q: { type: 'noul', instructions: 'Is this true?' } }
          },
          { signal: controller.signal }
        )
        .catch(() => undefined)

      expect(observedSignal?.aborted).toBe(true)
    })
  })

  describe('check', () => {
    it('fails without an API key and does not issue a request', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const result = await createProviderInstance({ apiKey: '' }).check()

      expect(result.isOk).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports the provider status from the authenticated catalog fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ models: [] })))
      await expect(createProviderInstance().check()).resolves.toEqual({
        isOk: true,
        errorMsg: null
      })

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'bad key' }, 401)))
      const unauthorized = await createProviderInstance().check()
      expect(unauthorized.isOk).toBe(false)
    })
  })
})
