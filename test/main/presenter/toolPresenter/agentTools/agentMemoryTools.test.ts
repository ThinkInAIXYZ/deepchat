import { describe, expect, it, vi } from 'vitest'

import {
  AgentMemoryToolHandler,
  MEMORY_TOOL_NAMES
} from '@/presenter/toolPresenter/agentTools/agentMemoryTools'

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
      subagentEnabled: false,
      subagentMeta: null,
      availableSubagentSlots: []
    }),
    isMemoryEnabled: vi.fn().mockReturnValue(true),
    rememberMemory: vi.fn(),
    recallMemory: vi.fn(),
    forgetMemory: vi.fn().mockResolvedValue(true),
    ...overrides
  }) as any

describe('Agent memory tools', () => {
  it('exposes memory_forget as a soft forget operation', async () => {
    const runtimePort = buildRuntimePort()
    const handler = new AgentMemoryToolHandler(runtimePort)

    const forgetDef = handler
      .getToolDefinitions()
      .find((definition) => definition.function.name === MEMORY_TOOL_NAMES.forget)
    const result = await handler.call(MEMORY_TOOL_NAMES.forget, { memoryId: 'mem-1' }, 'conv-1')

    expect(forgetDef?.function.description).toContain('Archive')
    expect(forgetDef?.function.description).not.toContain('Delete')
    expect(runtimePort.forgetMemory).toHaveBeenCalledWith('deepchat', 'mem-1')
    expect(JSON.parse(result.content)).toEqual({ ok: true })
    expect(JSON.stringify(result.rawData)).toContain('Forgot the memory.')
    expect(JSON.stringify(result.rawData)).not.toContain('Deleted the memory.')
  })
})
