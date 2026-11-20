import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText, streamText } from 'ai'
import type { MCPToolDefinition } from '@shared/types/mcp'

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: { getProxyUrl: vi.fn().mockReturnValue(null) }
}))

vi.mock('@/platform/imageCache', () => ({ cacheImage: vi.fn() }))

import { createAiSdkProviderContext } from '@/provider/aiSdk/providerFactory'
import { createGeminiToolSchemaAdapter } from '@/provider/aiSdk/geminiToolSchemaAdapter'
import { mcpToolsToAISDKTools } from '@/provider/aiSdk/toolMapper'
import { runAiSdkCoreStream } from '@/provider/aiSdk/runtime'

function boundedTool(maximum = 100): MCPToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'bounded_limit',
      description: 'Choose an integer in range',
      parameters: {
        type: 'object',
        allOf: [
          {
            type: 'object',
            properties: { limit: { type: 'integer', minimum: 1 } },
            required: ['limit']
          },
          {
            type: 'object',
            properties: { limit: { type: 'integer', maximum } },
            required: ['limit']
          }
        ]
      }
    }
  } as MCPToolDefinition
}

function contextFor(providerKind: 'gemini' | 'vertex', tools: MCPToolDefinition[]) {
  return createAiSdkProviderContext({
    providerKind,
    provider: {
      id: providerKind,
      name: providerKind,
      apiType: providerKind,
      apiKey: 'offline-test-key',
      baseUrl:
        providerKind === 'gemini'
          ? 'https://generativelanguage.googleapis.com/v1beta'
          : 'https://aiplatform.googleapis.com/v1/publishers/google',
      enable: true
    } as any,
    providerSettings: {} as any,
    defaultHeaders: {},
    modelId: 'gemini-2.5-flash',
    wrapThinkReasoning: false,
    fetchAdapter: createGeminiToolSchemaAdapter(providerKind, tools)
  })
}

function captureRequests() {
  const requests: Array<{ url: string; body: Record<string, any> }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(init.body as string) })
      const payload = {
        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
      }
      const streaming = url.includes(':streamGenerateContent')
      return new Response(
        streaming ? `data: ${JSON.stringify(payload)}\n\n` : JSON.stringify(payload),
        {
          headers: { 'content-type': streaming ? 'text/event-stream' : 'application/json' }
        }
      )
    })
  )
  return requests
}

async function runRequest(
  providerKind: 'gemini' | 'vertex',
  streaming: boolean,
  tools: MCPToolDefinition[]
) {
  const options = {
    model: contextFor(providerKind, tools).model,
    messages: [{ role: 'user' as const, content: 'Choose a limit' }],
    tools: mcpToolsToAISDKTools(tools),
    maxRetries: 0
  }
  if (streaming) {
    for await (const _ of streamText(options).fullStream) {
      /* consume the real SDK stream */
    }
  } else {
    await generateText(options)
  }
}

describe('Gemini intersection tool schemas on the wire', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['gemini', false],
    ['gemini', true],
    ['vertex', false],
    ['vertex', true]
  ] as const)('preserves bounds for %s (streaming=%s)', async (providerKind, streaming) => {
    const requests = captureRequests()
    const ordinary = {
      type: 'function',
      function: {
        name: 'ordinary',
        parameters: { type: 'object', properties: { query: { type: 'string' } } }
      }
    } as MCPToolDefinition
    const tool = boundedTool()
    // MCP raw schemas must win over the compatibility function.parameters copy.
    tool.raw = { inputSchema: tool.function.parameters } as MCPToolDefinition['raw']
    tool.function.parameters = { type: 'object', properties: {} }
    await runRequest(providerKind, streaming, [tool, ordinary])
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain(streaming ? ':streamGenerateContent' : ':generateContent')
    const [bounded, unchanged] = requests[0].body.tools[0].functionDeclarations
    expect(bounded.parametersJsonSchema).toEqual({
      type: 'object',
      properties: {
        limit: {
          allOf: [
            { type: 'integer', minimum: 1 },
            { type: 'integer', maximum: 100 }
          ]
        }
      },
      required: ['limit']
    })
    expect(bounded).not.toHaveProperty('parameters')
    expect(bounded.description).toBe('Choose an integer in range')
    expect(unchanged).not.toHaveProperty('parametersJsonSchema')
    expect(unchanged.parameters.properties.query).toEqual({ type: 'STRING' })
  })

  it.each(['gemini', 'vertex'] as const)(
    'installs the adapter through the %s runtime',
    async (providerKind) => {
      const requests = captureRequests()
      for await (const _ of runAiSdkCoreStream(
        {
          providerKind,
          provider: {
            id: providerKind,
            apiType: providerKind,
            apiKey: 'offline-test-key',
            baseUrl:
              providerKind === 'gemini'
                ? 'https://generativelanguage.googleapis.com/v1beta'
                : 'https://aiplatform.googleapis.com/v1/publishers/google'
          } as any,
          providerSettings: {} as any,
          defaultHeaders: {},
          supportsNativeTools: () => true
        },
        [{ role: 'user', content: 'Choose a limit' }],
        'gemini-2.5-flash',
        {} as any,
        0,
        128,
        [boundedTool()]
      )) {
        // Exercise the application's real streaming entrypoint, not manual adapter setup.
      }
      expect(requests).toHaveLength(1)
      const declaration = requests[0].body.tools[0].functionDeclarations[0]
      expect(declaration).not.toHaveProperty('parameters')
      expect(declaration.parametersJsonSchema.properties.limit.allOf).toEqual([
        { type: 'integer', minimum: 1 },
        { type: 'integer', maximum: 100 }
      ])
    }
  )

  it('keeps same-name tool schemas isolated across concurrent requests', async () => {
    const requests = captureRequests()
    await Promise.all([
      runRequest('gemini', true, [boundedTool(10)]),
      runRequest('gemini', false, [boundedTool(20)]),
      runRequest('vertex', false, [boundedTool(30)])
    ])
    expect(
      requests
        .map(
          ({ body }) =>
            body.tools[0].functionDeclarations[0].parametersJsonSchema.properties.limit.allOf[1]
              .maximum
        )
        .sort()
    ).toEqual([10, 20, 30])
  })

  it('leaves non-intersection and other-provider tools on the existing path', () => {
    expect(createGeminiToolSchemaAdapter('openai-compatible', [boundedTool()])).toBeUndefined()
    const ordinary = boundedTool()
    ordinary.function.parameters = {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1 } }
    }
    expect(createGeminiToolSchemaAdapter('gemini', [ordinary])).toBeUndefined()
    // The final definition wins in the ToolSet, so a replaced intersection must not leak.
    expect(createGeminiToolSchemaAdapter('gemini', [boundedTool(), ordinary])).toBeUndefined()
    const freeform = {
      ...ordinary,
      providerPresentation: { type: 'freeform' }
    } as MCPToolDefinition
    expect(createGeminiToolSchemaAdapter('vertex', [boundedTool(), freeform])).toBeUndefined()
  })

  it('preserves unrelated HTTP bodies and request options', async () => {
    const baseFetch = vi.fn(async () => new Response('{}'))
    const adapter = createGeminiToolSchemaAdapter('gemini', [boundedTool()])!(baseFetch)
    const init = {
      body: '{ "tools": [{"functionDeclarations": [{"name": "ordinary"}]}] }',
      signal: new AbortController().signal
    }
    await adapter('https://example.test/models/test:generateContent', init)
    expect(baseFetch).toHaveBeenLastCalledWith(
      'https://example.test/models/test:generateContent',
      init
    )
    await adapter('https://example.test/models/test:embedContent', init)
    expect(baseFetch).toHaveBeenLastCalledWith(
      'https://example.test/models/test:embedContent',
      init
    )
  })
})
