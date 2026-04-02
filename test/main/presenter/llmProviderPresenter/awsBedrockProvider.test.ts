import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AWS_BEDROCK_PROVIDER,
  ChatMessage,
  IConfigPresenter,
  ModelConfig
} from '../../../../src/shared/presenter'
import { AwsBedrockProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/awsBedrockProvider'

const { mockBedrockRuntimeSend, mockGetProxyUrl } = vi.hoisted(() => ({
  mockBedrockRuntimeSend: vi.fn(),
  mockGetProxyUrl: vi.fn().mockReturnValue(null)
}))

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: vi.fn(),
  ListFoundationModelsCommand: class ListFoundationModelsCommand {
    input: unknown

    constructor(input: unknown) {
      this.input = input
    }
  }
}))

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(),
  InvokeModelCommand: class InvokeModelCommand {
    input: Record<string, unknown>

    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  },
  InvokeModelWithResponseStreamCommand: class InvokeModelWithResponseStreamCommand {
    input: Record<string, unknown>

    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

const createConfigPresenter = () =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const createProvider = (overrides?: Partial<AWS_BEDROCK_PROVIDER>): AWS_BEDROCK_PROVIDER => ({
  id: 'aws-bedrock',
  name: 'AWS Bedrock',
  apiType: 'aws-bedrock',
  enable: false,
  credential: {
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1'
  },
  ...overrides
})

const createAsyncStream = (chunks: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
})

const createBedrockChunk = (chunk: Record<string, unknown>) => ({
  chunk: {
    bytes: new TextEncoder().encode(JSON.stringify(chunk))
  }
})

describe('AwsBedrockProvider prompt cache behavior', () => {
  const modelConfig: ModelConfig = {
    maxTokens: 1024,
    contextLength: 8192,
    vision: false,
    functionCall: false,
    reasoning: false,
    type: 'chat',
    conversationId: 'session-1'
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'history' },
    { role: 'assistant', content: 'stable reply' },
    { role: 'user', content: 'latest question' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProxyUrl.mockReturnValue(null)
    mockBedrockRuntimeSend.mockResolvedValue({
      body: Promise.resolve(
        createAsyncStream([
          createBedrockChunk({
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                cacheReadInputTokens: 20,
                cacheWriteInputTokens: 30
              }
            }
          }),
          createBedrockChunk({
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: 'hello'
            }
          })
        ])
      )
    })
  })

  it('adds an explicit cache_control breakpoint before the latest user turn', async () => {
    const provider = new AwsBedrockProvider(createProvider(), createConfigPresenter())
    ;(provider as any).bedrockRuntime = {
      send: mockBedrockRuntimeSend
    }

    const events = []
    for await (const event of provider.coreStream(
      messages,
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig,
      0.2,
      64,
      []
    )) {
      events.push(event)
    }

    const command = mockBedrockRuntimeSend.mock.calls[0][0] as {
      input: {
        body: string
      }
    }
    const payload = JSON.parse(command.input.body)

    expect(payload).not.toHaveProperty('cache_control')
    expect(payload.system).toBe('system prompt\n')
    expect(payload.messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'stable reply',
          cache_control: {
            type: 'ephemeral'
          }
        }
      ]
    })
    expect(events.some((event) => event.type === 'text')).toBe(true)
  })

  it('normalizes cache read and cache write usage fields from Bedrock streams', async () => {
    const provider = new AwsBedrockProvider(createProvider(), createConfigPresenter())
    ;(provider as any).bedrockRuntime = {
      send: mockBedrockRuntimeSend
    }

    const events = []
    for await (const event of provider.coreStream(
      messages,
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig,
      0.2,
      64,
      []
    )) {
      events.push(event)
    }

    const usageEvent = events.find((event) => event.type === 'usage')
    expect(usageEvent).toMatchObject({
      type: 'usage',
      usage: {
        prompt_tokens: 60,
        completion_tokens: 5,
        total_tokens: 65,
        cached_tokens: 20,
        cache_write_tokens: 30
      }
    })
  })
})
