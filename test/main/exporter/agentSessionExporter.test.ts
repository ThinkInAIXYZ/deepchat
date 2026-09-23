import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exporterSpies = vi.hoisted(() => ({
  buildContent: vi.fn(),
  generateFilename: vi.fn()
}))

vi.mock('@/exporter/formats/conversationExporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/exporter/formats/conversationExporter')>()
  exporterSpies.buildContent.mockImplementation(actual.buildConversationExportContent)
  exporterSpies.generateFilename.mockImplementation(actual.generateExportFilename)
  return {
    ...actual,
    buildConversationExportContent: exporterSpies.buildContent,
    generateExportFilename: exporterSpies.generateFilename
  }
})

import { AgentSessionExportService } from '@/exporter/agentSessionExporter'

function createFixture(options?: {
  agentKind?: 'deepchat' | 'acp'
  generationSettings?: Record<string, unknown> | null
  modelConfig?: Record<string, unknown>
  nowledgeConfig?: { baseUrl: string; apiKey?: string; timeout: number }
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
    nowledgeMemConnections: options?.nowledgeConfig
      ? ({ getExportConfig: () => ({ ...options.nowledgeConfig }) } as never)
      : undefined,
    agentManager: {
      resolveBackend: vi.fn(() => ({ kind: options?.agentKind ?? 'deepchat' })),
      resolveSessionHandle: vi.fn(() => ({ handle }))
    } as never,
    appSessionService: { get: vi.fn(() => session) } as never,
    transcript: { getMessages: vi.fn(async () => messages) } as never,
    providerSettings: {
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
    const actual = await vi.importActual<typeof import('@/exporter/formats/conversationExporter')>(
      '@/exporter/formats/conversationExporter'
    )
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T01:02:03.456Z'))
    exporterSpies.buildContent.mockReset().mockImplementation(actual.buildConversationExportContent)
    exporterSpies.generateFilename.mockReset().mockImplementation(actual.generateExportFilename)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends only committed transcript messages to the confirmed destination captured before export', async () => {
    const options = {
      nowledgeConfig: {
        baseUrl: 'https://original.example/remote-api',
        apiKey: 'private-key',
        timeout: 5000
      }
    }
    const { service } = createFixture(options)
    const fetchMock = vi.fn(async (_url, init) => {
      const thread = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          failed_count: 0,
          results: [
            { success: true, thread_id: thread.thread_id, message_count: thread.messages.length }
          ]
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const sent = service.submitToNowledgeMem({
      sessionId: 'session-1',

      apiBaseUrl: options.nowledgeConfig.baseUrl
    })
    options.nowledgeConfig.baseUrl = 'https://changed.example'
    await sent
    expect(fetchMock.mock.calls[0][0]).toBe('https://original.example/remote-api/threads/import')
    const request = fetchMock.mock.calls[0][1]
    const body = JSON.parse(request.body)
    expect(body.messages).toHaveLength(2)
    expect(body.expected_message_count).toBe(2)
    expect(JSON.stringify(body)).not.toContain('must not export')
    expect(request.headers.Authorization).toBe('Bearer private-key')
    expect(request.redirect).toBe('error')
  })

  it('rejects a changed destination and a response without a persistence acknowledgement', async () => {
    const { service } = createFixture({
      nowledgeConfig: { baseUrl: 'https://mem.example', timeout: 5000 }
    })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      service.submitToNowledgeMem({
        sessionId: 'session-1',

        apiBaseUrl: 'https://different.example'
      })
    ).rejects.toThrow('destination changed')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(
      service.submitToNowledgeMem({
        sessionId: 'session-1',

        apiBaseUrl: 'https://mem.example'
      })
    ).rejects.toThrow('persistence acknowledgement')
  })

  it('keeps thread identity across renames and separates identically titled sessions', async () => {
    const { convertDeepChatToNowledgeMemFormat: convert } =
      await import('@/exporter/formats/nowledgeMemExporter')
    const { service } = createFixture()
    await service.export('session-1', 'nowledge-mem')
    const [conversation, messages] = exporterSpies.buildContent.mock.calls.at(-1)!
    const original = convert(conversation, messages)
    expect(original.thread_id).toBe('deepchat-session-1')
    expect(convert({ ...conversation, title: 'Renamed' }, messages).thread_id).toBe(
      original.thread_id
    )
    expect(convert({ ...conversation, id: 'session-2' }, messages).thread_id).not.toBe(
      original.thread_id
    )
  })

  it('accepts an already imported snapshot and never falls back to non-idempotent creation', async () => {
    const { service } = createFixture({
      nowledgeConfig: { baseUrl: 'https://mem.example', timeout: 5000 }
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          failed_count: 0,
          results: [
            {
              success: true,
              already_existed: true,
              thread_id: 'deepchat-session-1',
              message_count: 2
            }
          ]
        })
      })
      .mockResolvedValueOnce({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)
    const input = {
      sessionId: 'session-1',

      apiBaseUrl: 'https://mem.example'
    }
    await expect(service.submitToNowledgeMem(input)).resolves.toEqual({
      threadId: 'deepchat-session-1'
    })
    await expect(service.submitToNowledgeMem(input)).rejects.toThrow('update Mem')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.every(([url]) => url === 'https://mem.example/threads/import')
    ).toBe(true)
  })

  it('rejects a missing session', async () => {
    const service = new AgentSessionExportService({
      agentManager: {} as never,
      appSessionService: { get: vi.fn(() => null) } as never,
      transcript: {} as never,
      providerSettings: {} as never
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
        typeof import('@/exporter/formats/conversationExporter')
      >('@/exporter/formats/conversationExporter')
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

  it.each(['markdown', 'html', 'txt', 'nowledge-mem'] as const)(
    'exports the exact sent OCR attachment snapshot in %s',
    async (format) => {
      const { service, messages } = createFixture()
      const userMessage = messages.find((message) => message.role === 'user')!
      userMessage.content = JSON.stringify({
        text: 'Review the receipt',
        files: [
          {
            name: 'receipt.png',
            path: '/tmp/receipt.png',
            mimeType: 'image/png',
            requestedRepresentation: 'ocr_text',
            resolvedRepresentation: {
              kind: 'ocr_text',
              text: 'exported receipt total 42',
              tokenCount: 5,
              truncated: false
            }
          }
        ],
        links: [],
        search: false,
        think: false
      })

      const result = await service.export('session-1', format)

      expect(result.content).toContain('OCR attachment text sent to the model')
      expect(result.content).toContain('exported receipt total 42')
    }
  )

  it('exports the persisted embedded PDF body without exporting unrelated attachment payloads', async () => {
    const { service, messages } = createFixture()
    const userMessage = messages.find((message) => message.role === 'user')!
    userMessage.content = JSON.stringify({
      text: 'Summarize the report',
      files: [
        {
          name: 'report.pdf',
          path: '/tmp/report.pdf',
          mimeType: 'application/pdf',
          content: 'embedded report body',
          resolvedRepresentation: { kind: 'embedded_text' }
        },
        {
          name: 'photo.png',
          path: '/tmp/photo.png',
          mimeType: 'image/png',
          content: 'data:image/png;base64,PRIVATE_IMAGE_BYTES',
          resolvedRepresentation: { kind: 'image' }
        }
      ],
      links: [],
      search: false,
      think: false
    })

    const result = await service.export('session-1', 'markdown')

    expect(result.content).toContain('Embedded PDF text sent to the model')
    expect(result.content).toContain('embedded report body')
    expect(result.content).not.toContain('PRIVATE_IMAGE_BYTES')
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
