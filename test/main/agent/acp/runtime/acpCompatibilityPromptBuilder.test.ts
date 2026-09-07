import { describe, expect, it } from 'vitest'
import { AcpCompatibilityPromptBuilder } from '@/agent/acp/runtime/acpCompatibilityPromptBuilder'
import type { AcpCompatibilityPromptSections } from '@/agent/acp/instance'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition
} from '@shared/types/core/mcp'

const sections: AcpCompatibilityPromptSections = {
  configured: 'configured',
  runtime: 'runtime',
  environment: 'environment',
  skills: 'skills',
  activeSkills: 'active-skills',
  tooling: 'tooling',
  permission: 'permission',
  verification: 'verification'
}

const localTool = {
  execution: TOOL_EXECUTION.write,
  type: 'function',
  function: { name: 'read', description: 'Read', parameters: {} },
  server: { name: 'agent', description: 'Agent tools' },
  source: 'agent'
} as MCPToolDefinition

describe('AcpCompatibilityPromptBuilder', () => {
  it('keeps the regular compatibility sections in the frozen order', () => {
    const result = new AcpCompatibilityPromptBuilder().build({
      scope: 'regular',
      latestUserMessage: { role: 'user', content: 'latest user' },
      sections,
      localToolDefinitions: [localTool]
    })

    expect(result.messages).toEqual([
      {
        role: 'system',
        content:
          'configured\n\nruntime\n\nenvironment\n\nskills\n\nactive-skills\n\ntooling\n\npermission\n\nverification'
      },
      { role: 'user', content: 'latest user' }
    ])
    expect(result.localToolDefinitions).toEqual([localTool])
  })

  it('keeps subagents to the latest user without system, skill, or local-tool resources', () => {
    const result = new AcpCompatibilityPromptBuilder().build({
      scope: 'subagent',
      latestUserMessage: { role: 'user', content: 'latest user' },
      sections,
      localToolDefinitions: [localTool]
    })

    expect(result).toEqual({
      messages: [{ role: 'user', content: 'latest user' }],
      localToolDefinitions: []
    })
  })
})
