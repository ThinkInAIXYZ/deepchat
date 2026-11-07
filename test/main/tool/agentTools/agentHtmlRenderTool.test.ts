import { describe, expect, it, vi } from 'vitest'
import { AgentHtmlRenderTool } from '@/tool/agentTools/agentHtmlRenderTool'
import { HTML_RENDER_MAX_PANEL_BYTES } from '@shared/agentHtmlRenderTool'

describe('AgentHtmlRenderTool', () => {
  const tool = new AgentHtmlRenderTool()

  it('gives each shell a panelId that sections must reference', () => {
    const result = tool.call({ title: 'Report', html: '<main data-dc-sections></main>' })
    const panelId = result.rawData.htmlRender?.panelId
    expect(panelId).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(result.content).toContain(`panelId: ${panelId}`)

    const measurePanel = vi.fn((_conversationId: string, id: string) =>
      id === panelId ? 100 : null
    )
    const section = { panelId, sectionId: 'kpi', html: '<div class="card">1</div>' }
    expect(() => tool.callSection(section, 'session-1', { measurePanel })).not.toThrow()
    expect(measurePanel).toHaveBeenCalledWith('session-1', panelId, 'kpi')
    expect(() =>
      tool.callSection({ ...section, panelId: 'missing' }, 'session-1', { measurePanel })
    ).toThrow(/No panel missing/)
  })

  it('rejects document markup, remote scripts and an overfull panel', () => {
    const panels = { measurePanel: () => HTML_RENDER_MAX_PANEL_BYTES - 4 }
    const call = (html: string) =>
      tool.callSection({ panelId: 'p', sectionId: 's', html }, 'session-1', panels)

    expect(() => call('<html><body>x</body></html>')).toThrow(/fragment/)
    expect(() => call('<script src="https://unpkg.com/d3"></script>')).toThrow(/remote/)
    expect(() => call('<div>12345</div>')).toThrow(/2 MB/)
    expect(() => call('<b>')).not.toThrow()
  })
})
