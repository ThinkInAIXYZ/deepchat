import { describe, expect, it, vi } from 'vitest'
import { AgentHtmlRenderTool } from '@/tool/agentTools/agentHtmlRenderTool'
import { HTML_RENDER_MAX_PANEL_BYTES } from '@shared/agentHtmlRenderTool'

describe('AgentHtmlRenderTool', () => {
  const tool = new AgentHtmlRenderTool()

  it('awaits Native panel content and counts concurrent accepted sections', async () => {
    const native = new AgentHtmlRenderTool()
    const panels = {
      measurePanel: async () => ({ shellBytes: 10, sectionBytes: new Map<string, number>() })
    }
    const results = await Promise.allSettled(
      ['a', 'b', 'c', 'd', 'e'].map((sectionId) =>
        native.callSection(
          { panelId: 'p', sectionId, html: 'x'.repeat(500_000) },
          'session',
          panels
        )
      )
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4)
    expect(results[4]).toMatchObject({ status: 'rejected', reason: expect.any(Error) })
    await expect(
      native.callSection({ panelId: 'missing', sectionId: 's', html: '<p>x</p>' }, 'session', {
        measurePanel: async () => null
      })
    ).rejects.toThrow(/No panel missing/)
  })

  it('gives each shell a panelId that sections must reference', () => {
    const result = tool.call({ title: 'Report', html: '<main data-dc-sections></main>' })
    const panelId = result.rawData.htmlRender?.panelId
    expect(panelId).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(result.content).toContain(`panelId: ${panelId}`)

    const measurePanel = vi.fn((_conversationId: string, id: string) =>
      id === panelId ? { shellBytes: 100, sectionBytes: new Map() } : null
    )
    const section = { panelId, sectionId: 'kpi', html: '<div class="card">1</div>' }
    expect(() => tool.callSection(section, 'session-1', { measurePanel })).not.toThrow()
    expect(measurePanel).toHaveBeenCalledWith('session-1', panelId)
    expect(() =>
      tool.callSection({ ...section, panelId: 'missing' }, 'session-1', { measurePanel })
    ).toThrow(/No panel missing/)
  })

  it('rejects document markup, remote scripts and an overfull panel', () => {
    const panels = {
      measurePanel: () => ({ shellBytes: HTML_RENDER_MAX_PANEL_BYTES - 4, sectionBytes: new Map() })
    }
    const call = (html: string) =>
      new AgentHtmlRenderTool().callSection(
        { panelId: 'p', sectionId: 's', html },
        'session-1',
        panels
      )

    expect(() => call('<html><body>x</body></html>')).toThrow(/fragment/)
    expect(() => call('<script src="https://unpkg.com/d3"></script>')).toThrow(/remote/)
    expect(() => call('<div>12345</div>')).toThrow(/2 MB/)
    expect(() => call('<b>')).not.toThrow()
  })

  it('counts sections accepted earlier in the same batch before they are persisted', () => {
    const panels = { measurePanel: () => ({ shellBytes: 10, sectionBytes: new Map() }) }
    const batchTool = new AgentHtmlRenderTool()
    const call = (sectionId: string) =>
      batchTool.callSection(
        { panelId: 'p', sectionId, html: 'x'.repeat(500_000) },
        'session-1',
        panels
      )

    for (const sectionId of ['a', 'b', 'c', 'd', 'a']) {
      expect(() => call(sectionId)).not.toThrow()
    }
    expect(() => call('e')).toThrow(/2 MB/)
  })

  it('counts the stored size when a deleted message brings back a larger section', () => {
    let stored = new Map<string, number>()
    const panels = { measurePanel: () => ({ shellBytes: 10, sectionBytes: stored }) }
    const rollbackTool = new AgentHtmlRenderTool()
    const call = (sectionId: string, html: string) =>
      rollbackTool.callSection({ panelId: 'p', sectionId, html }, 'session-1', panels)

    for (const sectionId of ['a', 'b', 'c', 'd']) call(sectionId, 'x')
    stored = new Map(['a', 'b', 'c', 'd'].map((id) => [id, 500_000]))

    expect(() => call('e', 'x'.repeat(200_000))).toThrow(/2 MB/)
  })

  it('measures from the database alone once it covers the accepted sections', () => {
    let stored = new Map<string, number>()
    const panels = { measurePanel: () => ({ shellBytes: 10, sectionBytes: stored }) }
    const pruningTool = new AgentHtmlRenderTool()
    const call = (sectionId: string, html = 'x'.repeat(500_000)) =>
      pruningTool.callSection({ panelId: 'p', sectionId, html }, 'session-1', panels)

    for (const sectionId of ['a', 'b', 'c']) call(sectionId)
    stored = new Map(['a', 'b', 'c'].map((id) => [id, 500_000]))
    call('small', 'x')
    stored = new Map()

    for (const sectionId of ['d', 'e', 'f', 'g']) {
      expect(() => call(sectionId)).not.toThrow()
    }
  })

  it('releases accepted sections that never reach the database', () => {
    vi.useFakeTimers()
    try {
      const panels = { measurePanel: () => ({ shellBytes: 10, sectionBytes: new Map() }) }
      const lostTool = new AgentHtmlRenderTool()
      const call = (sectionId: string) =>
        lostTool.callSection(
          { panelId: 'p', sectionId, html: 'x'.repeat(500_000) },
          'session-1',
          panels
        )

      for (const sectionId of ['a', 'b', 'c', 'd']) call(sectionId)
      expect(() => call('e')).toThrow(/2 MB/)
      vi.advanceTimersByTime(11 * 60_000)
      expect(() => call('e')).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
