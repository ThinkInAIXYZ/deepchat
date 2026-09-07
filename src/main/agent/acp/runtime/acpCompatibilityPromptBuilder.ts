import type {
  AcpBuiltCompatibilityPrompt,
  AcpCompatibilityPromptPort,
  AcpCompatibilityPromptSections
} from '@/agent/acp/instance/ports'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'

const SECTION_ORDER: ReadonlyArray<keyof AcpCompatibilityPromptSections> = [
  'configured',
  'runtime',
  'environment',
  'skills',
  'activeSkills',
  'tooling',
  'permission',
  'verification'
]

export class AcpCompatibilityPromptBuilder implements AcpCompatibilityPromptPort {
  build(input: {
    scope: 'regular' | 'subagent'
    latestUserMessage: ChatMessage
    sections: AcpCompatibilityPromptSections
    localToolDefinitions: readonly MCPToolDefinition[]
  }): AcpBuiltCompatibilityPrompt {
    if (input.scope === 'subagent') {
      return {
        messages: [input.latestUserMessage],
        localToolDefinitions: []
      }
    }

    const systemPrompt = SECTION_ORDER.map((key) => input.sections[key].trim())
      .filter(Boolean)
      .join('\n\n')
    const messages: ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, input.latestUserMessage]
      : [input.latestUserMessage]

    return {
      messages,
      localToolDefinitions: [...input.localToolDefinitions]
    }
  }
}
