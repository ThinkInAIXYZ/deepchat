import { expect, it, vi } from 'vitest'
import { AgentToolManager } from '@/tool/agentTools/agentToolManager'
import { createAgentToolDependencies } from './agentToolDependencies'
import { createDimDesktopTools } from '@/app/dimDesktopTools'
import { dimDatabase } from '../../agent/dim/fixtures/database'
import { TOOL_EXECUTION } from '@shared/types/mcp'

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
