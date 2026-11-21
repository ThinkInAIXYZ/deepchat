import { expect, it, vi } from 'vitest'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { createAgentToolDependencies } from './agentToolDependencies'
import { createDimDesktopTools } from '@/app/dimDesktopTools'
import { dimDatabase } from '../../agent/dim/fixtures/database'
import { TOOL_EXECUTION } from '@shared/types/mcp'
import { SessionReferenceReadError } from '@/session/data/sessionReferences'
import * as toolPolicyStore from '@/plugin/toolPolicyStore'

it('publishes desktop capabilities without replacing native tools or exposing ACP session readers', async () => {
  const session = vi
    .fn()
    .mockResolvedValue({ agentId: 'deepchat', agentType: 'deepchat', sessionKind: 'regular' })
  const readSession = vi.fn().mockResolvedValue({ messages: [] })
  const browser = {
    getToolDefinitions: () => [
      {
        type: 'function',
        execution: TOOL_EXECUTION.write,
        function: {
          name: 'cdp_send',
          description: '',
          parameters: { type: 'object', properties: {} }
        },
        server: { name: 'yobrowser', icons: '', description: '' }
      }
    ],
    callTool: vi.fn().mockResolvedValue('desktop browser')
  }
  const desktop = new AgentToolManager({
    providerSettings: { getModelConfig: vi.fn(), isKnownModel: vi.fn() },
    agentSettings: { resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({}) },
    skillSettings: { isEnabled: () => false } as never,
    desktopSettings: {} as never,
    dependencies: createAgentToolDependencies({
      resolveConversationSessionInfo: session,
      readSession,
      browser
    })
  })
  const definitions = await desktop.getAllToolDefinitions({ conversationId: 'root' })
  expect(definitions.map((tool) => tool.function.name)).toEqual(['cdp_send', 'read_session'])
  await expect(desktop.callTool('exec', { command: 'echo legacy' }, 'root')).rejects.toThrow(
    'Unknown desktop tool'
  )
  const input = { sessionId: 'referenced', action: 'messages' }
  await desktop.callTool('read_session', input, 'root')
  expect(readSession).toHaveBeenCalledWith('root', input)
  await desktop.callTool('read_session', { action: 'messages' }, 'root')
  expect(readSession).toHaveBeenLastCalledWith('root', { sessionId: 'root', action: 'messages' })
  readSession.mockRejectedValueOnce(
    new SessionReferenceReadError('Add a fresh @session reference.')
  )
  const denied = await desktop.callTool('read_session', input, 'root')
  expect(denied).toMatchObject({
    content: expect.stringContaining('Add a fresh @session reference.'),
    rawData: { isError: true }
  })
  for (const row of [
    { agentType: 'acp', sessionKind: 'regular' },
    { agentType: 'deepchat', sessionKind: 'subagent' }
  ]) {
    session.mockResolvedValue(row)
    expect(
      (await desktop.getAllToolDefinitions({ conversationId: 'root' })).map(
        (tool) => tool.function.name
      )
    ).not.toContain('read_session')
  }
  expect(
    await desktop.getAllToolDefinitions({ chatMode: 'acp agent', conversationId: 'root' })
  ).toEqual([])
  const { data, sqlite } = dimDatabase()
  try {
    const binding = data.dimSessionBindingsTable.bind('root', 'native')
    const catalog = createDimDesktopTools({
      desktop,
      mcp: { getAllToolDefinitions: vi.fn(), callTool: vi.fn() },
      selection: async () => ({ agentId: 'deepchat', disabled: [], bridgeServerNames: [] })
    })
    const tools = await catalog(binding)
    const result = await tools[0].execute(
      {
        sessionId: 'native',
        branchId: 'main',
        turnId: 'turn',
        callId: 'call',
        name: 'cdp_send',
        arguments: {}
      },
      new AbortController().signal
    )
    expect(result).toMatchObject({ content: 'desktop browser' })
    expect(browser.callTool).toHaveBeenCalledWith(
      'cdp_send',
      {},
      'root',
      'turn',
      expect.any(Function),
      expect.any(AbortSignal)
    )
  } finally {
    sqlite.close()
  }
})

it('keeps desktop MCP and settings navigation behind native consent', async () => {
  const policy = vi.spyOn(toolPolicyStore, 'resolvePluginToolPolicy')
  policy.mockImplementation((_serverId, toolName) =>
    toolName === 'trusted'
      ? { managed: true, decision: 'allow' }
      : toolName === 'confirm'
        ? { managed: true, decision: 'ask' }
        : { managed: false, decision: null }
  )
  const mcpTool = (name: string) => ({
    type: 'function',
    execution: TOOL_EXECUTION.read.parallel,
    function: { name, description: '', parameters: { type: 'object', properties: {} } },
    server: { name: 'remote', icons: '', description: '' }
  })
  const desktopTool = (name: string) => ({
    ...mcpTool(name),
    server: { name: 'deepchat', icons: '', description: '' }
  })
  const { data, sqlite } = dimDatabase()
  try {
    const catalog = createDimDesktopTools({
      desktop: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue([desktopTool('read_session'), desktopTool('deepchat_settings_open')]),
        callTool: vi.fn()
      } as never,
      mcp: {
        getAllToolDefinitions: vi
          .fn()
          .mockResolvedValue([mcpTool('untrusted'), mcpTool('trusted'), mcpTool('confirm')]),
        callTool: vi.fn()
      } as never,
      cacheImage: vi.fn(),
      supportsVision: async () => false,
      selection: async () => ({ agentId: 'deepchat', disabled: [], bridgeServerNames: ['remote'] })
    })
    const risks = (await catalog(data.dimSessionBindingsTable.bind('root', 'native'))).map(
      (tool) => tool.risk
    )
    // `session` is admitted silently by dim; `network` asks in default mode.
    expect(risks).toEqual(['session', 'product_approval', 'network', 'session', 'product_approval'])
  } finally {
    policy.mockRestore()
    sqlite.close()
  }
})
