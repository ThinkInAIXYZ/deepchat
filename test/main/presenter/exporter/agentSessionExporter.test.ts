import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exporterSpies = vi.hoisted(() => ({
  buildContent: vi.fn(),
  generateFilename: vi.fn()
}))

vi.mock('@/presenter/exporter/formats/conversationExporter', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/presenter/exporter/formats/conversationExporter')>()
  exporterSpies.buildContent.mockImplementation(actual.buildConversationExportContent)
  exporterSpies.generateFilename.mockImplementation(actual.generateExportFilename)
  return {
    ...actual,
    buildConversationExportContent: exporterSpies.buildContent,
    generateExportFilename: exporterSpies.generateFilename
  }
})

import { AgentSessionExportService } from '@/presenter/exporter/agentSessionExporter'

function createFixture(options?: {
  agentKind?: 'deepchat' | 'acp'
  generationSettings?: Record<string, unknown> | null
  modelConfig?: Record<string, unknown>
}) {
  const session = {
    id: 'session-1',
    agentId: options?.agentKind === 'acp' ? 'acp-coder' : 'deepchat',
    title: 'Export Target',
    projectDir: '/repo',
    isPinned: true,
    isDraft: false,
    sessionKind: 'regular' as const,
    parentSessionId: null,
    subagentMeta: null,
    createdAt: 100,
    updatedAt: 200
  }
  const messages = [
    {
      id: 'assistant-1',
      sessionId: 'session-1',
      orderSeq: 2,
      role: 'assistant' as const,
      content: JSON.stringify([
        { type: 'content', content: 'assistant result', status: 'success', timestamp: 120 }
      ]),
      status: 'sent' as const,
      isContextEdge: 0,
      metadata: JSON.stringify({
        model: 'metadata-model',
        provider: 'metadata-provider',
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7
      }),
      createdAt: 120,
      updatedAt: 120
    },
    {
      id: 'user-1',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'user' as const,
      content: 'plain user fallback',
      status: 'sent' as const,
      isContextEdge: 0,
      metadata: '{}',
      createdAt: 110,
      updatedAt: 110
    },
    {
      id: 'pending-1',
      sessionId: 'session-1',
      orderSeq: 3,
      role: 'assistant' as const,
      content: 'must not export',
      status: 'pending' as const,
      isContextEdge: 0,
      metadata: '{}',
      createdAt: 130,
      updatedAt: 130
    }
  ]
  const handle = {
    snapshot: vi.fn(async () =>
      options?.agentKind === 'acp'
        ? { providerId: '', modelId: '' }
        : { providerId: 'runtime-provider', modelId: 'runtime-model' }
    ),
    settings: {
      getGenerationSettings: vi.fn(async () =>
        Object.hasOwn(options ?? {}, 'generationSettings')
          ? options?.generationSettings
          : {
              systemPrompt: 'system',
              temperature: 0.4,
              contextLength: 64000,
              maxTokens: 2048
            }
      )
    }
  }
  const service = new AgentSessionExportService({
    agentManager: {
      resolveBackend: vi.fn(() => ({ kind: options?.agentKind ?? 'deepchat' })),
      resolveSessionHandle: vi.fn(() => ({ handle }))
    } as never,
    appSessionService: { get: vi.fn(() => session) } as never,
    transcript: { getMessages: vi.fn(async () => messages) } as never,
    configPresenter: {
      getModelConfig: vi.fn(() =>
        Object.hasOwn(options ?? {}, 'modelConfig')
          ? options?.modelConfig
          : { temperature: 0.7, contextLength: 32000, maxTokens: 8000 }
      )
    } as never
  })
  return { service, messages, handle }
}

describe('AgentSessionExportService', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<
      typeof import('@/presenter/exporter/formats/conversationExporter')
    >('@/presenter/exporter/formats/conversationExporter')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T01:02:03.456Z'))
    exporterSpies.buildContent.mockReset().mockImplementation(actual.buildConversationExportContent)
    exporterSpies.generateFilename.mockReset().mockImplementation(actual.generateExportFilename)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a missing session', async () => {
    const service = new AgentSessionExportService({
      agentManager: {} as never,
      appSessionService: { get: vi.fn(() => null) } as never,
      transcript: {} as never,
      configPresenter: {} as never
    })
    await expect(service.export('missing', 'markdown')).rejects.toThrow(
      'Session not found: missing'
    )
  })

  it.each([
    ['markdown', 'export_deepchat_2026-07-13_01-02-03.md'],
    ['html', 'export_deepchat_2026-07-13_01-02-03.html'],
    ['txt', 'export_deepchat_2026-07-13_01-02-03.txt'],
    ['nowledge-mem', 'nowledge_mem_Export_Target_2026-07-13_01-02-03.json']
  ] as const)(
    'exports %s with compatible ordering and sent-message filtering',
    async (format, filename) => {
      const { service } = createFixture()
      const result = await service.export('session-1', format)

      expect(result.filename).toBe(filename)
      expect(result.content).toContain('plain user fallback')
      expect(result.content).toContain('assistant result')
      expect(result.content).not.toContain('must not export')
      expect(result.content.indexOf('plain user fallback')).toBeLessThan(
        result.content.indexOf('assistant result')
      )
      if (format === 'nowledge-mem') {
        expect(JSON.parse(result.content)).toMatchObject({ title: 'Export Target' })
      }
      const actual = await vi.importActual<
        typeof import('@/presenter/exporter/formats/conversationExporter')
      >('@/presenter/exporter/formats/conversationExporter')
      const [conversation, exportedMessages] = exporterSpies.buildContent.mock.calls.at(-1)!
      expect(result.content).toBe(
        actual.buildConversationExportContent(conversation, exportedMessages, format)
      )
    }
  )

  it('locks metadata overrides and runtime metadata fallbacks', async () => {
    const { service } = createFixture()
    await service.export('session-1', 'markdown')

    const [, exportedMessages] = exporterSpies.buildContent.mock.calls.at(-1)!
    expect(exportedMessages).toHaveLength(2)
    expect(exportedMessages[0]).toMatchObject({
      id: 'user-1',
      model_name: 'runtime-model',
      model_id: 'runtime-model',
      model_provider: 'runtime-provider'
    })
    expect(exportedMessages[1]).toMatchObject({
      id: 'assistant-1',
      model_name: 'metadata-model',
      model_id: 'metadata-model',
      model_provider: 'metadata-provider',
      usage: {
        input_tokens: 3,
        output_tokens: 4,
        total_tokens: 7
      }
    })
  })

  it('locks generation-settings precedence and model-config fallbacks', async () => {
    const explicit = createFixture({
      generationSettings: {
        systemPrompt: 'explicit system',
        temperature: 0.3,
        contextLength: 12345,
        maxTokens: 678,
        thinkingBudget: 99,
        reasoningEffort: 'high',
        verbosity: 'high'
      },
      modelConfig: { temperature: 0.9, contextLength: 99999, maxTokens: 9999 }
    })
    await explicit.service.export('session-1', 'markdown')
    expect(exporterSpies.buildContent.mock.calls.at(-1)?.[0].settings).toMatchObject({
      systemPrompt: 'explicit system',
      temperature: 0.3,
      contextLength: 12345,
      maxTokens: 678,
      thinkingBudget: 99,
      reasoningEffort: 'high',
      verbosity: 'high'
    })

    exporterSpies.buildContent.mockClear()
    const fallback = createFixture({
      generationSettings: null,
      modelConfig: { temperature: 0.9, contextLength: 99999, maxTokens: 9999 }
    })
    await fallback.service.export('session-1', 'markdown')
    expect(exporterSpies.buildContent.mock.calls.at(-1)?.[0].settings).toMatchObject({
      systemPrompt: '',
      temperature: 0.9,
      contextLength: 99999,
      maxTokens: 9999,
      providerId: 'runtime-provider',
      modelId: 'runtime-model'
    })
  })

  it('uses ACP provider and agent model defaults when runtime state is empty', async () => {
    const { service } = createFixture({ agentKind: 'acp' })
    const result = await service.export('session-1', 'nowledge-mem')
    const parsed = JSON.parse(result.content) as {
      metadata?: { conversation?: { provider?: string; model?: string } }
    }
    expect(JSON.stringify(parsed)).toContain('acp-coder')
    expect(JSON.stringify(parsed)).toContain('acp')
  })
})
