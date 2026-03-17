import { describe, expect, it, vi } from 'vitest'
import { YoBrowserToolHandler } from '@/presenter/browser/YoBrowserToolHandler'

vi.mock('@shared/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('YoBrowserToolHandler', () => {
  const createPresenter = () =>
    ({
      getBrowserStatus: vi.fn().mockResolvedValue({ initialized: false }),
      loadUrl: vi.fn().mockResolvedValue({ initialized: true }),
      getBrowserPage: vi.fn().mockResolvedValue({
        id: 'page-1',
        url: 'https://example.com',
        status: 'ready'
      }),
      sendCdpCommand: vi.fn().mockResolvedValue({ ok: true })
    }) as any

  it('exposes only the simplified YoBrowser tool names', () => {
    const handler = new YoBrowserToolHandler(createPresenter())

    const toolNames = handler.getToolDefinitions().map((tool) => tool.function.name)

    expect(toolNames).toEqual(['get_browser_status', 'load_url', 'cdp_send'])
  })

  it('routes load_url through the conversation session id', async () => {
    const presenter = createPresenter()
    const handler = new YoBrowserToolHandler(presenter)

    const result = await handler.callTool('load_url', { url: 'https://example.com' }, 'session-a')

    expect(presenter.loadUrl).toHaveBeenCalledWith('session-a', 'https://example.com')
    expect(result).toBe(JSON.stringify({ initialized: true }))
  })

  it('rejects old tool names as unknown tools', async () => {
    const handler = new YoBrowserToolHandler(createPresenter())

    await expect(handler.callTool('yo_browser_cdp_send', {}, 'session-a')).rejects.toThrow(
      'Unknown YoBrowser tool: yo_browser_cdp_send'
    )
  })

  it('requires an initialized session browser before cdp_send', async () => {
    const presenter = createPresenter()
    presenter.getBrowserPage.mockResolvedValue(null)
    const handler = new YoBrowserToolHandler(presenter)

    await expect(
      handler.callTool('cdp_send', { method: 'Page.reload' }, 'session-a')
    ).rejects.toThrow('Session browser for session-a is not initialized')
  })
})
