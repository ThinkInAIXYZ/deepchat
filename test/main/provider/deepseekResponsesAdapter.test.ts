import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

import {
  createDeepSeekResponsesAdapter,
  createDeepSeekResponsesReplayProjector,
  DEEPSEEK_RESPONSES_BASE_URL,
  DEEPSEEK_RESPONSES_MODEL_ID,
  isOfficialDeepSeekEndpoint,
  resolveDeepSeekResponsesRoute
} from '@/provider/deepseekResponsesAdapter'
import { createAiSdkProviderContext } from '@/provider/aiSdk/providerFactory'
import { mapMessagesToModelMessages } from '@/provider/aiSdk/messageMapper'

const providerSettings = {
  getAzureApiVersion: () => undefined
} as any

function createAdapter() {
  const adapter = createDeepSeekResponsesAdapter({
    providerKind: 'openai-responses',
    provider: {
      id: 'deepseek',
      baseUrl: DEEPSEEK_RESPONSES_BASE_URL
    },
    modelId: DEEPSEEK_RESPONSES_MODEL_ID
  })
  if (!adapter) throw new Error('Expected DeepSeek Responses adapter')
  return adapter
}

function createProviderContext(adapter = createAdapter()) {
  return createAiSdkProviderContext({
    providerKind: 'openai-responses',
    provider: {
      id: 'deepseek',
      name: 'DeepSeek',
      apiType: 'openai-responses',
      apiKey: 'test-key',
      baseUrl: DEEPSEEK_RESPONSES_BASE_URL,
      enable: true
    } as any,
    providerSettings,
    defaultHeaders: {},
    modelId: DEEPSEEK_RESPONSES_MODEL_ID,
    fetchAdapter: adapter.wrapFetch,
    wrapThinkReasoning: false
  })
}

function createRawSearchItem() {
  return {
    type: 'web_search_call' as const,
    id: 'ws_1',
    status: 'completed',
    action: {
      type: 'search',
      query: 'DeepChat',
      sources: [
        {
          type: 'url',
          url: 'https://deepchat.thinkinai.xyz/',
          title: 'DeepChat',
          snippet: 'A privacy-first AI chat client.'
        }
      ]
    }
  }
}

function projectSearchEnvelope() {
  const projected = createAdapter().projectRawChunk({
    type: 'response.output_item.done',
    item: createRawSearchItem()
  })
  if (!projected) throw new Error('Expected projected DeepSeek search item')
  return projected
}

describe('DeepSeek Responses route', () => {
  it.each([
    'https://api.deepseek.com',
    'https://api.deepseek.com/',
    'https://api.deepseek.com/v1',
    'https://api.deepseek.com/v1/'
  ])('accepts official endpoint %s', (baseUrl) => {
    expect(isOfficialDeepSeekEndpoint(baseUrl)).toBe(true)
    expect(
      resolveDeepSeekResponsesRoute({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        baseUrl
      })
    ).toEqual({
      providerKind: 'openai-responses',
      baseUrl: DEEPSEEK_RESPONSES_BASE_URL
    })
  })

  it.each([
    'http://api.deepseek.com',
    'https://user:secret@api.deepseek.com',
    'https://api.deepseek.com:443',
    'https://api.deepseek.com/v1/responses',
    'https://api.deepseek.com/v2',
    'https://api.deepseek.com/v1?relay=1',
    'https://api.deepseek.com/v1#fragment',
    'https://relay.example.com/v1'
  ])('rejects non-canonical endpoint %s', (baseUrl) => {
    expect(isOfficialDeepSeekEndpoint(baseUrl)).toBe(false)
  })

  it.each([
    ['deepseek-proxy', 'deepseek-v4-flash'],
    ['deepseek', 'deepseek/deepseek-v4-flash'],
    ['deepseek', 'deepseek-v4-pro']
  ])('rejects provider/model pair %s + %s', (providerId, modelId) => {
    expect(
      resolveDeepSeekResponsesRoute({
        providerId,
        modelId,
        baseUrl: 'https://api.deepseek.com/v1'
      })
    ).toBeNull()
  })
})

describe('DeepSeek Responses stream projection', () => {
  it('normalizes bounded HTTP sources and persists the complete raw item in an envelope', () => {
    const item = createRawSearchItem()
    item.action.sources.push(
      {
        type: 'url',
        url: 'https://deepchat.thinkinai.xyz/',
        title: 'Duplicate',
        snippet: 'duplicate'
      },
      {
        type: 'url',
        url: 'javascript:alert(1)',
        title: 'Unsafe',
        snippet: 'unsafe'
      },
      {
        type: 'url',
        url: 'https://user:secret@example.com/private',
        title: 'Credential-bearing',
        snippet: 'must not persist credentials'
      }
    )

    const projected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item
    })

    expect(projected).toMatchObject({
      id: 'ws_1',
      action: { type: 'search', target: 'DeepChat' },
      label: 'DeepChat',
      provider: 'deepseek',
      results: [
        {
          title: 'DeepChat',
          url: 'https://deepchat.thinkinai.xyz/',
          snippet: 'A privacy-first AI chat client.',
          rank: 0,
          searchId: 'ws_1'
        }
      ]
    })
    expect(JSON.parse(projected!.providerReplayJson)).toEqual({
      version: 1,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      item
    })
  })

  it('omits provider call markers from the visible search target', () => {
    const item = {
      type: 'web_search_call',
      id: 'call_00_search',
      status: 'completed',
      action: {
        type: 'search',
        query: 'ws_call_id=call_00_primary',
        queries: [
          '今日金价 2026年8月6日',
          'gold price today August 6 2026',
          'ws_call_id=call_00_Nsu9ZBqGih1ss045WEwp8768'
        ]
      }
    }

    const projected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item
    })

    expect(projected?.action.target).toBe('今日金价 2026年8月6日, gold price today August 6 2026')
    expect(projected?.action.target).not.toContain('ws_call_id')
    expect(JSON.parse(projected!.providerReplayJson).item).toEqual(item)
  })

  it('rejects duplicate completed search items in one request scope', () => {
    const adapter = createAdapter()
    const raw = {
      type: 'response.output_item.done',
      item: createRawSearchItem()
    }

    expect(adapter.projectRawChunk(raw)).not.toBeNull()
    expect(() => adapter.projectRawChunk(raw)).toThrow('Duplicate DeepSeek Web Search output item')
  })

  it.each([
    [{ status: 'failed' }, 'non-completed status'],
    [{ action: undefined }, 'missing action'],
    [{ action: { type: 'unknown' } }, 'unknown action']
  ])('rejects a completed event with %s (%s)', (overrides) => {
    const item = { ...createRawSearchItem(), ...overrides }

    expect(() =>
      createAdapter().projectRawChunk({
        type: 'response.output_item.done',
        item
      })
    ).toThrow('DeepSeek Web Search replay item is malformed')
  })

  it('projects a safe page target without inventing citation results', () => {
    const item = {
      type: 'web_search_call',
      id: 'ws_page_1',
      status: 'completed',
      action: { type: 'open_page', url: 'https://deepchat.thinkinai.xyz/' }
    }

    const projected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item
    })

    expect(projected).toMatchObject({
      id: 'ws_page_1',
      action: {
        type: 'open_page',
        target: 'https://deepchat.thinkinai.xyz/',
        url: 'https://deepchat.thinkinai.xyz/'
      },
      label: 'https://deepchat.thinkinai.xyz/',
      results: []
    })
    expect(JSON.parse(projected!.providerReplayJson).item).toEqual(item)
  })

  it('bounds find-in-page targets and rejects unsafe display URLs', () => {
    const findItem = {
      type: 'web_search_call',
      id: 'ws_find_1',
      status: 'completed',
      action: {
        type: 'find_in_page',
        url: 'https://deepchat.thinkinai.xyz/docs',
        pattern: `release ${'x'.repeat(4096)}`
      }
    }
    const findProjected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item: findItem
    })

    expect(findProjected?.action).toEqual({
      type: 'find_in_page',
      target: findItem.action.pattern.slice(0, 2048),
      url: 'https://deepchat.thinkinai.xyz/docs'
    })
    expect(JSON.parse(findProjected!.providerReplayJson).item).toEqual(findItem)

    const urlOnlyFindItem = {
      ...findItem,
      id: 'ws_find_url_only',
      action: {
        type: 'find_in_page',
        url: `https://example.com/${'x'.repeat(4096)}`
      }
    }
    const urlOnlyFindProjected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item: urlOnlyFindItem
    })

    expect(urlOnlyFindProjected?.action.target).toHaveLength(2048)
    expect(urlOnlyFindProjected?.action.url).toBe(urlOnlyFindItem.action.url)

    const unsafeItem = {
      type: 'web_search_call',
      id: 'ws_page_unsafe',
      status: 'completed',
      action: { type: 'open_page', url: 'https://user:secret@example.com/private' }
    }
    const unsafeProjected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item: unsafeItem
    })

    expect(unsafeProjected?.action).toEqual({ type: 'open_page', target: '' })
    expect(unsafeProjected?.results).toEqual([])
    expect(JSON.parse(unsafeProjected!.providerReplayJson).item).toEqual(unsafeItem)
  })

  it('bounds normalized source metadata and omits oversized display URLs', () => {
    const item = createRawSearchItem()
    item.action.sources = [
      {
        type: 'url',
        url: `https://example.com/${'x'.repeat(9000)}`,
        title: 'oversized URL'
      },
      {
        type: 'url',
        url: 'https://example.com/article',
        title: 't'.repeat(1024),
        snippet: 's'.repeat(8192)
      }
    ]

    const projected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item
    })

    expect(projected?.results).toEqual([
      {
        title: 't'.repeat(512),
        url: 'https://example.com/article',
        snippet: 's'.repeat(4096),
        rank: 0,
        searchId: 'ws_1'
      }
    ])
    expect(JSON.parse(projected!.providerReplayJson).item).toEqual(item)

    const openPageItem = {
      type: 'web_search_call',
      id: 'ws_page_oversized',
      status: 'completed',
      action: { type: 'open_page', url: `https://example.com/${'x'.repeat(9000)}` }
    }
    const openPageProjected = createAdapter().projectRawChunk({
      type: 'response.output_item.done',
      item: openPageItem
    })

    expect(openPageProjected?.action).toEqual({ type: 'open_page', target: '' })
    expect(JSON.parse(openPageProjected!.providerReplayJson).item).toEqual(openPageItem)
  })

  it('rejects replay envelopes above the 1 MiB limit before persistence or replay', () => {
    const oversizedItem = createRawSearchItem()
    oversizedItem.action.query = 'x'.repeat(1024 * 1024)

    expect(() =>
      createAdapter().projectRawChunk({
        type: 'response.output_item.done',
        item: oversizedItem
      })
    ).toThrow('replay envelope exceeds the 1 MiB limit')

    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    expect(() => projector?.('x'.repeat(1024 * 1024 + 1))).toThrow(
      'replay envelope exceeds the 1 MiB limit'
    )
  })
})

describe('DeepSeek Responses replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('replaces AI SDK markers and enforces stateless request fields before fetch', async () => {
    const projected = projectSearchEnvelope()
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    const replay = projector?.(projected.providerReplayJson)
    if (!replay) throw new Error('Expected DeepSeek replay marker')

    const adapter = createAdapter()
    adapter.mapReplay(replay)
    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const signal = new AbortController().signal
    await adapter.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
      method: 'POST',
      signal,
      headers: { 'x-test': 'preserved' },
      body: JSON.stringify({
        input: [{ type: 'item_reference', id: 'ws_1' }],
        store: true,
        previous_response_id: 'resp_1',
        conversation: 'conv_1',
        truncation: 'auto'
      })
    })

    const init = baseFetch.mock.calls[0]?.[1] as RequestInit
    expect(init.signal).toBe(signal)
    expect(init.headers).toEqual({ 'x-test': 'preserved' })
    expect(JSON.parse(String(init.body))).toEqual({
      input: [createRawSearchItem()],
      store: false
    })
  })

  it('fails unmatched markers before network I/O', async () => {
    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const wrappedFetch = createAdapter().wrapFetch(baseFetch)

    await expect(
      wrappedFetch('https://api.deepseek.com/responses', {
        body: JSON.stringify({ input: [{ type: 'item_reference', id: 'missing' }] })
      })
    ).rejects.toThrow('Unmatched DeepSeek Responses item_reference: missing')
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('fails duplicate, missing, and mismatched replay markers before network I/O', async () => {
    const projected = projectSearchEnvelope()
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    const replay = projector?.(projected.providerReplayJson)
    if (!replay) throw new Error('Expected DeepSeek replay marker')

    const duplicateRegistration = createAdapter()
    duplicateRegistration.mapReplay(replay)
    expect(() => duplicateRegistration.mapReplay(replay)).toThrow(
      'Duplicate DeepSeek Web Search replay marker'
    )

    expect(() => createAdapter().mapReplay({ ...replay, markerId: 'other' })).toThrow(
      'DeepSeek Web Search replay marker does not match its envelope'
    )

    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const missingEmission = createAdapter()
    missingEmission.mapReplay(replay)
    await expect(
      missingEmission.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({ input: [{ role: 'user', content: 'continue' }] })
      })
    ).rejects.toThrow('DeepSeek Responses replay marker was not emitted: ws_1')

    const duplicateEmission = createAdapter()
    duplicateEmission.mapReplay(replay)
    await expect(
      duplicateEmission.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({
          input: [
            { type: 'item_reference', id: 'ws_1' },
            { type: 'item_reference', id: 'ws_1' }
          ]
        })
      })
    ).rejects.toThrow('Duplicate DeepSeek Responses item_reference: ws_1')
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('rejects malformed envelopes and unexpected request endpoints', async () => {
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    if (!projector) throw new Error('Expected DeepSeek replay projector')

    expect(() => projector('{')).toThrow('replay envelope is not valid JSON')
    expect(() =>
      projector(
        JSON.stringify({
          version: 1,
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          item: { ...createRawSearchItem(), status: 'failed' }
        })
      )
    ).toThrow('replay item is malformed')

    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    await expect(
      createAdapter().wrapFetch(baseFetch)('https://user:secret@api.deepseek.com/responses', {
        body: JSON.stringify({ input: [] })
      })
    ).rejects.toThrow('refused an unexpected endpoint')
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('serializes the first-turn provider tool without optional search arguments', async () => {
    const adapter = createAdapter()
    const fetchMock = vi.fn(async () => {
      throw new Error('request captured')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateText({
        model: createProviderContext(adapter).model,
        messages: [{ role: 'user', content: 'Find the latest DeepChat release.' }],
        tools: adapter.getSearchTools(),
        maxRetries: 0
      })
    ).rejects.toThrow('request captured')

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      tools?: Array<Record<string, unknown>>
      store?: boolean
    }
    expect(body.tools).toContainEqual({ type: 'web_search' })
    expect(body.store).toBe(false)
  })

  it('uses the real AI SDK Responses serializer for second-turn replay', async () => {
    const projected = projectSearchEnvelope()
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    const replay = projector?.(projected.providerReplayJson)
    if (!replay) throw new Error('Expected DeepSeek replay marker')

    const adapter = createAdapter()
    const messages = mapMessagesToModelMessages(
      [
        { role: 'user', content: 'Find DeepChat.' },
        { role: 'assistant', content: 'Before the search item.' },
        { role: 'assistant', provider_replay: replay },
        { role: 'assistant', content: 'After the search item.' },
        { role: 'user', content: 'What was the result?' }
      ],
      {
        tools: [],
        supportsNativeTools: true,
        mapProviderReplay: adapter.mapReplay
      }
    )
    const fetchMock = vi.fn(async () => {
      throw new Error('request captured')
    })
    vi.stubGlobal('fetch', fetchMock)
    const context = createProviderContext(adapter)

    await expect(
      generateText({
        model: context.model,
        messages,
        maxRetries: 0,
        providerOptions: {
          openai: {
            previousResponseId: 'resp_should_be_removed',
            store: true
          }
        }
      })
    ).rejects.toThrow('request captured')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/responses')
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      input: Array<Record<string, unknown>>
      store?: boolean
      previous_response_id?: string
    }
    expect(body.input).toContainEqual(createRawSearchItem())
    expect(body.input.some((item) => item.type === 'item_reference')).toBe(false)
    const beforeIndex = body.input.findIndex((item) =>
      JSON.stringify(item).includes('Before the search item.')
    )
    const replayIndex = body.input.findIndex((item) => item.type === 'web_search_call')
    const afterIndex = body.input.findIndex((item) =>
      JSON.stringify(item).includes('After the search item.')
    )
    expect(beforeIndex).toBeGreaterThanOrEqual(0)
    expect(replayIndex).toBeGreaterThan(beforeIndex)
    expect(afterIndex).toBeGreaterThan(replayIndex)
    expect(body.store).toBe(false)
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body).not.toHaveProperty('conversation')
    expect(body).not.toHaveProperty('truncation')
  })
})
