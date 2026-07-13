import { describe, expect, it, vi } from 'vitest'
import type { PermissionMode } from '@shared/types/agent-interface'
import type { MCPToolCall, MCPToolDefinition } from '@shared/types/core/mcp'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ToolResultPort } from '@/agent/deepchat/loop/ports'
import {
  createToolCatalogPort,
  createToolExecutionPort,
  createToolResultPort,
  type ToolCatalogCacheEntry
} from '@/presenter/agentRuntimePresenter/toolAdapters'

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

function createToolPresenter(overrides: Partial<IToolPresenter> = {}): IToolPresenter {
  return {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({
      content: 'ok',
      rawData: { toolCallId: 'call-1', content: 'ok', isError: false }
    }),
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
    const toolPresenter = createToolPresenter({ getAllToolDefinitions })
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
      toolPresenter,
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
    const toolPresenter = createToolPresenter({ getAllToolDefinitions, syncAgentToolContext })
    let fingerprint = 'revision:1'
    let cached: ToolCatalogCacheEntry<'code'> | undefined
    const port = createToolCatalogPort({
      toolPresenter,
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
    const port = createToolExecutionPort(createToolPresenter({ preCheckToolPermission, callTool }))!
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
      enabledSkillNames: ['skill-a', 'skill-b'],
      agentId: 'agent-1',
      enabledMcpServerIds: ['mcp-1']
    })

    expect(preCheckToolPermission).toHaveBeenCalledWith(call, { permissionMode })
    expect(callTool).toHaveBeenCalledWith(call, {
      onProgress,
      signal: abortController.signal,
      permissionMode,
      activeSkillNames: ['skill-a'],
      enabledSkillNames: ['skill-a', 'skill-b'],
      agentId: 'agent-1',
      enabledMcpServerIds: ['mcp-1']
    })
  })

  it('keeps pre-check absent when the owner has no pre-check capability', async () => {
    const order: string[] = []
    const callTool = vi.fn(() => {
      order.push('execute')
      return Promise.resolve({
        content: 'ok',
        rawData: { toolCallId: 'call-1', content: 'ok', isError: false }
      })
    })
    const port = createToolExecutionPort(createToolPresenter({ callTool }))!
    const call: MCPToolCall = {
      id: 'call-1',
      type: 'function',
      function: { name: 'read', arguments: '{}' }
    }

    expect(port.preCheck).toBeUndefined()
    const result = port.execute(call)
    expect(order).toEqual(['execute'])
    await expect(result).resolves.toMatchObject({ content: 'ok' })
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
})
