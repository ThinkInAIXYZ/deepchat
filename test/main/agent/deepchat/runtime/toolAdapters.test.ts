import { describe, expect, it, vi } from 'vitest'
import type { PermissionMode } from '@shared/types/agent-interface'
import type { MCPToolCall, MCPToolDefinition } from '@shared/types/core/mcp'
import type { ToolServicePort } from '@shared/types/tool'
import type { ToolResultPort } from '@/agent/deepchat/loop/ports'
import {
  createToolCatalogPort,
  createToolExecutionPort,
  createToolResultPort,
  normalizeToolResultContent,
  type ToolCatalogCacheEntry
} from '@/agent/deepchat/runtime/toolAdapters'

function makeTool(name: string): MCPToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'test-server', icons: '', description: 'Test server' }
  }
}

function createToolService(overrides: Partial<ToolServicePort> = {}): ToolServicePort {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    syncAgentToolContext: vi.fn(),
    callTool: vi.fn().mockResolvedValue({
      content: 'ok',
      rawData: { toolCallId: 'call-1', content: 'ok', isError: false }
    }),
    preCheckToolPermission: vi.fn().mockResolvedValue(null),
    clearConversationToolMapping: vi.fn(),
    clearAgentPlanState: vi.fn(),
    buildToolSystemPrompt: vi.fn().mockReturnValue(''),
    ...overrides
  }
}

describe('DeepChat tool adapters', () => {
  it.each([
    ['zero', []],
    ['one', [makeTool('read')]],
    ['many', [makeTool('read'), makeTool('write')]]
  ])('resolves %s final definitions with the exact policy context', async (_case, tools) => {
    const getAllToolDefinitions = vi.fn().mockResolvedValue(tools)
    const toolService = createToolService({ getAllToolDefinitions })
    const commitCache = vi.fn()
    const resolveContext = vi.fn(async (activeSkillNames?: string[]) => ({
      profile: 'code' as const,
      fingerprint: 'revision:1',
      context: {
        agentId: 'agent-1',
        disabledAgentTools: ['write'],
        chatMode: 'agent' as const,
        conversationId: 'session-1',
        agentWorkspacePath: '/workspace',
        activeSkillNames
      }
    }))
    const port = createToolCatalogPort({
      toolService,
      resolveContext,
      commitCache
    })

    await expect(port.resolve({ activeSkillNames: ['approved-skill'] })).resolves.toEqual(tools)
    expect(resolveContext).toHaveBeenCalledWith(['approved-skill'])
    expect(getAllToolDefinitions).toHaveBeenCalledWith({
      agentId: 'agent-1',
      disabledAgentTools: ['write'],
      chatMode: 'agent',
      conversationId: 'session-1',
      agentWorkspacePath: '/workspace',
      activeSkillNames: ['approved-skill']
    })
    expect(commitCache).toHaveBeenCalledWith({
      profile: 'code',
      fingerprint: 'revision:1',
      tools
    })
  })

  it('reuses an exact profile cache and reloads after the registry revision changes', async () => {
    const firstTools = [makeTool('read')]
    const revisedTools = [makeTool('read'), makeTool('grep')]
    const getAllToolDefinitions = vi
      .fn()
      .mockResolvedValueOnce(firstTools)
      .mockResolvedValueOnce(revisedTools)
    const syncAgentToolContext = vi.fn()
    const toolService = createToolService({ getAllToolDefinitions, syncAgentToolContext })
    let fingerprint = 'revision:1'
    let cached: ToolCatalogCacheEntry<'code'> | undefined
    const port = createToolCatalogPort({
      toolService,
      resolveContext: async () => ({
        profile: 'code' as const,
        fingerprint,
        cached,
        context: {
          chatMode: 'agent' as const,
          agentWorkspacePath: '/workspace',
          conversationId: 'session-1'
        }
      }),
      commitCache: (entry) => {
        cached = entry
      }
    })

    await expect(port.resolve()).resolves.toEqual(firstTools)
    await expect(port.resolve()).resolves.toEqual(firstTools)
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(1)
    expect(syncAgentToolContext).toHaveBeenCalledWith({
      chatMode: 'agent',
      agentWorkspacePath: '/workspace'
    })

    fingerprint = 'revision:2'
    await expect(port.resolve()).resolves.toEqual(revisedTools)
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(2)
    expect(cached).toEqual({
      profile: 'code',
      fingerprint: 'revision:2',
      tools: revisedTools
    })
  })

  it('forwards pre-check and execution options without changing the abort signal', async () => {
    const preCheckToolPermission = vi.fn().mockResolvedValue({
      needsPermission: true,
      toolName: 'write',
      serverName: 'agent-filesystem',
      permissionType: 'write',
      description: 'Write file'
    })
    const callTool = vi.fn().mockResolvedValue({
      content: 'written',
      rawData: { toolCallId: 'call-1', content: 'written', isError: false }
    })
    const port = createToolExecutionPort(createToolService({ preCheckToolPermission, callTool }))!
    const call: MCPToolCall = {
      id: 'call-1',
      type: 'function',
      function: { name: 'write', arguments: '{"path":"a.txt"}' },
      conversationId: 'session-1'
    }
    const permissionMode: PermissionMode = 'auto_approve'
    const abortController = new AbortController()
    const onProgress = vi.fn()

    await port.preCheck(call, { permissionMode })
    await port.execute(call, {
      onProgress,
      signal: abortController.signal,
      permissionMode,
      activeSkillNames: ['skill-a'],
      agentId: 'agent-1',
      enabledMcpServerIds: ['mcp-1']
    })

    expect(preCheckToolPermission).toHaveBeenCalledWith(call, { permissionMode })
    expect(callTool).toHaveBeenCalledWith(call, {
      onProgress,
      signal: abortController.signal,
      permissionMode,
      activeSkillNames: ['skill-a'],
      agentId: 'agent-1',
      enabledMcpServerIds: ['mcp-1']
    })
  })

  it('delegates success, error, screenshot fallback, preparation and batch fitting', async () => {
    const normalize: ToolResultPort['normalize'] = vi.fn(async ({ content, isError }) =>
      isError ? content : 'English screenshot summary'
    )
    const prepareToolOutput = vi.fn().mockResolvedValue({
      kind: 'ok',
      content: 'prepared',
      offloaded: false
    })
    const fitToolBatchOutputs = vi.fn().mockResolvedValue({
      kind: 'ok',
      results: [
        {
          toolCallId: 'call-1',
          toolName: 'cdp_send',
          responseText: 'prepared',
          contextResponseText: 'prepared',
          isError: false,
          downgraded: false
        }
      ]
    })
    const port = createToolResultPort({
      normalize,
      outputGuard: { prepareToolOutput, fitToolBatchOutputs }
    })
    const abortController = new AbortController()
    const screenshotInput = {
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'cdp_send',
      toolArgs: '{"method":"Page.captureScreenshot"}',
      content: '{"data":"YWJj"}',
      isError: false,
      signal: abortController.signal
    }

    await expect(port.normalize(screenshotInput)).resolves.toBe('English screenshot summary')
    await expect(
      port.normalize({ ...screenshotInput, content: 'failed', isError: true })
    ).resolves.toBe('failed')
    await port.prepare({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      toolName: 'cdp_send',
      rawContent: 'English screenshot summary'
    })
    await port.fitBatch({
      conversationMessages: [],
      toolDefinitions: [makeTool('cdp_send')],
      contextLength: 32_000,
      maxTokens: 1_024,
      results: [
        {
          toolCallId: 'call-1',
          toolName: 'cdp_send',
          responseText: 'prepared',
          isError: false
        }
      ]
    })

    expect(normalize).toHaveBeenNthCalledWith(1, screenshotInput)
    expect(normalize).toHaveBeenNthCalledWith(2, {
      ...screenshotInput,
      content: 'failed',
      isError: true
    })
    expect(prepareToolOutput).toHaveBeenCalledTimes(1)
    expect(fitToolBatchOutputs).toHaveBeenCalledTimes(1)
  })

  it('normalizes a screenshot through the resolved session vision model', async () => {
    const executeWithRateLimit = vi.fn().mockResolvedValue(undefined)
    const generateCompletionStandalone = vi.fn().mockResolvedValue('Visible browser page')
    const result = await normalizeToolResultContent(
      {
        providerSettings: {
          getModelConfig: vi.fn(() => ({ vision: true, temperature: 0.1, maxTokens: 500 })),
          isKnownModel: vi.fn(() => true)
        } as any,
        agentSettings: {
          resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({}),
          agentSupportsCapability: vi.fn().mockResolvedValue(true)
        } as any,
        providerRuntime: {
          executeWithRateLimit,
          generateCompletionStandalone
        } as any,
        getAbortSignal: () => undefined,
        getSessionModel: () => ({
          providerId: 'openai',
          modelId: 'gpt-4o',
          agentId: 'deepchat'
        })
      },
      {
        sessionId: 'session-1',
        toolCallId: 'call-1',
        toolName: 'cdp_send',
        toolArgs: '{"method":"Page.captureScreenshot","params":{"format":"jpeg"}}',
        content: '{"data":"YWJj"}',
        isError: false
      }
    )

    expect(result).toBe('Visible browser page')
    expect(executeWithRateLimit).toHaveBeenCalledWith('openai', { signal: undefined })
    expect(generateCompletionStandalone).toHaveBeenCalledWith(
      'openai',
      [
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'image_url',
              image_url: expect.objectContaining({ url: 'data:image/jpeg;base64,YWJj' })
            })
          ])
        })
      ],
      'gpt-4o',
      0.1,
      500,
      { signal: undefined, swallowErrors: false }
    )
  })
})
