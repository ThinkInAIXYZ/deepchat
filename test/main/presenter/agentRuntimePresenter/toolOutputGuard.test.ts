import { describe, expect, it, vi } from 'vitest'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import { getUsableContextLength } from '@/presenter/agentRuntimePresenter/contextBudget'
import { ToolOutputGuard } from '@/presenter/agentRuntimePresenter/toolOutputGuard'

vi.mock('tokenx', () => ({
  approximateTokenSize: vi.fn((text: string) => text.length)
}))

describe('ToolOutputGuard', () => {
  it('checks tool continuation budget against the safety-adjusted context window', () => {
    const guard = new ToolOutputGuard()
    const toolDefinitions: MCPToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Read current project state.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            required: ['query']
          }
        },
        server: {
          name: 'test',
          icons: '',
          description: 'Test server'
        }
      }
    ]
    const toolDefinitionTokens = JSON.stringify(toolDefinitions[0]).length
    const maxMessageTokens = getUsableContextLength(5000) - 1000 - toolDefinitionTokens

    expect(
      guard.hasContextBudget({
        conversationMessages: [{ role: 'user', content: 'x'.repeat(maxMessageTokens) }],
        toolDefinitions,
        contextLength: 5000,
        maxTokens: 1000
      })
    ).toBe(true)
    expect(
      guard.hasContextBudget({
        conversationMessages: [{ role: 'user', content: 'x'.repeat(maxMessageTokens + 1) }],
        toolDefinitions,
        contextLength: 5000,
        maxTokens: 1000
      })
    ).toBe(false)
  })
})
