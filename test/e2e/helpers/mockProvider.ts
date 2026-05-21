import type { Page } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { E2E_MOCK_MODEL_ID, E2E_MOCK_PROVIDER_ID } from './testData'

type MockProviderServer = {
  baseUrl: string
  close: () => Promise<void>
}

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, {
    'content-type': 'application/json'
  })
  response.end(JSON.stringify(payload))
}

const normalizeMessageContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }

  return ''
}

const getLatestUserText = (body: Record<string, unknown>): string => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const latestUserMessage = [...messages]
    .reverse()
    .find((message): message is { content?: unknown } => {
      if (!message || typeof message !== 'object') {
        return false
      }

      return (message as { role?: unknown }).role === 'user'
    })

  return normalizeMessageContent((latestUserMessage as { content?: unknown } | undefined)?.content)
}

const createReplyText = (body: Record<string, unknown>): string => {
  const latestUserText = getLatestUserText(body)
  const exactTextMatch = latestUserText.match(/exact text "([^"]+)"/)
  return exactTextMatch?.[1] ?? 'DEEPCHAT_E2E_MOCK_REPLY'
}

const modelListPayload = {
  object: 'list',
  data: [
    {
      id: E2E_MOCK_MODEL_ID,
      object: 'model',
      owned_by: 'deepchat-e2e'
    }
  ]
}

const handleChatCompletions = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const body = await readJsonBody(request)
  const model = typeof body.model === 'string' ? body.model : E2E_MOCK_MODEL_ID
  const replyText = createReplyText(body)
  const created = Math.floor(Date.now() / 1000)

  if (body.stream === true) {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-deepchat-e2e',
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null
          }
        ]
      })}\n\n`
    )
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-deepchat-e2e',
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta: { content: replyText },
            finish_reason: null
          }
        ]
      })}\n\n`
    )
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-deepchat-e2e',
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ]
      })}\n\n`
    )
    response.end('data: [DONE]\n\n')
    return
  }

  writeJson(response, 200, {
    id: 'chatcmpl-deepchat-e2e',
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: replyText
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    }
  })
}

const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname.replace(/\/+$/, '')

    if (request.method === 'GET' && (pathname === '/models' || pathname === '/v1/models')) {
      writeJson(response, 200, modelListPayload)
      return
    }

    if (
      request.method === 'POST' &&
      (pathname === '/chat/completions' || pathname === '/v1/chat/completions')
    ) {
      await handleChatCompletions(request, response)
      return
    }

    writeJson(response, 404, {
      error: { message: `Unhandled mock route: ${request.method} ${pathname}` }
    })
  } catch (error) {
    writeJson(response, 500, {
      error: {
        message: error instanceof Error ? error.message : String(error)
      }
    })
  }
}

export async function startMockProviderServer(): Promise<MockProviderServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve mock provider server address.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }
}

export async function configureMockProvider(page: Page, baseUrl: string): Promise<void> {
  await page.waitForFunction(() => Boolean(window.deepchat?.invoke), undefined, {
    timeout: 60_000
  })

  await page.evaluate(
    async ({ providerId, modelId, baseUrl }) => {
      const provider = {
        id: providerId,
        capabilityProviderId: 'openai',
        name: 'E2E Mock OpenAI Compatible',
        apiType: 'openai-compatible',
        apiKey: 'deepchat-e2e-key',
        baseUrl,
        models: [],
        customModels: [],
        enable: true,
        custom: true
      }

      const providersResult = await window.deepchat.invoke('providers.list', {})
      const providers = Array.isArray(providersResult.providers) ? providersResult.providers : []
      const existingProvider = providers.find((item) => item.id === providerId)

      if (existingProvider) {
        await window.deepchat.invoke('providers.update', {
          providerId,
          updates: provider
        })
      } else {
        await window.deepchat.invoke('providers.add', {
          provider
        })
      }

      await window.deepchat.invoke('models.addCustom', {
        providerId,
        model: {
          id: modelId,
          name: 'DeepChat E2E Mock',
          enabled: true,
          type: 'chat',
          contextLength: 8192,
          maxTokens: 4096,
          supportedEndpointTypes: ['openai'],
          endpointType: 'openai'
        }
      })
      await window.deepchat.invoke('models.setStatus', {
        providerId,
        modelId,
        enabled: true
      })
      await window.deepchat.invoke('config.updateEntries', {
        changes: [
          { key: 'init_complete', value: true },
          { key: 'preferredModel', value: { providerId, modelId } },
          { key: 'defaultModel', value: { providerId, modelId } },
          {
            key: 'providerOrder',
            value: [
              providerId,
              ...providers.map((item) => item.id).filter((id) => id !== providerId)
            ]
          }
        ]
      })
      await window.deepchat.invoke('onboarding.complete', { force: true })
    },
    {
      providerId: E2E_MOCK_PROVIDER_ID,
      modelId: E2E_MOCK_MODEL_ID,
      baseUrl
    }
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="window-sidebar"]', { timeout: 60_000 })
}
