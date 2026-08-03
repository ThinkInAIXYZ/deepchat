import { describe, expect, it, vi } from 'vitest'
import { AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS } from '@shared/types/agent-memory'
import { resolveDeepChatSubagentCapability } from '@shared/lib/deepchatSubagents'

import { AgentMemoryToolHandler, MEMORY_TOOL_NAMES } from '@/tool/agentTools/agentMemoryTools'

const buildRuntimePort = (overrides: Record<string, unknown> = {}) =>
  ({
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
      subagentMeta: null,
      subagentCapability: resolveDeepChatSubagentCapability({
        agentType: 'deepchat',
        sessionKind: 'regular',
        agentPolicyEnabled: false,
        slots: []
      })
    }),
    isMemoryEnabled: vi.fn().mockReturnValue(true),
    rememberMemory: vi.fn(),
    recallMemory: vi.fn(),
    forgetMemory: vi.fn().mockResolvedValue({ action: 'applied' }),
    ...overrides
  }) as any

describe('Agent memory tools', () => {
  it('rejects memory_remember content above the manual limit before invoking the runtime', async () => {
    const runtimePort = buildRuntimePort()
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)

    await expect(
      handler.call(
        MEMORY_TOOL_NAMES.remember,
        { content: 'x'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS + 1) },
        'conversation-1'
      )
    ).rejects.toThrow()
    expect(runtimePort.rememberMemory).not.toHaveBeenCalled()
  })

  it('accepts astral content at the manual code-point limit', async () => {
    const runtimePort = buildRuntimePort({
      rememberMemory: vi.fn().mockResolvedValue({ action: 'created', id: 'mem-emoji' })
    })
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)
    const content = '😀'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS)

    await handler.call(MEMORY_TOOL_NAMES.remember, { content }, 'conversation-1')

    expect(runtimePort.rememberMemory).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({ content }),
      'conversation-1',
      expect.any(Object)
    )
  })

  it('passes memory_remember category through to the runtime port', async () => {
    const runtimePort = buildRuntimePort({
      rememberMemory: vi.fn().mockResolvedValue({ action: 'created', id: 'mem-1' })
    })
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)

    const rememberDef = handler
      .getToolDefinitions()
      .find((definition) => definition.function.name === MEMORY_TOOL_NAMES.remember)
    const result = await handler.call(
      MEMORY_TOOL_NAMES.remember,
      {
        content: 'repo uses pnpm',
        kind: 'episodic',
        category: 'project_fact',
        importance: 0.1
      },
      'conv-1'
    )

    expect(JSON.stringify(rememberDef?.function.parameters)).toContain('project_fact')
    expect(runtimePort.rememberMemory).toHaveBeenCalledWith(
      'deepchat',
      {
        content: 'repo uses pnpm',
        kind: 'episodic',
        category: 'project_fact',
        importance: 0.1
      },
      'conv-1',
      { providerId: 'openai', modelId: 'gpt-4.1' }
    )
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      action: 'created',
      id: 'mem-1'
    })
  })

  it('requires an explicit user action when memory_remember matches a tombstone', async () => {
    const runtimePort = buildRuntimePort({
      rememberMemory: vi.fn().mockResolvedValue({ action: 'noop', reason: 'forgotten' })
    })
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)

    const result = await handler.call(
      MEMORY_TOOL_NAMES.remember,
      { content: 'previously deleted private fact' },
      'conv-1'
    )

    expect(JSON.parse(result.content)).toEqual({
      ok: false,
      action: 'noop',
      reason: 'requires_user_reauthorization'
    })
    expect(JSON.stringify(result.rawData)).toContain('requires an explicit user action')
  })

  it('recalls the current session scope without broadening the agent owner boundary', async () => {
    const recallMemory = vi.fn().mockResolvedValue([])
    const runtimePort = buildRuntimePort({ recallMemory })
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)

    await handler.call(MEMORY_TOOL_NAMES.recall, { query: 'redis' }, 'conv-1')

    expect(recallMemory).toHaveBeenCalledWith('deepchat', 'redis', {
      sessionId: 'conv-1'
    })
  })

  it('exposes memory_forget as a soft forget operation', async () => {
    const runtimePort = buildRuntimePort()
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)

    const forgetDef = handler
      .getToolDefinitions()
      .find((definition) => definition.function.name === MEMORY_TOOL_NAMES.forget)
    const result = await handler.call(MEMORY_TOOL_NAMES.forget, { memoryId: 'mem-1' }, 'conv-1')

    expect(forgetDef?.function.description).toContain('Archive')
    expect(forgetDef?.function.description).not.toContain('Delete')
    expect(runtimePort.forgetMemory).toHaveBeenCalledWith('deepchat', 'mem-1')
    expect(JSON.parse(result.content)).toEqual({ ok: true })
    expect(JSON.stringify(result.rawData)).toContain('Archived the memory.')
    expect(JSON.stringify(result.rawData)).toContain('retained locally')
    expect(JSON.stringify(result.rawData)).not.toContain('Deleted the memory.')
  })

  it('does not expose internal rejection details when memory_forget cannot archive the target', async () => {
    const runtimePort = buildRuntimePort({
      forgetMemory: vi.fn().mockResolvedValue({ action: 'rejected', reason: 'unavailable' })
    })
    const handler = new AgentMemoryToolHandler(runtimePort, runtimePort)

    const result = await handler.call(
      MEMORY_TOOL_NAMES.forget,
      { memoryId: 'mem-conflicted' },
      'conv-1'
    )

    expect(JSON.parse(result.content)).toEqual({ ok: false })
    expect(JSON.stringify(result.rawData)).toContain('Memory could not be archived.')
    expect(JSON.stringify(result.rawData)).not.toContain('unavailable')
  })
})
