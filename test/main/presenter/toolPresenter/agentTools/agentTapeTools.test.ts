import { describe, expect, it, vi } from 'vitest'
import { AgentToolManager } from '@/presenter/toolPresenter/agentTools/agentToolManager'
import { TAPE_TOOL_NAMES } from '@/presenter/toolPresenter/agentTools'

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
  it('exposes tape tools for DeepChat sessions', async () => {
    const manager = buildManager()

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })

    expect(defs.map((def) => def.function.name)).toEqual(
      expect.arrayContaining([
        TAPE_TOOL_NAMES.info,
        TAPE_TOOL_NAMES.search,
        TAPE_TOOL_NAMES.context,
        TAPE_TOOL_NAMES.anchors,
        TAPE_TOOL_NAMES.handoff
      ])
    )
    const handoffDef = defs.find((def) => def.function.name === TAPE_TOOL_NAMES.handoff)
    const handoffParameters = handoffDef?.function.parameters as
      | { additionalProperties?: unknown; properties?: Record<string, unknown> }
      | undefined
    expect(handoffParameters?.properties).toHaveProperty('summary')
    expect(handoffParameters?.properties).not.toHaveProperty('state')
    expect(handoffParameters?.additionalProperties).toBe(false)
  })

  it('keeps base tape tools available when compact context is unsupported', async () => {
    const manager = buildManager(buildRuntimePort({ getTapeContext: undefined }))

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })
    const names = defs.map((def) => def.function.name)

    expect(names).toEqual(
      expect.arrayContaining([
        TAPE_TOOL_NAMES.info,
        TAPE_TOOL_NAMES.search,
        TAPE_TOOL_NAMES.anchors,
        TAPE_TOOL_NAMES.handoff
      ])
    )
    expect(names).not.toContain(TAPE_TOOL_NAMES.context)
  })

  it('does not expose tape tools outside DeepChat sessions', async () => {
    const manager = buildManager(
      buildRuntimePort({
        resolveConversationSessionInfo: vi.fn().mockResolvedValue({
          agentType: 'acp'
        })
      })
    )

    const defs = await manager.getAllToolDefinitions({
      chatMode: 'agent',
      supportsVision: false,
      agentWorkspacePath: '/workspace',
      conversationId: 'conv-1'
    })

    expect(defs.some((def) => def.function.name === TAPE_TOOL_NAMES.info)).toBe(false)
  })

  it('routes tape tool calls through the runtime port', async () => {
    const runtimePort = buildRuntimePort()
    const manager = buildManager(runtimePort)

    const info = (await manager.callTool(TAPE_TOOL_NAMES.info, {}, 'conv-1')) as {
      content: string
    }
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
    const handoff = (await manager.callTool(
      TAPE_TOOL_NAMES.handoff,
      { name: 'manual', summary: 'done' },
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
    const anchors = (await manager.callTool(TAPE_TOOL_NAMES.anchors, { limit: 5 }, 'conv-1')) as {
      content: string
    }

    expect(JSON.parse(info.content)).toMatchObject({ entries: 3, migrationState: 'ready' })
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
    expect(JSON.parse(handoff.content)).toEqual({
      name: 'handoff/manual',
      entryId: 4,
      createdAt: 20
    })
    expect(JSON.parse(anchors.content)).toEqual([
      { name: 'session/start', entryId: 1, createdAt: 1 }
    ])
    expect(JSON.parse(anchors.content)[0]).not.toHaveProperty('payload')
    expect(runtimePort.getTapeInfo).toHaveBeenCalledWith('conv-1')
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
    expect(runtimePort.listTapeAnchors).toHaveBeenCalledWith('conv-1', { limit: 5 })
    expect(runtimePort.handoffTape).toHaveBeenCalledWith('conv-1', 'manual', { summary: 'done' })
  })

  it('rejects legacy tape_handoff state without writing an empty anchor', async () => {
    const runtimePort = buildRuntimePort()
    const manager = buildManager(runtimePort)

    await expect(
      manager.callTool(
        TAPE_TOOL_NAMES.handoff,
        { name: 'manual', state: { summary: 'done' } },
        'conv-1'
      )
    ).rejects.toThrow('do not pass "state"')

    expect(runtimePort.handoffTape).not.toHaveBeenCalled()
  })
})
