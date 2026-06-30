import { describe, expect, it } from 'vitest'
import skillsSource from '../../../src/renderer/src/pages/plugins/SkillsPluginsPage.vue?raw'
import mcpSource from '../../../src/renderer/src/pages/plugins/McpPluginsPage.vue?raw'

describe('plugins page wrappers', () => {
  it('renders the original skills settings view in agent scope', () => {
    expect(skillsSource).toContain('<SkillsSettings scope="agent" />')
    expect(skillsSource).toContain('settings/components/skills/SkillsSettings.vue')
    expect(skillsSource).not.toContain('AgentExtensionPolicyPanel')
  })

  it('renders the original MCP settings view in agent scope', () => {
    expect(mcpSource).toContain('<McpSettings scope="agent" />')
    expect(mcpSource).toContain('settings/components/McpSettings.vue')
    expect(mcpSource).not.toContain('AgentExtensionPolicyPanel')
  })
})
