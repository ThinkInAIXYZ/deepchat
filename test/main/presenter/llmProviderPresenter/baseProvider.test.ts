import { describe, expect, it, vi } from 'vitest'
import type {
  ChatMessage,
  IConfigPresenter,
  LLM_PROVIDER,
  LLMResponse,
  MCPToolDefinition,
  ModelConfig
} from '../../../../src/shared/presenter'
import { BaseLLMProvider } from '../../../../src/main/presenter/llmProviderPresenter/baseProvider'

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToRenderer: vi.fn(),
    sendToMain: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  }
}))

class TestProvider extends BaseLLMProvider {
  constructor(configPresenter: IConfigPresenter) {
    super(
      {
        id: 'test-provider',
        name: 'Test Provider',
        enable: true,
        apiKey: 'test-key',
        apiHost: '',
        apiVersion: '',
        models: []
      } as unknown as LLM_PROVIDER,
      configPresenter
    )
  }

  public renderToolsXml(tools: MCPToolDefinition[]): string {
    return this.convertToolsToXml(tools)
  }

  public onProxyResolved(): void {}

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    return { isOk: true, errorMsg: null }
  }

  public async summaryTitles(_messages: ChatMessage[], _modelId: string): Promise<string> {
    return 'summary'
  }

  public async completions(
    _messages: ChatMessage[],
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number,
    _tools?: MCPToolDefinition[]
  ): Promise<LLMResponse> {
    return { content: 'ok' }
  }

  public async summaries(
    _text: string,
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    return { content: 'ok' }
  }

  public async generateText(
    _prompt: string,
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    return { content: 'ok' }
  }

  public async *coreStream(
    _messages: ChatMessage[],
    _modelId: string,
    _modelConfig: ModelConfig,
    _temperature: number,
    _maxTokens: number,
    _tools: MCPToolDefinition[]
  ) {
    return
  }

  protected async fetchProviderModels() {
    return []
  }
}

describe('BaseLLMProvider tool XML conversion', () => {
  const configPresenter = {
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getLanguage: vi.fn().mockReturnValue('zh-CN'),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(false),
    updateCustomModel: vi.fn()
  } as unknown as IConfigPresenter

  it('normalizes discriminated union tool schemas before building XML', () => {
    const provider = new TestProvider(configPresenter)
    const tools: MCPToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'skill_manage',
          description: 'Manage draft skills',
          parameters: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  action: { type: 'string', const: 'create' },
                  content: { type: 'string', description: 'Draft content' }
                },
                required: ['action', 'content'],
                additionalProperties: false
              },
              {
                type: 'object',
                properties: {
                  action: { type: 'string', const: 'edit' },
                  draftId: { type: 'string', description: 'Draft ID' },
                  content: { type: 'string', description: 'Draft content' }
                },
                required: ['action', 'draftId', 'content'],
                additionalProperties: false
              }
            ]
          } as unknown as MCPToolDefinition['function']['parameters']
        },
        server: {
          name: 'deepchat',
          icons: 'tool',
          description: 'DeepChat tools'
        }
      }
    ]

    const xml = provider.renderToolsXml(tools)

    expect(xml).toContain('<tool name="skill_manage" description="Manage draft skills">')
    expect(xml).toContain('<parameter name="action" required="true" type="string"></parameter>')
    expect(xml).toContain(
      '<parameter name="content" required="true" description="Draft content" type="string"></parameter>'
    )
    expect(xml).toContain(
      '<parameter name="draftId" description="Draft ID" type="string"></parameter>'
    )
  })

  it('keeps tools without properties renderable', () => {
    const provider = new TestProvider(configPresenter)
    const xml = provider.renderToolsXml([
      {
        type: 'function',
        function: {
          name: 'noop',
          description: 'No arguments tool',
          parameters: {
            type: 'object',
            properties: {}
          }
        },
        server: {
          name: 'deepchat',
          icons: 'tool',
          description: 'DeepChat tools'
        }
      }
    ])

    expect(xml).toContain('<tool name="noop" description="No arguments tool"></tool>')
  })
})
