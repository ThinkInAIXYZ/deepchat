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
  resolveDeepSeekResponsesRequestRoute,
  resolveDeepSeekResponsesRoute
} from '@/provider/deepseekResponsesAdapter'
import { recordToChatMessages } from '@/agent/deepchat/runtime/contextBuilder'
import { createAiSdkProviderContext } from '@/provider/aiSdk/providerFactory'
import { runAiSdkCoreStream, type AiSdkRuntimeContext } from '@/provider/aiSdk/runtime'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ModelConfig } from '@shared/types/provider'

const providerSettings = {
  getAzureApiVersion: () => undefined
} as any

const REPLAY_TOOL_NAME = 'deepchat_internal_deepseek_web_search_replay'

function createAdapter(search = true) {
  const adapter = createDeepSeekResponsesAdapter({
    providerKind: 'deepseek-open-responses',
    provider: {
      id: 'deepseek',
      baseUrl: DEEPSEEK_RESPONSES_BASE_URL
    },
    modelId: DEEPSEEK_RESPONSES_MODEL_ID,
    search
  })
  if (!adapter) throw new Error('Expected DeepSeek Responses adapter')
  return adapter
}

function createProviderContext(adapter = createAdapter()) {
  return createAiSdkProviderContext({
    providerKind: 'deepseek-open-responses',
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

function createRuntimeContext(overrides: Partial<AiSdkRuntimeContext> = {}): AiSdkRuntimeContext {
  return {
    providerKind: 'deepseek-open-responses',
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
    ...overrides
  }
}

const deepSeekModelConfig = {
  maxTokens: 1024,
  contextLength: 65_536,
  functionCall: true,
  type: 'chat'
} as ModelConfig

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

function projectSearchItem(adapter: ReturnType<typeof createAdapter>, item: unknown) {
  const projected = adapter.projectRawChunk({
    type: 'response.output_item.done',
    item
  })
  if (projected?.type !== 'provider_search') {
    throw new Error('Expected projected DeepSeek search item')
  }
  return projected.provider_search
}

function projectSearchEnvelope() {
  return projectSearchItem(createAdapter(), createRawSearchItem())
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
      providerKind: 'deepseek-open-responses',
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

  it('selects Responses only for a new search or compatible replay', () => {
    const target = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    }

    expect(
      resolveDeepSeekResponsesRequestRoute({ ...target, messages: [], search: false })
    ).toBeNull()
    expect(resolveDeepSeekResponsesRequestRoute({ ...target, messages: [], search: true })).toEqual(
      {
        providerKind: 'deepseek-open-responses',
        baseUrl: DEEPSEEK_RESPONSES_BASE_URL
      }
    )
    expect(
      resolveDeepSeekResponsesRequestRoute({
        ...target,
        messages: [
          {
            role: 'assistant',
            provider_replay: { markerId: 'ws_1', payload: '{"version":1}' }
          }
        ],
        search: false
      })
    ).toEqual({
      providerKind: 'deepseek-open-responses',
      baseUrl: DEEPSEEK_RESPONSES_BASE_URL
    })
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

    const projected = projectSearchItem(createAdapter(), item)

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

    const projected = projectSearchItem(createAdapter(), item)

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

  it('projects function-call arguments while the provider is still streaming', () => {
    const adapter = createAdapter()

    expect(
      adapter.projectRawChunk({
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'run_code',
          arguments: '',
          status: 'in_progress'
        }
      })
    ).toEqual({
      type: 'tool_call_start',
      tool_call_id: 'call_1',
      tool_call_name: 'run_code',
      provider_options: { deepseek: { itemId: 'fc_1' } }
    })
    expect(
      adapter.projectRawChunk({
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_1',
        delta: '{"code":"console.log(1)"}'
      })
    ).toEqual({
      type: 'tool_call_chunk',
      tool_call_id: 'call_1',
      tool_call_arguments_chunk: '{"code":"console.log(1)"}'
    })
    expect(
      adapter.projectRawChunk({
        type: 'response.output_item.done',
        item: { type: 'function_call', id: 'fc_1' }
      })
    ).toBeNull()
    expect(
      adapter.projectRawChunk({
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_1',
        delta: '{}'
      })
    ).toBeNull()
  })

  it('ignores malformed function-call starts and deltas with unknown item IDs', () => {
    const adapter = createAdapter()

    expect(
      adapter.projectRawChunk({
        type: 'response.output_item.added',
        item: { type: 'function_call', call_id: 'call_1', name: 'run_code' }
      })
    ).toBeNull()
    expect(
      adapter.projectRawChunk({
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_1',
        delta: '{}'
      })
    ).toBeNull()
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

    const projected = projectSearchItem(createAdapter(), item)

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
    const findProjected = projectSearchItem(createAdapter(), findItem)

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
    const urlOnlyFindProjected = projectSearchItem(createAdapter(), urlOnlyFindItem)

    expect(urlOnlyFindProjected?.action.target).toHaveLength(2048)
    expect(urlOnlyFindProjected?.action.url).toBe(urlOnlyFindItem.action.url)

    const unsafeItem = {
      type: 'web_search_call',
      id: 'ws_page_unsafe',
      status: 'completed',
      action: { type: 'open_page', url: 'https://user:secret@example.com/private' }
    }
    const unsafeProjected = projectSearchItem(createAdapter(), unsafeItem)

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

    const projected = projectSearchItem(createAdapter(), item)

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
    const openPageProjected = projectSearchItem(createAdapter(), openPageItem)

    expect(openPageProjected?.action).toEqual({ type: 'open_page', target: '' })
    expect(JSON.parse(openPageProjected!.providerReplayJson).item).toEqual(openPageItem)
  })

  it('rejects new oversized envelopes and ignores oversized persisted replay', () => {
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
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(projector?.('x'.repeat(1024 * 1024 + 1))).toBeNull()
    expect(consoleWarn).toHaveBeenCalledOnce()
    consoleWarn.mockRestore()
  })
})

describe('DeepSeek Responses replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores a validated function-call marker before fetch', async () => {
    const projected = projectSearchEnvelope()
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    const replay = projector?.(projected.providerReplayJson)
    if (!replay) throw new Error('Expected DeepSeek replay marker')

    const adapter = createAdapter(false)
    adapter.mapReplay(replay)
    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const signal = new AbortController().signal
    await adapter.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
      method: 'POST',
      signal,
      headers: { 'x-test': 'preserved' },
      body: JSON.stringify({
        input: [
          {
            type: 'function_call',
            call_id: 'ws_1',
            name: REPLAY_TOOL_NAME,
            arguments: '{}'
          }
        ]
      })
    })

    const init = baseFetch.mock.calls[0]?.[1] as RequestInit
    expect(init.signal).toBe(signal)
    expect(init.headers).toEqual({ 'x-test': 'preserved' })
    expect(JSON.parse(String(init.body))).toEqual({
      input: [createRawSearchItem()]
    })
  })

  it('omits empty reasoning without changing non-empty history or mutating input', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'answer',
        reasoning_content: 'reasoning',
        reasoning_provider_options: { openai: { itemId: 'old_reasoning_item' } }
      },
      {
        role: 'assistant',
        content: 'answer without reasoning',
        reasoning_content: '',
        reasoning_provider_options: { openai: { itemId: 'empty_reasoning_item' } }
      }
    ]

    const prepared = createAdapter().prepareMessages(messages)

    expect(prepared[0]).toBe(messages[0])
    expect(prepared[0]?.reasoning_provider_options).toEqual({
      openai: { itemId: 'old_reasoning_item' }
    })
    expect(prepared[1]).toEqual({ role: 'assistant', content: 'answer without reasoning' })
    expect(messages[1]?.reasoning_content).toBe('')
    expect(messages[1]?.reasoning_provider_options).toEqual({
      openai: { itemId: 'empty_reasoning_item' }
    })
  })

  it('fails unmatched markers before network I/O', async () => {
    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const wrappedFetch = createAdapter().wrapFetch(baseFetch)

    await expect(
      wrappedFetch('https://api.deepseek.com/responses', {
        body: JSON.stringify({
          input: [
            {
              type: 'function_call',
              call_id: 'missing',
              name: REPLAY_TOOL_NAME,
              arguments: '{}'
            }
          ]
        })
      })
    ).rejects.toThrow('Unmatched DeepSeek Responses replay marker: missing')
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
    const marker = {
      type: 'function_call',
      call_id: 'ws_1',
      name: REPLAY_TOOL_NAME,
      arguments: '{}'
    }
    await expect(
      duplicateEmission.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({ input: [marker, marker] })
      })
    ).rejects.toThrow('Duplicate DeepSeek Responses replay marker: ws_1')

    const malformedEmission = createAdapter()
    malformedEmission.mapReplay(replay)
    await expect(
      malformedEmission.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({ input: [{ ...marker, arguments: '{"unexpected":true}' }] })
      })
    ).rejects.toThrow('DeepSeek Responses replay marker is malformed')
    await expect(
      malformedEmission.wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({ input: [{ ...marker, arguments: '{' }] })
      })
    ).rejects.toThrow('DeepSeek Responses replay marker is malformed')

    await expect(
      createAdapter().wrapFetch(baseFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({ input: [{ type: 'item_reference', id: 'ws_1' }] })
      })
    ).rejects.toThrow('DeepSeek Responses request contains an item_reference')
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('ignores corrupt persisted envelopes but keeps wire validation strict', async () => {
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    if (!projector) throw new Error('Expected DeepSeek replay projector')
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(projector('{')).toBeNull()
    const malformedPayload = JSON.stringify({
      version: 1,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      item: { ...createRawSearchItem(), status: 'failed' }
    })
    expect(projector(malformedPayload)).toBeNull()
    expect(consoleWarn).toHaveBeenCalledTimes(2)
    expect(() =>
      createAdapter().mapReplay({ markerId: 'ws_1', payload: malformedPayload })
    ).toThrow('replay item is malformed')
    consoleWarn.mockRestore()
  })

  it('rejects unexpected request endpoints before network I/O', async () => {
    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }))
    await expect(
      createAdapter().wrapFetch(baseFetch)('https://user:secret@api.deepseek.com/responses', {
        body: JSON.stringify({ input: [] })
      })
    ).rejects.toThrow('refused an unexpected endpoint')
    expect(baseFetch).not.toHaveBeenCalled()
  })

  it('injects the first-turn native search tool into a stateless request', async () => {
    const adapter = createAdapter()
    const fetchMock = vi.fn(async () => {
      throw new Error('request captured')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateText({
        model: createProviderContext(adapter).model,
        messages: [{ role: 'user', content: 'Find the latest DeepChat release.' }],
        maxRetries: 0
      })
    ).rejects.toThrow('request captured')

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      tools?: Array<Record<string, unknown>>
    }
    expect(body.tools).toEqual([{ type: 'web_search' }])
    expect(body).not.toHaveProperty('store')
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body).not.toHaveProperty('conversation')
    expect(body).not.toHaveProperty('truncation')
  })

  it('streams plaintext reasoning once while preserving native search projection', async () => {
    const tracePayloads: Array<{ endpoint: string; body?: unknown }> = []
    const responseEvents = [
      {
        type: 'response.output_item.added',
        item: { type: 'reasoning', id: 'rs_1' }
      },
      {
        type: 'response.reasoning_text.delta',
        item_id: 'rs_1',
        delta: 'Think'
      },
      {
        type: 'response.reasoning_text.delta',
        item_id: 'rs_1',
        delta: 'ing'
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'reasoning',
          id: 'rs_1',
          summary: [],
          content: [{ type: 'reasoning_text', text: 'Thinking' }]
        }
      },
      {
        type: 'response.output_item.done',
        item: createRawSearchItem()
      },
      {
        type: 'response.output_item.added',
        item: { type: 'message', id: 'msg_1' }
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        delta: 'Answer'
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          id: 'msg_1',
          content: [
            {
              type: 'output_text',
              text: 'Answer',
              annotations: [
                {
                  type: 'url_citation',
                  start_index: 0,
                  end_index: 6,
                  url: 'https://example.com/citation',
                  title: 'Citation'
                }
              ]
            }
          ]
        }
      },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 4 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 2 }
          }
        }
      }
    ]
    const fetchMock = vi.fn(
      async () =>
        new Response(responseEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: unknown[] = []
    for await (const event of runAiSdkCoreStream(
      createRuntimeContext({
        emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
          tracePayloads.push(payload)
        })
      }),
      [{ role: 'user', content: 'Search and explain.' }],
      DEEPSEEK_RESPONSES_MODEL_ID,
      { ...deepSeekModelConfig, reasoningEffort: 'low' },
      0.7,
      1024,
      [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            }
          },
          server: { name: 'filesystem' }
        } as any
      ],
      undefined,
      { search: true }
    )) {
      events.push(event)
    }

    expect(events.filter((event) => (event as { type?: string }).type === 'reasoning')).toEqual([
      { type: 'reasoning', reasoning_content: 'Think' },
      { type: 'reasoning', reasoning_content: 'ing' }
    ])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'provider_search',
        provider_search: expect.objectContaining({ id: 'ws_1', provider: 'deepseek' })
      })
    )
    expect(events).toContainEqual({
      type: 'provider_url_source',
      provider_url_source: {
        searchId: 'ws_1',
        title: 'Citation',
        url: 'https://example.com/citation',
        rank: 1
      }
    })
    expect(events).toContainEqual(expect.objectContaining({ type: 'text', content: 'Answer' }))

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'read_file' }),
      { type: 'web_search' }
    ])
    expect(tracePayloads).toEqual([
      {
        endpoint: 'https://api.deepseek.com/responses',
        headers: {},
        body
      }
    ])
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

    const messages: ChatMessage[] = [
      { role: 'user', content: 'Find DeepChat.' },
      {
        role: 'assistant',
        content: 'Before the search item.',
        provider_options: { openai: { itemId: 'persisted_text_item' } }
      },
      { role: 'assistant', provider_replay: replay },
      {
        role: 'assistant',
        content: 'After the search item.',
        reasoning_content: 'Persisted reasoning.',
        reasoning_provider_options: { openai: { itemId: 'persisted_reasoning_item' } },
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'tc_1', content: '# DeepChat' },
      { role: 'assistant', content: 'The tool confirmed the result.' },
      { role: 'user', content: 'What was the result?' }
    ]
    const fetchMock = vi.fn(async () => {
      throw new Error('request captured')
    })
    const tracePayloads: Array<{ endpoint: string; body?: unknown }> = []
    vi.stubGlobal('fetch', fetchMock)

    const firstEvent = await runAiSdkCoreStream(
      createRuntimeContext({
        emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
          tracePayloads.push(payload)
        })
      }),
      messages,
      DEEPSEEK_RESPONSES_MODEL_ID,
      { ...deepSeekModelConfig, reasoningEffort: 'max' },
      0.7,
      1024,
      [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path']
            }
          },
          server: { name: 'filesystem' }
        } as any
      ]
    ).next()
    expect(firstEvent).toMatchObject({
      done: false,
      value: { type: 'error', error_message: 'request captured' }
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/responses')
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      input: Array<Record<string, unknown>>
      reasoning?: { effort?: string }
      tools?: Array<Record<string, unknown>>
    }
    expect(body.input).toContainEqual(createRawSearchItem())
    expect(body.input).toContainEqual({
      type: 'reasoning',
      summary: [],
      content: [{ type: 'reasoning_text', text: 'Persisted reasoning.' }]
    })
    expect(body.input.some((item) => item.type === 'item_reference')).toBe(false)
    expect(
      body.input.some((item) => item.type === 'function_call' && item.name === REPLAY_TOOL_NAME)
    ).toBe(false)
    const beforeIndex = body.input.findIndex((item) =>
      JSON.stringify(item).includes('Before the search item.')
    )
    const replayIndex = body.input.findIndex((item) => item.type === 'web_search_call')
    const reasoningIndex = body.input.findIndex((item) => item.type === 'reasoning')
    const toolCallIndex = body.input.findIndex(
      (item) => item.type === 'function_call' && item.call_id === 'tc_1'
    )
    const toolResultIndex = body.input.findIndex(
      (item) => item.type === 'function_call_output' && item.call_id === 'tc_1'
    )
    const afterIndex = body.input.findIndex((item) =>
      JSON.stringify(item).includes('The tool confirmed the result.')
    )
    expect(beforeIndex).toBeGreaterThanOrEqual(0)
    expect(replayIndex).toBeGreaterThan(beforeIndex)
    expect(reasoningIndex).toBeGreaterThan(replayIndex)
    expect(toolCallIndex).toBeGreaterThan(reasoningIndex)
    expect(toolResultIndex).toBeGreaterThan(toolCallIndex)
    expect(afterIndex).toBeGreaterThan(toolResultIndex)
    expect(body.reasoning).toEqual({ effort: 'max' })
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'read_file' })])
    expect(body).not.toHaveProperty('store')
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body).not.toHaveProperty('conversation')
    expect(body).not.toHaveProperty('truncation')
    expect(tracePayloads).toEqual([
      {
        endpoint: 'https://api.deepseek.com/responses',
        headers: {},
        body
      }
    ])
  })

  it('streams MCP arguments on a replay turn after native search is disabled', async () => {
    const projected = projectSearchEnvelope()
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })
    const replay = projector?.(projected.providerReplayJson)
    if (!replay) throw new Error('Expected DeepSeek replay marker')

    const responseEvents = [
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'run_code',
          arguments: '',
          status: 'in_progress'
        }
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_1',
        delta: '{"code":"'
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_1',
        delta: 'console.log(1)"}'
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'run_code',
          arguments: '{"code":"console.log(1)"}',
          status: 'completed'
        }
      },
      {
        type: 'response.completed',
        response: {
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      }
    ]
    const fetchMock = vi.fn(
      async () =>
        new Response(responseEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: unknown[] = []
    for await (const event of runAiSdkCoreStream(
      createRuntimeContext(),
      [
        { role: 'user', content: 'Search first.' },
        { role: 'assistant', provider_replay: replay },
        { role: 'assistant', content: 'Search complete.' },
        { role: 'user', content: 'Now run code.' }
      ],
      DEEPSEEK_RESPONSES_MODEL_ID,
      deepSeekModelConfig,
      0.7,
      1024,
      [
        {
          type: 'function',
          function: {
            name: 'run_code',
            description: 'Run JavaScript.',
            parameters: {
              type: 'object',
              properties: { code: { type: 'string' } },
              required: ['code']
            }
          },
          server: { name: 'code' }
        } as any
      ],
      undefined,
      { search: false }
    )) {
      events.push(event)
    }

    expect(
      events.filter((event) => (event as { type?: string }).type.startsWith('tool_call'))
    ).toEqual([
      {
        type: 'tool_call_start',
        tool_call_id: 'call_1',
        tool_call_name: 'run_code',
        provider_options: { deepseek: { itemId: 'fc_1' } }
      },
      {
        type: 'tool_call_chunk',
        tool_call_id: 'call_1',
        tool_call_arguments_chunk: '{"code":"'
      },
      {
        type: 'tool_call_chunk',
        tool_call_id: 'call_1',
        tool_call_arguments_chunk: 'console.log(1)"}'
      },
      {
        type: 'tool_call_end',
        tool_call_id: 'call_1',
        tool_call_arguments_complete: '{"code":"console.log(1)"}',
        provider_options: { deepseek: { itemId: 'fc_1' } }
      }
    ])
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      tools?: Array<Record<string, unknown>>
    }
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'run_code' })])
  })

  it('rejects an MCP tool that collides with the private replay marker', async () => {
    await expect(
      runAiSdkCoreStream(
        createRuntimeContext(),
        [{ role: 'user', content: 'Search and use the tool.' }],
        DEEPSEEK_RESPONSES_MODEL_ID,
        deepSeekModelConfig,
        0.7,
        1024,
        [
          {
            type: 'function',
            function: {
              name: REPLAY_TOOL_NAME,
              description: 'Conflicts with an internal replay marker.',
              parameters: { type: 'object', properties: {} }
            },
            server: { name: 'collision-test' }
          } as any
        ],
        undefined,
        { search: true }
      ).next()
    ).rejects.toThrow('reserved tool name conflicts with an existing tool')
  })

  it('replays flattened persisted reasoning as one id-less plaintext item', async () => {
    const record = {
      id: 'assistant_1',
      sessionId: 'session_1',
      orderSeq: 2,
      role: 'assistant',
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      createdAt: 1,
      updatedAt: 1,
      content: JSON.stringify([
        {
          type: 'reasoning_content',
          content: 'Read the file first. ',
          status: 'success',
          timestamp: 1
        },
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 1,
          tool_call: {
            id: 'tc_1',
            name: 'read_file',
            params: '{"path":"README.md"}',
            response: '# DeepChat'
          }
        },
        {
          type: 'reasoning_content',
          content: 'Now summarize it.',
          status: 'success',
          timestamp: 1
        },
        {
          type: 'content',
          content: 'DeepChat is a desktop AI client.',
          status: 'success',
          timestamp: 1
        }
      ])
    } as ChatMessageRecord
    const history = recordToChatMessages(record, false, true, true)
    const fetchMock = vi.fn(async () => {
      throw new Error('request captured')
    })
    vi.stubGlobal('fetch', fetchMock)

    await runAiSdkCoreStream(
      createRuntimeContext(),
      [
        { role: 'user', content: 'Summarize the README.' },
        ...history,
        { role: 'user', content: 'Thanks.' }
      ],
      DEEPSEEK_RESPONSES_MODEL_ID,
      deepSeekModelConfig,
      0.7,
      1024,
      []
    ).next()

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      input: Array<Record<string, unknown>>
    }
    expect(body.input.filter((item) => item.type === 'reasoning')).toEqual([
      {
        type: 'reasoning',
        summary: [],
        content: [{ type: 'reasoning_text', text: 'Read the file first. Now summarize it.' }]
      }
    ])
    expect(body.input).toContainEqual(
      expect.objectContaining({ type: 'function_call', call_id: 'tc_1' })
    )
    expect(body.input).toContainEqual(
      expect.objectContaining({ type: 'function_call_output', call_id: 'tc_1' })
    )
  })

  it('keeps replay registrations isolated across concurrent request adapters', async () => {
    const firstItem = createRawSearchItem()
    firstItem.action.query = 'first request'
    const secondItem = createRawSearchItem()
    secondItem.action.query = 'second request'
    const target = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    }
    const projector = createDeepSeekResponsesReplayProjector(target)
    if (!projector) throw new Error('Expected DeepSeek replay projector')

    const firstAdapter = createAdapter(false)
    const secondAdapter = createAdapter(false)
    const firstProjection = projectSearchItem(firstAdapter, firstItem)
    const secondProjection = projectSearchItem(secondAdapter, secondItem)
    const firstReplay = projector(firstProjection.providerReplayJson)
    const secondReplay = projector(secondProjection.providerReplayJson)
    if (!firstReplay || !secondReplay) throw new Error('Expected isolated replay markers')
    firstAdapter.mapReplay(firstReplay)
    secondAdapter.mapReplay(secondReplay)

    const firstFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const secondFetch = vi.fn(async () => new Response(null, { status: 204 }))
    await Promise.all([
      firstAdapter.wrapFetch(firstFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({
          input: [
            {
              type: 'function_call',
              call_id: 'ws_1',
              name: REPLAY_TOOL_NAME,
              arguments: '{}'
            }
          ]
        })
      }),
      secondAdapter.wrapFetch(secondFetch)('https://api.deepseek.com/responses', {
        body: JSON.stringify({
          input: [
            {
              type: 'function_call',
              call_id: 'ws_1',
              name: REPLAY_TOOL_NAME,
              arguments: '{}'
            }
          ]
        })
      })
    ])

    const firstBody = JSON.parse(String((firstFetch.mock.calls[0]?.[1] as RequestInit).body))
    const secondBody = JSON.parse(String((secondFetch.mock.calls[0]?.[1] as RequestInit).body))
    expect(firstBody.input[0].action.query).toBe('first request')
    expect(secondBody.input[0].action.query).toBe('second request')
  })
})
