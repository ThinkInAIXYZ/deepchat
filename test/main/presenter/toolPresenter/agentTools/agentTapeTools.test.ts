import { describe, expect, it, vi } from 'vitest'
import { AgentToolManager } from '@/presenter/toolPresenter/agentTools/agentToolManager'
import { AgentTapeToolHandler, TAPE_TOOL_NAMES } from '@/presenter/toolPresenter/agentTools'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/deepchat-test'
  },
  nativeImage: {
    createFromPath: () => ({
      getSize: () => ({ width: 1, height: 1 })
    })
  }
}))

const buildRuntimePort = (overrides: Record<string, unknown> = {}) =>
  ({
    resolveConversationWorkdir: vi.fn().mockResolvedValue('/workspace'),
    resolveConversationSessionInfo: vi.fn().mockResolvedValue({
      sessionId: 'conv-1',
      agentId: 'deepchat',
      agentName: 'DeepChat',
      agentType: 'deepchat',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      projectDir: '/workspace',
      permissionMode: 'full_access',
      generationSettings: null,
      disabledAgentTools: [],
      activeSkills: [],
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled: false,
      subagentMeta: null,
      availableSubagentSlots: []
    }),
    getTapeInfo: vi.fn().mockResolvedValue({
      sessionId: 'conv-1',
      entries: 3,
      anchors: 1,
      lastAnchor: 'session/start',
      lastAnchorEntryId: 1,
      entriesSinceLastAnchor: 2,
      lastTokenUsage: 42,
      migrationState: 'ready'
    }),
    searchTape: vi.fn().mockResolvedValue([
      {
        entryId: 2,
        kind: 'message',
        name: 'user/message',
        payload: { text: 'auth flow' },
        meta: {},
        summary: 'user: auth flow',
        refs: { messageId: 'm1' },
        createdAt: 10
      }
    ]),
    getTapeContext: vi.fn().mockResolvedValue({
      sessionId: 'conv-1',
      requestedEntryIds: [2],
      matchedEntryIds: [2],
      entries: [
        {
          entryId: 2,
          kind: 'message',
          name: 'user/message',
          summary: 'user: auth flow',
          refs: { messageId: 'm1' },
          evidence: { text: 'user: auth flow', truncated: false, bytes: 15 },
          createdAt: 10
        }
      ]
    }),
    listTapeAnchors: vi.fn().mockResolvedValue([
      {
        sessionId: 'conv-1',
        entryId: 1,
        kind: 'anchor',
        name: 'session/start',
        payload: { state: { owner: 'human' } },
        meta: {},
        createdAt: 1
      }
    ]),
    handoffTape: vi.fn().mockResolvedValue({
      sessionId: 'conv-1',
      entryId: 4,
      kind: 'anchor',
      name: 'handoff/manual',
      payload: { state: { summary: 'done' } },
      meta: { handoff: true },
      createdAt: 20
    }),
    createSubagentSession: vi.fn(),
    sendConversationMessage: vi.fn(),
    cancelConversation: vi.fn(),
    subscribeDeepChatSessionUpdates: vi.fn(() => () => undefined),
    getSkillPresenter: () =>
      ({
        getActiveSkills: vi.fn().mockResolvedValue([]),
        getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
        listSkillScripts: vi.fn().mockResolvedValue([]),
        getSkillExtension: vi.fn().mockResolvedValue({
          version: 1,
          env: {},
          runtimePolicy: { python: 'auto', node: 'auto' },
          scriptOverrides: {}
        })
      }) as any,
    getYoBrowserToolHandler: () => ({
      getToolDefinitions: vi.fn().mockReturnValue([]),
      callTool: vi.fn()
    }),
    getFilePresenter: () => ({
      getMimeType: vi.fn(),
      prepareFileCompletely: vi.fn()
    }),
    getLlmProviderPresenter: () => ({
      executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
      generateCompletionStandalone: vi.fn(),
      generateImageStandalone: vi.fn()
    }),
    cacheImage: vi.fn(),
    createSettingsWindow: vi.fn(),
    sendToWindow: vi.fn(),
    getApprovedFilePaths: vi.fn().mockReturnValue([]),
    consumeSettingsApproval: vi.fn().mockReturnValue(false),
    ...overrides
  }) as any

const buildManager = (runtimePort = buildRuntimePort()) =>
  new AgentToolManager({
    agentWorkspacePath: '/workspace',
    configPresenter: {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getSkillsPath: vi.fn().mockReturnValue('/skills'),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({}),
      getModelConfig: vi.fn().mockReturnValue({})
    } as any,
    runtimePort
  })

describe('Agent tape tools', () => {
  it('exposes only the atomic recall pair for DeepChat sessions', async () => {
    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })

    const tapeNames = defs
      .filter((def) => def.server.name === 'agent-tape')
      .map((def) => def.function.name)

    expect(tapeNames).toEqual([TAPE_TOOL_NAMES.search, TAPE_TOOL_NAMES.context])
  })

  it('exposes neither recall tool when compact context is unsupported', async () => {
    const manager = buildManager(buildRuntimePort({ getTapeContext: undefined }))

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })
    expect(defs.some((def) => def.server.name === 'agent-tape')).toBe(false)
  })

  it('exposes neither recall tool when search is unsupported', async () => {
    const manager = buildManager(buildRuntimePort({ searchTape: undefined }))

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })

    expect(defs.some((def) => def.server.name === 'agent-tape')).toBe(false)
  })

  it('does not expose tape tools outside DeepChat sessions', async () => {
    const runtimePort = buildRuntimePort({
      resolveConversationSessionInfo: vi.fn().mockResolvedValue({
        agentType: 'acp'
      })
    })
    const manager = buildManager(runtimePort)

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })

    expect(defs.some((def) => def.server.name === 'agent-tape')).toBe(false)
    await expect(
      manager.callTool(TAPE_TOOL_NAMES.search, { query: 'needle' }, 'conv-1')
    ).rejects.toThrow('Tape recall tools are not available for this conversation.')
    expect(runtimePort.searchTape).not.toHaveBeenCalled()
  })

  it.each([
    [TAPE_TOOL_NAMES.search, { query: 'needle' }, 'getTapeContext'],
    [TAPE_TOOL_NAMES.context, { entryIds: [1] }, 'searchTape']
  ] as const)(
    'rejects direct %s execution when the recall pair is incomplete',
    async (toolName, args, missingPort) => {
      const runtimePort = buildRuntimePort({ [missingPort]: undefined })
      const manager = buildManager(runtimePort)

      await expect(manager.callTool(toolName, args, 'conv-1')).rejects.toThrow(
        'Tape recall tools are not available for this conversation.'
      )
      const targetPort =
        toolName === TAPE_TOOL_NAMES.search ? runtimePort.searchTape : runtimePort.getTapeContext
      expect(targetPort).not.toHaveBeenCalled()
    }
  )

  it('does not expose recall tools without a conversation ID', async () => {
    const runtimePort = buildRuntimePort()
    const handler = new AgentTapeToolHandler(runtimePort)
    const manager = buildManager(runtimePort)

    await expect(handler.canUse('   ')).resolves.toBe(false)
    expect(runtimePort.resolveConversationSessionInfo).not.toHaveBeenCalled()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: '   '
    })

    expect(defs.some((def) => def.server.name === 'agent-tape')).toBe(false)
    await expect(
      manager.callTool(TAPE_TOOL_NAMES.search, { query: 'needle' }, '   ')
    ).rejects.toThrow(`${TAPE_TOOL_NAMES.search} requires a conversation ID.`)
    expect(runtimePort.searchTape).not.toHaveBeenCalled()
  })

  it('routes only recall calls through the runtime port', async () => {
    const runtimePort = buildRuntimePort()
    const manager = buildManager(runtimePort)

    const search = (await manager.callTool(
      TAPE_TOOL_NAMES.search,
      {
        query: 'auth',
        limit: 5,
        kinds: ['message'],
        start: '1970-01-01T00:00:00.000Z',
        end: '999'
      },
      'conv-1'
    )) as {
      content: string
    }
    const context = (await manager.callTool(
      TAPE_TOOL_NAMES.context,
      { entryIds: [2], before: 1, after: 1, limit: 10 },
      'conv-1'
    )) as {
      content: string
    }
    expect(JSON.parse(search.content)).toHaveLength(1)
    expect(JSON.parse(search.content)[0]).not.toHaveProperty('payload')
    expect(JSON.parse(search.content)[0]).not.toHaveProperty('meta')
    expect(JSON.parse(context.content)).toMatchObject({
      sessionId: 'conv-1',
      entries: [
        {
          entryId: 2,
          summary: 'user: auth flow',
          evidence: { text: 'user: auth flow', truncated: false }
        }
      ]
    })
    expect(JSON.parse(context.content).entries[0]).not.toHaveProperty('payload')
    expect(runtimePort.searchTape).toHaveBeenCalledWith('conv-1', 'auth', {
      limit: 5,
      kinds: ['message'],
      start: '1970-01-01T00:00:00.000Z',
      end: '999'
    })
    expect(runtimePort.getTapeContext).toHaveBeenCalledWith('conv-1', [2], {
      before: 1,
      after: 1,
      limit: 10,
      maxBytesPerEntry: undefined,
      maxTotalBytes: undefined
    })
    expect(runtimePort.getTapeInfo).not.toHaveBeenCalled()
    expect(runtimePort.listTapeAnchors).not.toHaveBeenCalled()
    expect(runtimePort.handoffTape).not.toHaveBeenCalled()
  })

  it.each([TAPE_TOOL_NAMES.info, TAPE_TOOL_NAMES.anchors, TAPE_TOOL_NAMES.handoff])(
    'rejects non-model Tape call %s without runtime side effects',
    async (toolName) => {
      const runtimePort = buildRuntimePort()
      const manager = buildManager(runtimePort)

      await expect(manager.callTool(toolName, {}, 'conv-1')).rejects.toThrow(
        `Tape tool '${toolName}' is not available to the model.`
      )

      expect(runtimePort.getTapeInfo).not.toHaveBeenCalled()
      expect(runtimePort.listTapeAnchors).not.toHaveBeenCalled()
      expect(runtimePort.handoffTape).not.toHaveBeenCalled()
    }
  )
})
