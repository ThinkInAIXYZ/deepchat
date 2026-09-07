import { describe, expect, it } from 'vitest'
import skillsSource from '../../../src/renderer/src/pages/plugins/SkillsPluginsPage.vue?raw'
import mcpSource from '../../../src/renderer/src/pages/plugins/McpPluginsPage.vue?raw'
import ocrSource from '../../../src/renderer/src/pages/plugins/OcrPluginsPage.vue?raw'

describe('plugins page wrappers', () => {
  it('owns the Skills management surface directly', () => {
    expect(skillsSource).toContain('data-testid="plugins-skills-page"')
    expect(skillsSource).not.toContain('settings/components/skills')
  })

  it('renders the original MCP settings view in global scope', () => {
    expect(mcpSource).toContain('<McpSettings />')
    expect(mcpSource).toContain('settings/components/McpSettings.vue')
  })

  it('renders the original OCR settings view', () => {
    expect(ocrSource).toContain('<OcrSettings />')
    expect(ocrSource).toContain('settings/components/OcrSettings.vue')
  })
})
