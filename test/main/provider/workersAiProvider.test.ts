import type { ProviderSettingsPort } from '@/provider/settings'
import { ModelType } from '@shared/model'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import {
  assertWorkersAiSuccess,
  extractWorkersAiModelRecords,
  resolveWorkersAiModelType,
  unwrapWorkersAiResult,
  WORKERS_AI_BASE_URL_ERROR,
  WorkersAiProvider
} from '../../../src/main/provider/providers/workersAiProvider'
import {
  isJevUnsupportedCapabilityError,
  JEV_UNSUPPORTED_CAPABILITY_ERROR,
  supportsJevJudgment
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

const ACCOUNT_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1'
const ACCOUNT_API_ROOT = 'https://api.cloudflare.com/client/v4/accounts/test-account/ai'

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'cloudflare',
  name: 'Cloudflare',
  apiType: 'workers-ai',
  apiKey: 'test-key',
  baseUrl: ACCOUNT_BASE_URL,
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
  new WorkersAiProvider(createProvider(overrides), createProviderSettings(), {
    getLanguage: vi.fn().mockReturnValue('en-US')
  })

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const searchResponse = (
  records: Array<{ name: string; task?: string }>,
  totalPages = 1
): Response =>
  jsonResponse({
    result: records,
    result_info: { page: 1, per_page: 100, total_pages: totalPages },
    success: true,
    errors: []
  })

const bundledCatalog = [
  {
    id: 'typesafe/jev',
    name: 'Jev',
    group: 'default',
    providerId: 'cloudflare',
    type: ModelType.Judgment
  }
]

describe('WorkersAiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('model catalog', () => {
    it('maps Workers AI tasks onto the model types this transport can serve', () => {
      expect(resolveWorkersAiModelType({ name: 'x', task: 'Text Generation' })).toBe(ModelType.Chat)
      expect(resolveWorkersAiModelType({ name: 'x', task: 'text generation' })).toBe(ModelType.Chat)
      expect(resolveWorkersAiModelType({ name: 'x', task: 'Text Embeddings' })).toBe(
        ModelType.Embedding
      )
      // The judgment model is recognised by id, whatever task the catalog reports for it.
      expect(resolveWorkersAiModelType({ name: 'typesafe/jev', task: 'Text Generation' })).toBe(
        ModelType.Judgment
      )
      // Image, speech and classification models need a different transport, so they are not offered
      // rather than listed as chat models that would fail on first use.
      expect(resolveWorkersAiModelType({ name: 'x', task: 'text to image' })).toBeUndefined()
      expect(resolveWorkersAiModelType({ name: 'x' })).toBeUndefined()
    })

    it('reads records out of the search envelope and tolerates other shapes', () => {
      expect(
        extractWorkersAiModelRecords({
          result: [{ name: '@cf/meta/llama-3.1-8b-instruct', task: { name: 'Text Generation' } }]
        })
      ).toEqual([{ name: '@cf/meta/llama-3.1-8b-instruct', task: 'text generation' }])
      // The task may also arrive as a hyphenated id.
      expect(
        extractWorkersAiModelRecords({
          result: [{ name: '@cf/meta/llama-3.1-8b-instruct', task: { id: 'text-generation' } }]
        })
      ).toEqual([{ name: '@cf/meta/llama-3.1-8b-instruct', task: 'text generation' }])
      expect(extractWorkersAiModelRecords({ result: {} })).toEqual([])
      expect(extractWorkersAiModelRecords({ detail: 'boom' })).toEqual([])
      expect(extractWorkersAiModelRecords(null)).toEqual([])
    })

    it('treats an envelope that reports failure as a failure, even with a 2xx status', () => {
      expect(() => assertWorkersAiSuccess({ success: true, result: [] })).not.toThrow()
      expect(() => assertWorkersAiSuccess({ result: [] })).not.toThrow()
      expect(() =>
        assertWorkersAiSuccess({
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }]
        })
      ).toThrow('Authentication error')
    })

    it('discovers chat, embedding and judgment models as their own types', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        searchResponse([
          { name: '@cf/meta/llama-3.1-8b-instruct', task: 'Text Generation' },
          { name: '@cf/baai/bge-large-en-v1.5', task: 'Text Embeddings' },
          { name: 'typesafe/jev', task: 'Text Generation' },
          { name: '@cf/black-forest-labs/flux-1-schnell', task: 'Text-to-Image' }
        ])
      )
      vi.stubGlobal('fetch', fetchMock)

      const models = await createProviderInstance().fetchModels()

      expect(models.map((model) => [model.id, model.type])).toEqual([
        ['@cf/meta/llama-3.1-8b-instruct', ModelType.Chat],
        ['@cf/baai/bge-large-en-v1.5', ModelType.Embedding],
        ['typesafe/jev', ModelType.Judgment]
      ])
      expect(models.find((model) => model.id === 'typesafe/jev')?.contextLength).toBe(32000)
      expect(fetchMock).toHaveBeenCalledWith(
        `${ACCOUNT_API_ROOT}/models/search?per_page=100&page=1`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' })
        })
      )
    })

    it('keeps the seeded judgment model when the catalog does not list it', async () => {
      // The judgment model id is fixed and the catalog is third-party, so a refresh that omits it
      // must not empty the judgment-model picker.
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            searchResponse([{ name: '@cf/meta/llama-3.1-8b-instruct', task: 'Text Generation' }])
          )
      )

      const models = await createProviderInstance({ models: bundledCatalog }).fetchModels()

      expect(models.map((model) => [model.id, model.type])).toEqual([
        ['@cf/meta/llama-3.1-8b-instruct', ModelType.Chat],
        ['typesafe/jev', ModelType.Judgment]
      ])
    })

    it('offers the judgment model to a provider with no bundled seed', async () => {
      // A custom `workers-ai` provider ships no seed, and the Workers AI catalog covers
      // Cloudflare-hosted models, so the third-party judgment model has to come from the provider.
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            searchResponse([{ name: '@cf/meta/llama-3.1-8b-instruct', task: 'Text Generation' }])
          )
      )

      const models = await createProviderInstance().fetchModels()

      expect(models.map((model) => [model.id, model.type])).toEqual([
        ['@cf/meta/llama-3.1-8b-instruct', ModelType.Chat],
        ['typesafe/jev', ModelType.Judgment]
      ])
    })

    it('offers the judgment model even when the catalog cannot be read', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'boom' }, 500)))

      const models = await createProviderInstance().fetchModels()

      expect(models.map((model) => model.id)).toEqual(['typesafe/jev'])
    })

    it('pages through the catalog and stops at the reported last page', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          searchResponse([{ name: '@cf/meta/llama-3.1-8b-instruct', task: 'Text Generation' }], 2)
        )
        .mockResolvedValueOnce(
          searchResponse(
            [{ name: '@cf/qwen/qwen2.5-coder-32b-instruct', task: 'Text Generation' }],
            2
          )
        )
      vi.stubGlobal('fetch', fetchMock)

      const models = await createProviderInstance().fetchModels()

      expect(models.map((model) => model.id)).toEqual([
        '@cf/meta/llama-3.1-8b-instruct',
        '@cf/qwen/qwen2.5-coder-32b-instruct',
        'typesafe/jev'
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1][0]).toContain('page=2')
    })

    it('keeps the last-known then bundled catalog when the search is unavailable', async () => {
      const provider = createProviderInstance({ models: bundledCatalog })

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'boom' }, 500)))
      expect((await provider.fetchModels()).map((model) => model.id)).toEqual(['typesafe/jev'])

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            searchResponse([{ name: '@cf/meta/llama-3.1-8b-instruct', task: 'Text Generation' }])
          )
      )
      expect((await provider.fetchModels()).map((model) => model.id)).toEqual([
        '@cf/meta/llama-3.1-8b-instruct',
        'typesafe/jev'
      ])

      // The last-known catalog wins over the bundled seed once discovery has succeeded once.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'boom' }, 500)))
      expect((await provider.fetchModels()).map((model) => model.id)).toEqual([
        '@cf/meta/llama-3.1-8b-instruct',
        'typesafe/jev'
      ])

      const noKey = createProviderInstance({ apiKey: '', models: bundledCatalog })
      expect((await noKey.fetchModels()).map((model) => model.id)).toEqual(['typesafe/jev'])
    })
  })

  describe('judgment', () => {
    it('posts the run envelope for the judgment model and unwraps the result', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          result: {
            model: 'jev-1.13.0',
            answers: {
              risk_level: {
                type: 'choice',
                choice: 'low',
                confidence: 0.9,
                probabilities: { low: 0.9, high: 0.1 }
              }
            },
            usage: { input_tokens: 42, output_tokens: 7 }
          },
          success: true,
          errors: []
        })
      )
      vi.stubGlobal('fetch', fetchMock)

      const result = await createProviderInstance().runJudgment({
        model: 'typesafe/jev',
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
      expect(url).toBe(`${ACCOUNT_API_ROOT}/run`)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({
        model: 'typesafe/jev',
        input: {
          state: { proposedAction: { toolName: 'read' } },
          questions: {
            risk_level: {
              type: 'choice',
              instructions: 'How risky is this action?',
              criteria: { low: 'Contained', high: 'Wide' }
            }
          }
        }
      })
    })

    it('accepts an already-unwrapped answer body', () => {
      const answers = { model: 'jev-1.13.0', answers: { is_urgent: { type: 'noul', noul: 0.9 } } }

      expect(unwrapWorkersAiResult({ result: answers, success: true })).toEqual(answers)
      expect(unwrapWorkersAiResult(answers)).toEqual(answers)
      expect(unwrapWorkersAiResult(undefined)).toBeUndefined()
    })

    it('requires at least one question', async () => {
      await expect(
        createProviderInstance().runJudgment({ model: 'typesafe/jev', state: {}, questions: {} })
      ).rejects.toThrow('at least one question')
    })

    it('refuses to guess the account id in the base URL', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      for (const baseUrl of [
        '',
        '   ',
        'https://api.cloudflare.com/client/v4/accounts',
        'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
        // The run-API root instead of the OpenAI-compatible base: chat would not work with it.
        'https://api.cloudflare.com/client/v4/accounts/test-account/ai',
        // A query or fragment would be spliced into the request path.
        'https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1?foo=1',
        // Cleartext transport: the bearer token must not travel unencrypted.
        'http://api.cloudflare.com/client/v4/accounts/test-account/ai/v1'
      ]) {
        await expect(
          createProviderInstance({ baseUrl }).runJudgment({
            model: 'typesafe/jev',
            state: {},
            questions: { q: { type: 'noul', instructions: 'Is this true?' } }
          })
        ).rejects.toThrow(WORKERS_AI_BASE_URL_ERROR)
      }

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('accepts plain HTTP for a loopback host, which is what a local proxy uses', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ model: 'jev-1.13.0', answers: {} }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createProviderInstance({
          baseUrl: 'http://localhost:8787/client/v4/accounts/test-account/ai/v1'
        }).runJudgment({
          model: 'typesafe/jev',
          state: {},
          questions: { q: { type: 'noul', instructions: 'Is this true?' } }
        })
      ).resolves.toMatchObject({ model: 'jev-1.13.0' })

      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://localhost:8787/client/v4/accounts/test-account/ai/run'
      )
    })
  })

  describe('check', () => {
    it('fails without an API key and does not issue a request', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(createProviderInstance({ apiKey: '' }).check()).resolves.toEqual({
        isOk: false,
        errorMsg: 'API key is required'
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports the account status from the authenticated model search', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(searchResponse([{ name: 'typesafe/jev', task: 'Text Generation' }]))
      )
      await expect(createProviderInstance().check()).resolves.toEqual({
        isOk: true,
        errorMsg: null
      })

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ success: false, errors: [] }, 401))
      )
      const unauthorized = await createProviderInstance().check()
      expect(unauthorized.isOk).toBe(false)
      expect(unauthorized.errorMsg).toContain('401')
    })

    it('reports an envelope-level failure that arrives with a 2xx status', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(
              { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
              200
            )
          )
      )

      const result = await createProviderInstance().check()

      expect(result.isOk).toBe(false)
      expect(result.errorMsg).toContain('Authentication error')
    })

    it('reports the base URL error without issuing a request when the account id is missing', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(createProviderInstance({ baseUrl: '' }).check()).resolves.toEqual({
        isOk: false,
        errorMsg: WORKERS_AI_BASE_URL_ERROR
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('capabilities', () => {
    it('is an AI SDK provider that also satisfies the judgment guard', () => {
      const provider = createProviderInstance()

      // Chat, streaming, embeddings, summarization and title generation come from the shared
      // OpenAI-compatible transport; the judgment capability is what this provider adds.
      expect(provider).toBeInstanceOf(AiSdkProvider)
      expect(supportsJevJudgment(provider)).toBe(true)
    })

    it('does not satisfy the judgment guard without the capability', () => {
      const chatOnly = new AiSdkProvider(
        createProvider({ apiType: 'openai-completions' }),
        createProviderSettings(),
        { getLanguage: vi.fn().mockReturnValue('en-US') }
      )

      expect(supportsJevJudgment(chatOnly)).toBe(false)
      expect(supportsJevJudgment(undefined)).toBe(false)
    })

    it('refuses the judgment model on every chat-shaped path', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const provider = createProviderInstance()

      await expect(provider.completions([], 'typesafe/jev')).rejects.toThrow(
        JEV_UNSUPPORTED_CAPABILITY_ERROR
      )
      await expect(provider.generateText('prompt', 'typesafe/jev')).rejects.toThrow(
        JEV_UNSUPPORTED_CAPABILITY_ERROR
      )
      await expect(provider.summaries('text', 'typesafe/jev')).rejects.toThrow(
        JEV_UNSUPPORTED_CAPABILITY_ERROR
      )

      const events = []
      for await (const event of provider.coreStream([], 'typesafe/jev', {} as never, 0, 0, [])) {
        events.push(event)
      }
      expect(events[0]).toMatchObject({
        type: 'error',
        error_message: JEV_UNSUPPORTED_CAPABILITY_ERROR
      })

      // Refused before any request: a judgment model must never reach the chat endpoint.
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('still routes a chat model into the shared chat transport', async () => {
      // A 400 keeps the test fast: the transport retries a 5xx before surfacing it.
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'upstream' }, 400))
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        createProviderInstance().completions(
          [{ role: 'user', content: 'hi' }],
          '@cf/meta/llama-3.1-8b-instruct'
        )
      ).rejects.toThrow()

      // The chat path was entered rather than refused, which is what "one provider, both kinds of
      // model" means.
      expect(fetchMock).toHaveBeenCalled()
    })
  })
})
